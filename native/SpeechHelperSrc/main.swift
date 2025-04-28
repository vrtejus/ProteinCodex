// SpeechHelper/main.swift
// Compile using: swiftc main.swift -o ../SpeechHelper -framework Foundation -framework Speech -framework AVFoundation

import Foundation
import Speech
import AVFoundation // Still needed for AVAudioEngine

// --- Configuration ---
guard CommandLine.arguments.count > 1 else {
    print("Error: Socket path argument missing.")
    exit(1)
}
let socketPath = CommandLine.arguments[1]
let fileManager = FileManager.default

// --- Simple JSON Encoding/Decoding ---
struct SocketMessage: Codable {
    let type: String
    let transcript: String?
    let message: String?
}

struct CommandMessage: Codable {
    let command: String
}

// Function to send JSON message over socket
func sendMessage(_ message: SocketMessage, to clientHandle: FileHandle) {
    do {
        let jsonData = try JSONEncoder().encode(message)
        guard var jsonString = String(data: jsonData, encoding: .utf8) else {
            print("[Helper] Error: Could not encode message to UTF-8 string")
            return
        }
        jsonString += "\n" // Add newline delimiter
        if let dataToSend = jsonString.data(using: .utf8) {
            try clientHandle.write(contentsOf: dataToSend) // Note: Synchronous write
        }
    } catch {
        print("[Helper] Error encoding or writing message: \(error)")
    }
}

// --- Speech Recognition Class ---
class SpeechCoordinator: NSObject, SFSpeechRecognizerDelegate, SFSpeechRecognitionTaskDelegate {
    // Use default recognizer (adapts to system language if possible)
    // Or force English: SFSpeechRecognizer(locale: Locale(identifier: "en-US"))!
    private let speechRecognizer = SFSpeechRecognizer()
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    // Input node is obtained from audioEngine

    var clientHandle: FileHandle?

