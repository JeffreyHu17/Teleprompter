import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface AndroidSpeechEvent {
  type: 'status' | 'transcript' | 'level' | 'error';
  status?: string;
  text?: string;
  isFinal?: boolean;
  confidence?: number;
  level?: number;
  message?: string;
  onDevice?: boolean;
}

interface AndroidSpeechPlugin {
  availability(): Promise<{ available: boolean; onDevice: boolean }>;
  start(options: { locale: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(eventName: 'speechEvent', listener: (event: AndroidSpeechEvent) => void): Promise<PluginListenerHandle>;
}

export const AndroidSpeech = registerPlugin<AndroidSpeechPlugin>('AndroidSpeech');
