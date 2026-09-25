export type RuntimePlatform = 'macos' | 'windows' | 'android' | 'browser';

export interface PlatformCapabilities {
  platform: RuntimePlatform;
  desktop: boolean;
  mobile: boolean;
  systemSpeech: boolean;
  funAsr: boolean;
  externalDisplay: boolean;
}

export function runtimePlatform(): RuntimePlatform {
  if (import.meta.env.VITE_TARGET === 'android') return 'android';
  if (/Windows/i.test(navigator.userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return 'macos';
  return 'browser';
}

export function platformCapabilities(platform = runtimePlatform()): PlatformCapabilities {
  return {
    platform,
    desktop: platform === 'macos' || platform === 'windows',
    mobile: platform === 'android',
    systemSpeech: platform === 'macos' || platform === 'windows' || platform === 'android',
    funAsr: platform === 'macos' || platform === 'windows',
    externalDisplay: platform === 'macos' || platform === 'windows',
  };
}
