import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopStreamingSpeechCapture } from '../src/desktop/desktopStreamingSpeechCapture';
import { WindowsSpeechCapture } from '../src/desktop/windowsSpeechCapture';

afterEach(() => vi.unstubAllGlobals());
describe('microphone startup cancellation', () => {
  for (const Capture of [DesktopStreamingSpeechCapture, WindowsSpeechCapture]) {
    it(`${Capture.name} releases a stream acquired after stop`, async () => {
      let resolve!: (stream: unknown) => void;
      const track = { stop: vi.fn(), getSettings: () => ({ deviceId: 'test' }) };
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise((done) => { resolve = done; }) } });
      const callbacks = { onReady: vi.fn(), onLevel: vi.fn(), onChunk: vi.fn(), onSegment: vi.fn(async () => undefined), onError: vi.fn(), onWarning: vi.fn() };
      const capture = new Capture(callbacks, null, { echoCancellation: true, noiseSuppression: true, autoGainControl: true, inputGain: 1 });
      const start = capture.start();
      await capture.stop();
      resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
      await start;
      expect(track.stop).toHaveBeenCalledOnce();
      expect(callbacks.onReady).not.toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });
  }
  for (const Capture of [DesktopStreamingSpeechCapture, WindowsSpeechCapture]) {
  it(`${Capture.name} cancels while the audio context is resuming`, async () => {
    let resume!: () => void;
    const track = { stop: vi.fn(), getSettings: () => ({}) };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
    const close = vi.fn(async () => undefined);
    const source = vi.fn();
    vi.stubGlobal('AudioContext', class { resume = () => new Promise<void>((done) => { resume = done; }); close = close; createMediaStreamSource = source; });
    const onReady = vi.fn();
    const capture = new Capture({ onReady, onLevel: vi.fn(), onChunk: vi.fn(), onSegment: vi.fn(async () => undefined), onError: vi.fn(), onWarning: vi.fn() }, null,
      { echoCancellation: true, noiseSuppression: true, autoGainControl: true, inputGain: 1 });
    const pending = capture.start();
    await Promise.resolve();
    await capture.stop();
    resume();
    await pending;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(source).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
  }
});