    override init() {
        super.init()
        // It's good practice to check if the recognizer is available at all
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            // This is a fatal error for the helper's purpose
            print("[Helper] FATAL: Speech recognizer is not available on this system.")
            sendError("Speech recognizer is not available on this system.") // Attempt to notify if client connected
            exit(1) // Exit the helper process if STT isn't possible
        }
        recognizer.delegate = self
        print("[Helper] Speech recognizer initialized. Language: \(recognizer.locale.identifier)")

    }

    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { authStatus in
            OperationQueue.main.addOperation {
                let speechAuthorized = authStatus == .authorized
                print("[Helper] Speech recognition authorization status: \(authStatus.rawValue)")
                if !speechAuthorized {
                    self.sendError("Speech recognition authorization was denied.")
                }

                // --- Microphone Permission Check (macOS specific) ---
                // We request this on startTranscribing now, as there's no direct AVAudioSession equivalent here.
                // But we can check the current status if needed.
                let micPermission = AVCaptureDevice.authorizationStatus(for: .audio)
                 print("[Helper] Current Microphone permission status: \(micPermission.rawValue)")
                 if micPermission == .denied || micPermission == .restricted {
                     self.sendError("Microphone permission was denied or restricted previously.")
                     completion(false) // Cannot proceed without mic permission
                     return
                 }
                // If .notDetermined, we'll request it later. If .authorized, we're good for now.
                completion(speechAuthorized) // Completion depends mainly on speech auth here
            }
        }
    }

    func startTranscribing() {
        guard let clientHandle = clientHandle else {
             print("[Helper] Error: No client connection for transcription.")
             return
        }
        guard speechRecognizer?.isAvailable ?? false else {
            sendError("Speech recognizer is not available.")
            return
        }
        print("[Helper] Starting transcription...")

        // --- Cancel previous tasks ---
        if recognitionTask != nil {
            recognitionTask?.cancel()
            recognitionTask = nil
        }
        if audioEngine.isRunning {
            audioEngine.stop()
            // No need to remove tap here, we'll add a new one
            print("[Helper] Stopped previous audio engine.")
        }
        audioEngine.inputNode.removeTap(onBus: 0) // Clean up previous tap if any


        // --- Request Microphone Access (if not already determined/granted) ---
        // This might show a prompt to the user the FIRST time.
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
             guard let self = self else { return }
             if !granted {
                 print("[Helper] Microphone access denied by user.")
                 self.sendError("Microphone permission is required for voice input.")
                 return // Stop the process if permission denied now
             }

            // --- Proceed with setup only AFTER permission granted ---
            OperationQueue.main.addOperation { // Ensure UI/main thread operations
                 print("[Helper] Microphone access granted.")
                 self.setupAudioEngineAndRecognition()
            }
        }
    }

    // Helper to contain setup logic after permissions
    private func setupAudioEngineAndRecognition() {
         guard let clientHandle = clientHandle else { return } // Re-check client handle

         // --- Setup Audio Engine ---
         let inputNode = audioEngine.inputNode
         let recordingFormat = inputNode.outputFormat(forBus: 0)

         // Check if format is valid
         guard recordingFormat.sampleRate > 0 else {
              sendError("Failed to get a valid recording format from the input node.")
              return
         }

         // --- Setup Speech Recognition Request ---
         recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
         guard let recognitionRequest = recognitionRequest else {
             sendError("Unable to create speech recognition request.")
             return
         }
         recognitionRequest.shouldReportPartialResults = true
         #if !targetEnvironment(simulator) // On-device only works on real hardware
           if speechRecognizer?.supportsOnDeviceRecognition ?? false {
               print("[Helper] Requesting on-device recognition.")
               recognitionRequest.requiresOnDeviceRecognition = true
           } else {
               print("[Helper] On-device recognition not supported by current recognizer/locale.")
           }
         #endif


         // --- Start Recognition Task ---
         recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest, delegate: self)
         guard recognitionTask != nil else {
             sendError("Failed to create recognition task.")
             self.recognitionRequest = nil // Clean up request object
             return
         }

         // --- Install Audio Tap ---
         // This might throw if format is invalid, though we checked sample rate
         inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { (buffer, when) in
             self.recognitionRequest?.append(buffer)
         }
         print("[Helper] Audio tap installed.")

         // --- Start Audio Engine ---
         audioEngine.prepare()
         do {
             try audioEngine.start()
             print("[Helper] Audio engine started.")
         } catch {
             sendError("Audio engine failed to start: \(error.localizedDescription)")
             stopAudioAndCleanup() // Clean up on failure
         }
    }

    func stopTranscribing() {
        print("[Helper] Stopping transcription...")
        stopAudioAndCleanup() // Use helper for cleanup
        // Final result is sent via delegate methods (didFinishRecognition or didFinishSuccessfully)
    }

    private func stopAudioAndCleanup() {
         if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0) // Important to remove tap
            print("[Helper] Audio engine stopped and tap removed.")
        }
        recognitionRequest?.endAudio() // Signal end of audio if request exists
        // Don't nil out task/request here, delegate methods might still need them
        recognitionTask?.finish() // Encourage task to finish if not already done
        // If task finishes immediately, delegate methods handle sending final result/errors
    }

    private func sendError(_ message: String) {
        print("[Helper] Error: \(message)")
        if let handle = clientHandle {
            sendMessage(SocketMessage(type: "error", transcript: nil, message: message), to: handle)
        }
    }

    // MARK: - SFSpeechRecognizerDelegate
    func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        if available {
            print("[Helper] Speech recognizer available.")
        } else {
            sendError("Speech recognizer became unavailable.")
            stopAudioAndCleanup() // Stop if recognizer goes away
        }
    }

     // MARK: - SFSpeechRecognitionTaskDelegate
    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didHypothesizeTranscription transcription: SFTranscription) {
        if let handle = clientHandle {
            sendMessage(SocketMessage(type: "interimResult", transcript: transcription.formattedString, message: nil), to: handle)
        }
    }

    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishRecognition recognitionResult: SFSpeechRecognitionResult) {
         let finalTranscript = recognitionResult.bestTranscription.formattedString
         print("[Helper] Final Transcript (didFinishRecognition): \(finalTranscript)")
        if let handle = clientHandle {
            sendMessage(SocketMessage(type: "finalResult", transcript: finalTranscript, message: nil), to: handle)
        }
        // NOTE: Task might not be fully finished yet, even if we got a final result.
        // The 'didFinishSuccessfully' delegate is the definitive end.
    }

    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishSuccessfully successfully: Bool) {
        // This is called when the task truly finishes processing or is cancelled/errored
        print("[Helper] Recognition task finished definitively. Success: \(successfully)")

        // Clean up completely now that the task is done
        self.recognitionRequest = nil
        self.recognitionTask = nil
        // self.stopAudioAndCleanup() // Ensure audio is stopped if not already

        if !successfully {
             if let error = task.error {
                  let nsError = error as NSError
                   // Common codes: 203 (No speech/cancelled), 216 (temp connection issue), 1 (asset issue)
                   print("[Helper] Task Error Code: \(nsError.code), Domain: \(nsError.domain)")
                 if nsError.code != 203 { // Just check if it's NOT the common "no speech/user cancelled" code
                      sendError("Recognition task failed: \(error.localizedDescription) (Code: \(nsError.code))")
                  } else {
                     print("[Helper] Recognition task cancelled or no speech detected.")
                    // If no final result was sent before, send an empty one now on cancellation?
                     if let handle = clientHandle {
                          // Check if a finalResult was already sent? Hard to track state perfectly.
                          // Maybe just rely on Electron timeout if no final result arrives.
                          // sendMessage(SocketMessage(type: "finalResult", transcript: "", message: "Cancelled or no speech"), to: handle)
                     }
                 }
             } else {
                 sendError("Recognition task failed with unknown error.")
             }
        }
        // If successfully == true, the final result should have been sent by didFinishRecognition
    }
}


