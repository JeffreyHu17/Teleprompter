import { contextBridge, ipcRenderer } from 'electron';
import type { DisplayInfo, FunAsrModelId, ImportResult, MicrophoneProcessingSettings, SessionCommand, SessionState } from '../src/types/session.js';

const api = {
  getState: (): Promise<SessionState> => ipcRenderer.invoke('session:get'),
  command: (command: SessionCommand): void => ipcRenderer.send('session:command', command),
  subscribeState: (listener: (state: SessionState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SessionState) => listener(state);
    ipcRenderer.on('session:state', handler);
    return () => ipcRenderer.removeListener('session:state', handler);
  },
  listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('display:list'),
  subscribeDisplays: (listener: (displays: DisplayInfo[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, displays: DisplayInfo[]) => listener(displays);
    ipcRenderer.on('display:list', handler);
    return () => ipcRenderer.removeListener('display:list', handler);
  },
  toggleDisplay: (open?: boolean): void => ipcRenderer.send('display:toggle', open),
  importScript: (): Promise<ImportResult | null> => ipcRenderer.invoke('script:import'),
  openSpeechSettings: (engine: 'system' | 'funasr'): Promise<void> => ipcRenderer.invoke('speech:open-settings', engine),
  installFunAsr: (modelId?: FunAsrModelId, force?: boolean): Promise<void> => ipcRenderer.invoke('funasr:install', modelId, force),
  inspectFunAsr: (): Promise<boolean> => ipcRenderer.invoke('funasr:inspect'),
  deleteFunAsrModel: (modelId: FunAsrModelId): Promise<void> => ipcRenderer.invoke('funasr:delete-model', modelId),
  openFunAsrModels: (): Promise<string> => ipcRenderer.invoke('funasr:open-models'),
  submitSpeechSegment: (wav: ArrayBuffer, durationMs: number): Promise<void> => ipcRenderer.invoke('speech:submit-segment', wav, durationMs),
  submitSpeechChunk: (samples: ArrayBuffer): void => ipcRenderer.send('speech:submit-chunk', samples),
  updateInputLevel: (level: number): void => ipcRenderer.send('speech:input-level', level),
  reportSpeechCaptureReady: (deviceId: string | null, usedFallback: boolean): void => ipcRenderer.send('speech:capture-ready', deviceId, usedFallback),
  reportSpeechCaptureError: (message: string): void => ipcRenderer.send('speech:capture-error', message),
  reportSpeechCaptureWarning: (message: string): void => ipcRenderer.send('speech:capture-warning', message),
  subscribeSpeechCapture: (listener: (state: { enabled: boolean; mode: 'streaming' | 'segmented'; deviceId: string | null; processing: MicrophoneProcessingSettings }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { enabled: boolean; mode: 'streaming' | 'segmented'; deviceId: string | null; processing: MicrophoneProcessingSettings }) => listener(state);
    ipcRenderer.on('speech:capture', handler);
    return () => ipcRenderer.removeListener('speech:capture', handler);
  },
};

contextBridge.exposeInMainWorld('teleprompter', api);

export type TeleprompterApi = typeof api;
