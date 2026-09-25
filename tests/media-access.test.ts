import { describe, expect, it, vi } from 'vitest';
import {
  allowAudioMediaCheck,
  allowAudioMediaRequest,
  requestMicrophoneAccess,
  type MicrophoneAccessApi,
  type MicrophoneAccessStatus,
} from '../electron/mediaAccess';
import { applyInputGain, isUnavailableDeviceError, microphoneErrorMessage } from '../src/desktop/desktopStreamingSpeechCapture';

function accessApi(initial: MicrophoneAccessStatus, resolved = initial, answer = false): MicrophoneAccessApi {
  let calls = 0;
  return {
    getMediaAccessStatus: vi.fn(() => {
      calls += 1;
      return calls === 1 ? initial : resolved;
    }),
    askForMediaAccess: vi.fn(async () => answer),
  };
}

describe('macOS microphone access', () => {
  it('does not prompt when access is already granted', async () => {
    const api = accessApi('granted');
    await expect(requestMicrophoneAccess(api)).resolves.toEqual({
      granted: true,
      status: 'granted',
      requested: false,
    });
    expect(api.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('actively prompts when access has not been determined', async () => {
    const api = accessApi('not-determined', 'granted', true);
    await expect(requestMicrophoneAccess(api)).resolves.toEqual({
      granted: true,
      status: 'granted',
      requested: true,
    });
    expect(api.askForMediaAccess).toHaveBeenCalledWith('microphone');
  });

  it('does not attempt an impossible repeat prompt after denial', async () => {
    const api = accessApi('denied');
    await expect(requestMicrophoneAccess(api)).resolves.toEqual({
      granted: false,
      status: 'denied',
      requested: false,
    });
    expect(api.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('does not treat a stale successful answer as granted', async () => {
    const api = accessApi('not-determined', 'denied', true);
    await expect(requestMicrophoneAccess(api)).resolves.toEqual({
      granted: false,
      status: 'denied',
      requested: true,
    });
  });
});

describe('desktop streaming microphone errors', () => {
  it('retries only when the selected input device is unavailable', () => {
    expect(isUnavailableDeviceError(new DOMException('', 'NotFoundError'))).toBe(true);
    expect(isUnavailableDeviceError(new DOMException('', 'OverconstrainedError'))).toBe(true);
    expect(isUnavailableDeviceError(new DOMException('', 'NotAllowedError'))).toBe(false);
  });

  it('reports permission, missing device, and busy device separately', () => {
    expect(microphoneErrorMessage(new DOMException('', 'NotAllowedError'))).toContain('权限被拒绝');
    expect(microphoneErrorMessage(new DOMException('', 'NotFoundError'))).toContain('没有可用的麦克风');
    expect(microphoneErrorMessage(new DOMException('', 'NotReadableError'))).toContain('其他应用独占');
  });

  it('applies manual input gain and clamps samples before ASR', () => {
    expect(Array.from(applyInputGain(new Float32Array([0.2, -0.6, 0.9]), 2))).toEqual([
      expect.closeTo(0.4),
      -1,
      1,
    ]);
  });
});

describe('Electron renderer media permission', () => {
  it('allows controller audio checks when Chromium reports an optional or unknown media type', () => {
    expect(allowAudioMediaCheck(true, 'media', 'audio')).toBe(true);
    expect(allowAudioMediaCheck(true, 'media', 'unknown')).toBe(true);
    expect(allowAudioMediaCheck(true, 'media')).toBe(true);
  });

  it('rejects video, non-controller windows, and unrelated permissions', () => {
    expect(allowAudioMediaCheck(true, 'media', 'video')).toBe(false);
    expect(allowAudioMediaCheck(false, 'media', 'audio')).toBe(false);
    expect(allowAudioMediaCheck(true, 'notifications', 'audio')).toBe(false);
    expect(allowAudioMediaRequest(true, 'media', ['audio'])).toBe(true);
    expect(allowAudioMediaRequest(true, 'media', [])).toBe(true);
    expect(allowAudioMediaRequest(true, 'media', ['audio', 'video'])).toBe(false);
  });
});
