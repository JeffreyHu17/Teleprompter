import AVFoundation
import AppKit
import Foundation
import Speech

struct SpeechEvent: Encodable {
    let type: String
    var status: String? = nil
    var message: String? = nil
    var locale: String? = nil
    var onDevice: Bool? = nil
    var text: String? = nil
    var isFinal: Bool? = nil
    var confidence: Float? = nil
    var level: Float? = nil
    var path: String? = nil
    var durationMs: Int? = nil
}

final class EventWriter {
    private let encoder = JSONEncoder()
    private let lock = NSLock()
    private let eventFile: FileHandle?

    init(eventFilePath: String?) {
        guard let eventFilePath else { eventFile = nil; return }
        FileManager.default.createFile(atPath: eventFilePath, contents: nil)
        eventFile = try? FileHandle(forWritingTo: URL(fileURLWithPath: eventFilePath))
    }

    func send(_ event: SpeechEvent) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? encoder.encode(event), var line = String(data: data, encoding: .utf8) else { return }
        line.append("\n")
        let lineData = Data(line.utf8)
        FileHandle.standardOutput.write(lineData)
        eventFile?.write(lineData)
    }
}

final class SpeechService: NSObject {
    private let writer: EventWriter
    private let localeIdentifier: String
    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var restarting = false
    private var stopped = false
    private var lastLevelReport = Date.distantPast
    private let segmentDirectory: String?
    private let voiceProcessingEnabled: Bool
    private let inputGain: Float
    private var segmentFile: AVAudioFile?
    private var segmentStartedAt: Date?
    private var silenceStartedAt: Date?

    init(localeIdentifier: String, eventFilePath: String?, segmentDirectory: String?, voiceProcessingEnabled: Bool, inputGain: Float) {
        self.localeIdentifier = localeIdentifier
        self.writer = EventWriter(eventFilePath: eventFilePath)
        self.segmentDirectory = segmentDirectory
        self.voiceProcessingEnabled = voiceProcessingEnabled
        self.inputGain = max(0, min(8, inputGain))
    }