// --- Socket Server Logic ---
var serverSocket: Int32 = -1
var clientConnection: FileHandle?
let speechCoordinator = SpeechCoordinator()
var continueRunning = true

func setupSocketServer() -> Bool {
    // ... (Keep setupSocketServer exactly as before) ...
    // Remove old socket file if it exists
    if fileManager.fileExists(atPath: socketPath) {
        do {
            try fileManager.removeItem(atPath: socketPath)
            print("[Helper] Removed existing socket file.")
        } catch {
            print("Error removing existing socket file: \(error)")
            return false
        }
    }
    // Create socket
    serverSocket = socket(AF_UNIX, SOCK_STREAM, 0)
    if serverSocket == -1 {
        perror("socket")
        return false
    }
    // Set up address structure
    var addr = sockaddr_un()
     addr.sun_family = sa_family_t(AF_UNIX)
    // *** Calculate size BEFORE the pointer scope ***
    let sunPathSize = MemoryLayout.size(ofValue: addr.sun_path)
     _ = withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
         socketPath.withCString { cString in
            strncpy(ptr, cString, sunPathSize) // Use the pre-calculated size
         }
     }
    // Bind socket
    let bindResult = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
            bind(serverSocket, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    if bindResult == -1 {
        perror("bind")
        close(serverSocket)
        return false
    }
    // Listen for connections
    if listen(serverSocket, 1) == -1 { // Listen for only 1 connection
        perror("listen")
        close(serverSocket)
        return false
    }
    print("[Helper] Socket server listening at \(socketPath)")
    return true
}

