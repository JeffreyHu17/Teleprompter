import type { TeleprompterApi } from '../../electron/preload';

declare global {
  interface ImportMetaEnv {
    readonly VITE_TARGET?: 'desktop' | 'android';
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    teleprompter?: TeleprompterApi;
    __teleprompterTestAudio?: unknown;
  }
}

export {};
