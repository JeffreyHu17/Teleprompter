import type { SessionState } from '../../types/session';

// Web-only remote mode uses the same hosted font files on both devices.
// Platform system-ui falls back to different CJK faces on iPadOS and Android.
export const REMOTE_SANS_FONT = '"Dream Han Sans CN", sans-serif';
export const REMOTE_SERIF_FONT = '"Dream Han Serif CN", serif';

export const REMOTE_FONT_OPTIONS = [
  { value: REMOTE_SANS_FONT, label: '梦源黑体（跨设备一致）' },
  { value: REMOTE_SERIF_FONT, label: '梦源宋体（跨设备一致）' },
] as const;

export function normalizeRemoteFont(fontFamily: string): string {
  if (fontFamily.includes('Dream Han Serif CN')) return REMOTE_SERIF_FONT;
  return REMOTE_SANS_FONT;
}

export function remoteTypographyKey(typography: SessionState['typography']): string {
  return JSON.stringify([
    typography.fontFamily,
    typography.fontSize,
    typography.fontWeight,
    typography.lineHeight,
    typography.paragraphSpacing,
    typography.sidePadding,
    typography.focusPosition,
    typography.alignment,
  ]);
}

/**
 * The display is the visual authority. Correct the controller toward its
 * actual position, without forcing the controller to jump on minor RAF drift.
 * When paused the exact display offset should always be used.
 */
export function correctedPreviewOffset(local: number, remote: number, playing: boolean): number {
  const difference = remote - local;
  if (!playing || Math.abs(difference) >= 120) return remote;
  if (Math.abs(difference) < 2) return local;
  return local + difference * 0.35;
}