    func probe() {
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier))
        writer.send(SpeechEvent(
            type: "capability",
            status: recognizer == nil ? "unavailable" : "ready",
            message: recognizer == nil ? "系统未安装该语言的语音识别器" : nil,
            locale: localeIdentifier,
            onDevice: recognizer?.supportsOnDeviceRecognition ?? false
        ))
        exit(recognizer?.supportsOnDeviceRecognition == true ? 0 : 2)
    }

    func start() {
        writer.send(SpeechEvent(type: "status", status: "requesting", locale: localeIdentifier, onDevice: true))
        NSApplication.shared.setActivationPolicy(.accessory)
        NSApplication.shared.activate(ignoringOtherApps: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            if self?.segmentDirectory != nil {
                self?.requestMicrophoneForCapture()
            } else {
                self?.requestSpeechAuthorization()
            }
        }
    }

    private func requestMicrophoneForCapture() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            guard let self else { return }
            guard granted else {
                self.writer.send(SpeechEvent(type: "error", status: "permission-denied", message: "麦克风权限被拒绝，请在系统设置的隐私与安全性中允许 Teleprompter Speech 访问麦克风", locale: self.localeIdentifier, onDevice: true))
                exit(4)
            }
            DispatchQueue.main.async { self.beginCapture() }
        }
    }

    private func requestSpeechAuthorization() {
        SFSpeechRecognizer.requestAuthorization { [weak self] speechStatus in
            guard let self else { return }
            guard speechStatus == .authorized else {
                self.writer.send(SpeechEvent(type: "error", status: "permission-denied", message: self.speechAuthorizationMessage(speechStatus), locale: self.localeIdentifier, onDevice: true))
                exit(3)
            }
            self.writer.send(SpeechEvent(type: "status", status: "speech-authorized", message: "语音识别权限已允许，正在请求麦克风权限", locale: self.localeIdentifier, onDevice: true))
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                guard granted else {
                    self.writer.send(SpeechEvent(type: "error", status: "permission-denied", message: "麦克风权限被拒绝，请在系统设置的隐私与安全性中允许 Teleprompter Speech 访问麦克风", locale: self.localeIdentifier, onDevice: true))
                    exit(4)
                }
                self.writer.send(SpeechEvent(type: "status", status: "microphone-authorized", message: "麦克风权限已允许，正在启动端侧识别", locale: self.localeIdentifier, onDevice: true))
                DispatchQueue.main.async { self.beginRecognition() }
            }
        }
    }

    func stop() {
        stopped = true
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        finishSegment()
        writer.send(SpeechEvent(type: "level", locale: localeIdentifier, onDevice: true, level: 0))
        writer.send(SpeechEvent(type: "status", status: "stopped", locale: localeIdentifier, onDevice: true))
    }

    private func beginRecognition() {
        guard !stopped else { return }
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier))
        guard let recognizer else { fail("系统未安装 \(localeIdentifier) 语音识别器", code: 5); return }
        guard recognizer.supportsOnDeviceRecognition else { fail("当前 Mac 不支持 \(localeIdentifier) 系统端侧识别；为保证隐私，未回退到云端", code: 6); return }
        guard recognizer.isAvailable else { fail("系统语音识别器当前不可用", code: 7); return }

        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.taskHint = .dictation
        if #available(macOS 13.0, *) { request.addsPunctuation = false }
        self.request = request

        let input = audioEngine.inputNode
        do {
            try input.setVoiceProcessingEnabled(voiceProcessingEnabled)
        } catch {
            writer.send(SpeechEvent(type: "warning", status: "audio-processing", message: "无法应用系统语音处理：\(error.localizedDescription)", locale: localeIdentifier, onDevice: true))
        }
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 && format.channelCount > 0 else { fail("没有可用的麦克风输入格式", code: 8); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            let processed = self.bufferByApplyingInputGain(buffer)
            self.request?.append(processed)
            self.reportInputLevel(processed)
        }

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let segments = result.bestTranscription.segments
                let confidence = segments.isEmpty ? nil : segments.reduce(0) { $0 + $1.confidence } / Float(segments.count)
                self.writer.send(SpeechEvent(type: "transcript", status: "listening", locale: self.localeIdentifier, onDevice: true, text: result.bestTranscription.formattedString, isFinal: result.isFinal, confidence: confidence))
                if result.isFinal { self.scheduleRestart() }
            } else if let error, !self.stopped {
                self.writer.send(SpeechEvent(type: "warning", status: "restarting", message: error.localizedDescription, locale: self.localeIdentifier, onDevice: true))
                self.scheduleRestart()
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            restarting = false
            writer.send(SpeechEvent(type: "status", status: "listening", locale: localeIdentifier, onDevice: true))
        } catch {
            fail("无法启动麦克风：\(error.localizedDescription)", code: 9)
        }
    }

    private func beginCapture() {
        guard !stopped, let segmentDirectory else { return }
        try? FileManager.default.createDirectory(atPath: segmentDirectory, withIntermediateDirectories: true)
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 && format.channelCount > 0 else { fail("没有可用的麦克风输入格式", code: 8); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.capture(buffer, format: format)
            self?.reportInputLevel(buffer)
        }
        do {
            audioEngine.prepare()
            try audioEngine.start()
            writer.send(SpeechEvent(type: "status", status: "listening", message: "FunASR 本地采集中", locale: localeIdentifier, onDevice: true))
        } catch {
            fail("无法启动麦克风：\(error.localizedDescription)", code: 9)
        }
    }

    private func capture(_ buffer: AVAudioPCMBuffer, format: AVAudioFormat) {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        let count = Int(buffer.frameLength)
        var sum: Float = 0
        for index in 0..<count { sum += channel[index] * channel[index] }
        let rms = sqrt(sum / Float(count))
        let now = Date()
        if segmentFile == nil, rms >= 0.012 { startSegment(format: format, at: now) }
        guard let segmentFile else { return }
        do {
            try segmentFile.write(from: buffer)
        } catch {
            writer.send(SpeechEvent(type: "warning", status: "recording", message: "无法写入 FunASR 音频片段：\(error.localizedDescription)", locale: localeIdentifier, onDevice: true))
            finishSegment()
            return
        }
        if rms < 0.008 {
            if silenceStartedAt == nil { silenceStartedAt = now }
        } else {
            silenceStartedAt = nil
        }
        let duration = now.timeIntervalSince(segmentStartedAt ?? now)
        let silence = now.timeIntervalSince(silenceStartedAt ?? now)
        if duration >= 10 || (duration >= 0.35 && silence >= 0.7) { finishSegment() }
    }

    private func startSegment(format: AVAudioFormat, at date: Date) {
        guard let segmentDirectory else { return }
        let path = URL(fileURLWithPath: segmentDirectory).appendingPathComponent("segment-\(UUID().uuidString).wav")
        do {
            segmentFile = try AVAudioFile(forWriting: path, settings: format.settings)
            segmentStartedAt = date
            silenceStartedAt = nil
        } catch {
            writer.send(SpeechEvent(type: "warning", status: "recording", message: "无法创建 FunASR 音频片段：\(error.localizedDescription)", locale: localeIdentifier, onDevice: true))
        }
    }

    private func finishSegment() {
        guard let file = segmentFile, let startedAt = segmentStartedAt else { return }
        let durationMs = max(0, Int(Date().timeIntervalSince(startedAt) * 1000))
        let path = file.url.path
        segmentFile = nil
        segmentStartedAt = nil
        silenceStartedAt = nil
        if durationMs >= 250 {
            writer.send(SpeechEvent(type: "segment", status: "queued", locale: localeIdentifier, onDevice: true, path: path, durationMs: durationMs))
        } else {
            try? FileManager.default.removeItem(atPath: path)
        }
    }

    private func scheduleRestart() {
        guard !stopped, !restarting else { return }
        restarting = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.beginRecognition() }
    }

    private func reportInputLevel(_ buffer: AVAudioPCMBuffer) {
        let now = Date()
        guard now.timeIntervalSince(lastLevelReport) >= 0.05,
              let channel = buffer.floatChannelData?[0],
              buffer.frameLength > 0 else { return }
        lastLevelReport = now
        let count = Int(buffer.frameLength)
        var sum: Float = 0
        for index in 0..<count {
            let sample = channel[index]
            sum += sample * sample
        }
        let rms = sqrt(sum / Float(count))
        let decibels = 20 * log10(max(rms, 0.000_001))
        let normalized = max(0, min(1, (decibels + 60) / 60))
        writer.send(SpeechEvent(type: "level", locale: localeIdentifier, onDevice: true, level: normalized))
    }

    private func bufferByApplyingInputGain(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
        guard abs(inputGain - 1) > 0.001,
              let sourceChannels = buffer.floatChannelData,
              let output = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameCapacity),
              let outputChannels = output.floatChannelData else { return buffer }
        output.frameLength = buffer.frameLength
        let channelCount = Int(buffer.format.channelCount)
        let frameCount = Int(buffer.frameLength)
        for channelIndex in 0..<channelCount {
            for frameIndex in 0..<frameCount {
                outputChannels[channelIndex][frameIndex] = max(-1, min(1, sourceChannels[channelIndex][frameIndex] * inputGain))
            }
        }
        return output
    }

    private func fail(_ message: String, code: Int32) {
        writer.send(SpeechEvent(type: "error", status: "error", message: message, locale: localeIdentifier, onDevice: true))
        stop()
        exit(code)
    }

    private func speechAuthorizationMessage(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .denied: return "语音识别权限被拒绝，请在系统设置的隐私与安全性中允许 Teleprompter Speech 使用语音识别"
        case .restricted: return "当前系统限制了语音识别权限"
        case .notDetermined: return "语音识别权限尚未确定"
        case .authorized: return ""
        @unknown default: return "未知的语音识别权限状态"
        }
    }
}