// --- Accept and Read Loop ---
// Combine accept and read into one loop for simplicity with single client
func runServerLoop() {
     guard setupSocketServer() else {
        print("[Helper] Failed to set up socket server. Exiting.")
        exit(1)
     }

    // Wait for the single client connection
    while continueRunning {
        print("[Helper] Waiting for client connection...")
        let clientSocket = accept(serverSocket, nil, nil) // Simplified accept

        if clientSocket == -1 {
            if !continueRunning { break }
            perror("accept error")
            sleep(1) // Avoid busy-looping on accept error
            continue
        }

        print("[Helper] Client connected (socket fd: \(clientSocket)).")

        let handle = FileHandle(fileDescriptor: clientSocket, closeOnDealloc: true)
        clientConnection = handle
        speechCoordinator.clientHandle = handle

        // Notify client we're ready
        sendMessage(SocketMessage(type: "ready", transcript: nil, message: "Speech Helper Ready"), to: handle)

        // Start reading commands from this client
        var buffer = Data()
        while continueRunning {
            let availableData = handle.availableData // This blocks until data or EOF
            if availableData.isEmpty {
                print("[Helper] Client disconnected (EOF).")
                break // Exit inner loop on disconnect
            }
            buffer.append(availableData)

            // Process buffer for newline-delimited JSON
            while let newlineRange = buffer.range(of: Data("\n".utf8)) {
                let jsonData = buffer.subdata(in: 0..<newlineRange.lowerBound)
                buffer.removeSubrange(0...newlineRange.lowerBound)

                if jsonData.isEmpty { continue }

                do {
                    let commandMsg = try JSONDecoder().decode(CommandMessage.self, from: jsonData)
                    print("[Helper] Received command: \(commandMsg.command)")
                    // Run command handling on the main thread for UI/Speech framework safety
                     DispatchQueue.main.async {
                        handleCommand(commandMsg.command)
                     }
                } catch {
                    print("[Helper] Error decoding command JSON: \(error)")
                    // Handle error, maybe send back an error message?
                }
            }
        } // End of read loop for this client

        // Cleanup after client disconnects
        clientConnection = nil
        speechCoordinator.clientHandle = nil
         DispatchQueue.main.async { // Ensure cleanup happens on main thread too
            speechCoordinator.stopTranscribing()
         }
        // Ready to accept a new connection if server is still running
         if !continueRunning { break } // Exit outer loop if server stopped
    }

     print("[Helper] Server loop finished.")
     // Final cleanup
    if serverSocket != -1 { close(serverSocket) }
    if fileManager.fileExists(atPath: socketPath) {
        try? fileManager.removeItem(atPath: socketPath)
    }
}


func handleCommand(_ command: String) {
    switch command {
    case "start":
        speechCoordinator.startTranscribing()
    case "stop":
        speechCoordinator.stopTranscribing()
    case "ping":
        if let handle = clientConnection {
            sendMessage(SocketMessage(type: "pong", transcript: nil, message: "Pong from Helper"), to: handle)
        }
     case "shutdown":
          print("[Helper] Received shutdown command.")
          continueRunning = false
          speechCoordinator.stopTranscribing() // Stop any active transcription
          // Close the client connection if it exists
          if let handle = clientConnection {
             handle.closeFile()
             clientConnection = nil
             speechCoordinator.clientHandle = nil
          }
          // Close the server socket to break the accept loop
          if serverSocket != -1 {
              close(serverSocket)
              serverSocket = -1 // Mark as closed
          }
    default:
        print("[Helper] Unknown command received: \(command)")
        if let handle = clientConnection {
             sendMessage(SocketMessage(type: "error", transcript: nil, message: "Unknown command: \(command)"), to: handle)
        }
    }
}

// --- Main Execution ---

// Setup signal handling
signal(SIGINT) { _ in print("\n[Helper] SIGINT"); handleCommand("shutdown") }
signal(SIGTERM) { _ in print("\n[Helper] SIGTERM"); handleCommand("shutdown") }

print("[Helper] Requesting Speech Recognition authorization...")
// Put server startup within the authorization callback to ensure permissions first
speechCoordinator.requestAuthorization { authorized in
    guard authorized else {
        print("[Helper] Authorization failed. Exiting.")
        exit(1)
    }
    print("[Helper] Authorization successful.")

    // Run server loop on a background thread so main runloop isn't blocked
     DispatchQueue.global(qos: .userInitiated).async {
         runServerLoop()
     }
}

// Keep the main thread alive using RunLoop
RunLoop.main.run()

// This point is reached only when RunLoop.main.stop() is called or the app terminates
print("[Helper] Main run loop finished.")
exit(0) // Ensure clean exit