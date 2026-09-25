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
  const isElectron = typeof window !== 'undefined' && Boolean(window.teleprompter || navigator.userAgent.includes('Electron'));
  if (isElectron) {
    if (/Windows/i.test(navigator.userAgent)) return 'windows';
    return 'macos';
  }
  return 'browser';
}

export function platformCapabilities(platform = runtimePlatform()): PlatformCapabilities {
  const isDesktop = platform === 'macos' || platform === 'windows';
  return {
    platform,
    desktop: isDesktop,
    mobile: platform === 'android',
    systemSpeech: isDesktop || platform === 'android',
    funAsr: isDesktop,
    externalDisplay: isDesktop,
  };
}
