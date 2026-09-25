interface WindowsSpeechCaptureCallbacks {
  onLevel: (level: number) => void;
  onSegment: (wav: ArrayBuffer, durationMs: number) => Promise<void>;
  onError: (message: string) => void;
  onWarning: (message: string) => void;
}

const START_THRESHOLD = 0.012;
const SILENCE_THRESHOLD = 0.008;
const SILENCE_MS = 700;
const MIN_SEGMENT_MS = 250;
const MAX_SEGMENT_MS = 10_000;
const TARGET_SAMPLE_RATE = 16_000;

export class WindowsSpeechCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private segmentSamples = 0;
  private segmentStartedAt = 0;
  private silenceStartedAt = 0;
  private lastLevelAt = 0;

  constructor(
    private readonly callbacks: WindowsSpeechCaptureCallbacks,
    private readonly inputDeviceId: string | null = null,
    private processing: MicrophoneProcessingSettings,
  ) {}

  async start(): Promise<void> {
    if (this.context) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: this.processing.echoCancellation,
          noiseSuppression: this.processing.noiseSuppression,
          autoGainControl: this.processing.autoGainControl,
          ...(this.inputDeviceId ? { deviceId: { exact: this.inputDeviceId } } : {}),
        },
        video: false,
      });
      this.context = new AudioContext();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = (event) => this.process(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
      this.source.connect(this.processor);
      this.processor.connect(this.context.destination);
    } catch (error) {
      await this.stop(false);
      this.callbacks.onError(`Windows 麦克风启动失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateProcessing(processing: MicrophoneProcessingSettings): Promise<void> {
    this.processing = processing;
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        echoCancellation: processing.echoCancellation,
        noiseSuppression: processing.noiseSuppression,
        autoGainControl: processing.autoGainControl,
      });
    } catch (error) {
      this.callbacks.onWarning(`当前麦克风无法动态应用部分调整：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop(flush = true): Promise<void> {
    if (flush) await this.finishSegment(this.context?.sampleRate ?? TARGET_SAMPLE_RATE);
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close().catch((error) => this.callbacks.onError(`Windows 音频上下文关闭失败：${String(error)}`));
    this.context = null;
    this.stream = null;
    this.processor = null;
    this.source = null;
    this.resetSegment();
    this.callbacks.onLevel(0);
  }

  private process(input: Float32Array, sampleRate: number): void {
    const adjusted = applyInputGain(input, this.processing.inputGain);
    let sum = 0;
    for (const sample of adjusted) sum += sample * sample;
    const rms = Math.sqrt(sum / Math.max(1, adjusted.length));
    const now = performance.now();
    if (now - this.lastLevelAt >= 50) {
      this.lastLevelAt = now;
      this.callbacks.onLevel(Math.min(1, Math.max(0, rms * 8)));
    }
    if (!this.segmentStartedAt && rms >= START_THRESHOLD) this.segmentStartedAt = now;
    if (!this.segmentStartedAt) return;
    const copy = new Float32Array(adjusted.length);
    copy.set(adjusted);
    this.chunks.push(copy);
    this.segmentSamples += copy.length;
    if (rms < SILENCE_THRESHOLD) {
      if (!this.silenceStartedAt) this.silenceStartedAt = now;
    } else {
      this.silenceStartedAt = 0;
    }
    const durationMs = this.segmentSamples / sampleRate * 1000;
    const silenceMs = this.silenceStartedAt ? now - this.silenceStartedAt : 0;
    if (durationMs >= MAX_SEGMENT_MS || (durationMs >= 350 && silenceMs >= SILENCE_MS)) {
      void this.finishSegment(sampleRate);
    }
  }

  private async finishSegment(sampleRate: number): Promise<void> {
    if (!this.segmentStartedAt || !this.segmentSamples) return;
    const chunks = this.chunks;
    const sampleCount = this.segmentSamples;
    const durationMs = sampleCount / sampleRate * 1000;
    this.resetSegment();
    if (durationMs < MIN_SEGMENT_MS) return;
    const merged = new Float32Array(sampleCount);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const resampled = resampleLinear(merged, sampleRate, TARGET_SAMPLE_RATE);
    await this.callbacks.onSegment(encodeMonoPcm16Wav(resampled, TARGET_SAMPLE_RATE), durationMs);
  }

  private resetSegment(): void {
    this.chunks = [];
    this.segmentSamples = 0;
    this.segmentStartedAt = 0;
    this.silenceStartedAt = 0;
  }
}

export function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  const output = new Float32Array(Math.max(1, Math.round(input.length * targetRate / sourceRate)));
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}
import type { MicrophoneProcessingSettings } from '../types/session';
import { applyInputGain } from './desktopStreamingSpeechCapture';
