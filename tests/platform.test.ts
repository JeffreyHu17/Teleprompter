import { describe, expect, it } from 'vitest';
import { platformCapabilities } from '../src/desktop/capabilities';
import { initialSessionState } from '../src/core/session';
import { encodeMonoPcm16Wav, resampleLinear } from '../src/desktop/windowsSpeechCapture';

describe('platform conditions', () => {
  it('enables FunASR and GPU backends on Windows', () => {
    const capabilities = platformCapabilities('windows');
    const state = initialSessionState('windows');
    expect(capabilities).toMatchObject({ desktop: true, mobile: false, systemSpeech: true, funAsr: true });
    expect(state.speech.engine).toBe('system');
    expect(state.funasr.availableBackends).toEqual(['cuda', 'vulkan', 'cpu']);
  });

  it('keeps Android mobile and system speech only', () => {
    expect(platformCapabilities('android')).toMatchObject({ desktop: false, mobile: true, systemSpeech: true, funAsr: false });
  });
});

describe('Windows audio capture encoding', () => {
  it('resamples mono PCM and emits a valid 16 kHz WAV', () => {
    const source = new Float32Array(48_000).map((_, index) => Math.sin(index / 12));
    const resampled = resampleLinear(source, 48_000, 16_000);
    expect(resampled).toHaveLength(16_000);
    const wav = encodeMonoPcm16Wav(resampled, 16_000);
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(wav, offset, length));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32_000);
  });
});