let arguments = CommandLine.arguments
let localeIndex = arguments.firstIndex(of: "--locale")
let locale = localeIndex.flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil } ?? "zh-CN"
let eventFileIndex = arguments.firstIndex(of: "--event-file")
let eventFilePath = eventFileIndex.flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
let stopFileIndex = arguments.firstIndex(of: "--stop-file")
let stopFilePath = stopFileIndex.flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
let segmentDirectoryIndex = arguments.firstIndex(of: "--segment-dir")
let segmentDirectory = segmentDirectoryIndex.flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
let voiceProcessingIndex = arguments.firstIndex(of: "--voice-processing")
let voiceProcessing = voiceProcessingIndex.flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] == "true" : nil } ?? false
let inputGainIndex = arguments.firstIndex(of: "--input-gain")
let inputGain = inputGainIndex.flatMap { arguments.indices.contains($0 + 1) ? Float(arguments[$0 + 1]) : nil } ?? 1
let service = SpeechService(localeIdentifier: locale, eventFilePath: eventFilePath, segmentDirectory: segmentDirectory, voiceProcessingEnabled: voiceProcessing, inputGain: inputGain)
_ = NSApplication.shared

if let stopFilePath {
    Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
        if FileManager.default.fileExists(atPath: stopFilePath) {
            service.stop()
            exit(0)
        }
    }
}

signal(SIGTERM) { _ in DispatchQueue.main.async { service.stop(); exit(0) } }
signal(SIGINT) { _ in DispatchQueue.main.async { service.stop(); exit(0) } }

if arguments.contains("--probe") {
    service.probe()
} else {
    service.start()
    RunLoop.main.run()
}
