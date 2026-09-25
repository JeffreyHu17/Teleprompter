interface DesktopStreamingSpeechCaptureCallbacks {
  onLevel: (level: number) => void;
  onChunk: (samples: ArrayBuffer) => void;
  onReady: (deviceId: string | null, usedFallback: boolean) => void;
  onError: (message: string) => void;
  onWarning: (message: string) => void;
}

const TARGET_SAMPLE_RATE = 16_000;

export class DesktopStreamingSpeechCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private lastLevelAt = 0;

  constructor(
    private readonly callbacks: DesktopStreamingSpeechCaptureCallbacks,
    private readonly inputDeviceId: string | null = null,
    private processing: MicrophoneProcessingSettings,
  ) {}

  async start(): Promise<void> {
    if (this.context) return;
    try {
      let requestedDeviceId = this.inputDeviceId;
      let usedFallback = false;
      if (requestedDeviceId && navigator.mediaDevices.enumerateDevices) {
        const availableInputs = (await navigator.mediaDevices.enumerateDevices())
          .filter((device) => device.kind === 'audioinput' && device.deviceId);
        if (availableInputs.length > 0 && !availableInputs.some((device) => device.deviceId === requestedDeviceId)) {
          requestedDeviceId = null;
          usedFallback = true;
        }
      }
      try {
        this.stream = await this.openStream(requestedDeviceId);
      } catch (error) {
        if (!requestedDeviceId || !isUnavailableDeviceError(error)) throw error;
        this.stream = await this.openStream(null);
        usedFallback = true;
      }
      this.context = new AudioContext();
      await this.context.resume();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = (event) => this.process(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
      this.source.connect(this.processor);
      this.processor.connect(this.context.destination);
      const activeTrack = this.stream.getAudioTracks()[0];
      this.callbacks.onReady(activeTrack?.getSettings().deviceId ?? requestedDeviceId, usedFallback);
    } catch (error) {
      await this.stop();
      this.callbacks.onError(microphoneErrorMessage(error));
    }
  }

  private openStream(deviceId: string | null): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: this.processing.echoCancellation,
          noiseSuppression: this.processing.noiseSuppression,
          autoGainControl: this.processing.autoGainControl,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        video: false,
      });
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

  async stop(): Promise<void> {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context) {
      try {
        await this.context.close();
      } catch (error) {
        this.callbacks.onError(`音频上下文关闭失败：${String(error)}`);
      }
    }
    this.context = null;
    this.stream = null;
    this.processor = null;
    this.source = null;
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
    const resampled = resampleLinear(adjusted, sampleRate, TARGET_SAMPLE_RATE);
    const owned = new Float32Array(resampled.length);
    owned.set(resampled);
    this.callbacks.onChunk(owned.buffer);
  }
}

export function applyInputGain(input: Float32Array, gain: number): Float32Array {
  if (gain === 1) return input;
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, input[index] * gain));
  }
  return output;
}

export function isUnavailableDeviceError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError');
}

export function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '麦克风权限被拒绝，请在系统设置的“麦克风”中允许此应用';
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return '没有可用的麦克风，请重新连接设备或选择系统默认麦克风';
    }
    if (error.name === 'NotReadableError') {
      return '麦克风无法读取，可能正被其他应用独占';
    }
  }
  return `麦克风启动失败：${error instanceof Error ? error.message : String(error)}`;
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
import type { MicrophoneProcessingSettings } from '../types/session';
