import { describe, expect, it } from 'vitest';
import { initialSessionState } from '../src/core/session';
import {
  correctedPreviewOffset,
  normalizeRemoteFont,
  REMOTE_SANS_FONT,
  REMOTE_SERIF_FONT,
  remoteTypographyKey,
} from '../src/web/remote/previewParity';

describe('cross-device remote preview parity', () => {
  it('replaces platform-dependent system fonts with the hosted CJK font', () => {
    expect(normalizeRemoteFont('system-ui')).toBe(REMOTE_SANS_FONT);
    expect(normalizeRemoteFont('"PingFang SC", "Microsoft YaHei", system-ui')).toBe(REMOTE_SANS_FONT);
    expect(normalizeRemoteFont('"Dream Han Sans CN", system-ui')).toBe(REMOTE_SANS_FONT);
    expect(normalizeRemoteFont('"Dream Han Serif CN", serif')).toBe(REMOTE_SERIF_FONT);
  });

  it('invalidates position messages after a typography edit', () => {
    const state = initialSessionState('browser');
    const before = remoteTypographyKey(state.typography);
    expect(remoteTypographyKey({ ...state.typography, fontSize: state.typography.fontSize + 2 })).not.toBe(before);
    expect(remoteTypographyKey({ ...state.typography, fontWeight: 500 })).not.toBe(before);
    expect(remoteTypographyKey({ ...state.typography, fontFamily: REMOTE_SANS_FONT })).not.toBe(before);
  });

  it('corrects animation drift gently but aligns exactly when paused or far apart', () => {
    expect(correctedPreviewOffset(100, 101, true)).toBe(100);
    expect(correctedPreviewOffset(100, 120, true)).toBe(107);
    expect(correctedPreviewOffset(100, 220, true)).toBe(220);
    expect(correctedPreviewOffset(100, 106, false)).toBe(106);
  });
});
