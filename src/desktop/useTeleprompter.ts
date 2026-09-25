import { useCallback, useEffect, useState } from 'react';
import { dispatchBrowserCommand, getBrowserState, subscribeBrowserState } from './browserSession';
import { sessionReducer } from '../core/session';
import type { DisplayInfo, FunAsrModelId, ImportResult, SessionCommand, SessionState } from '../types/session';
import { platformCapabilities, runtimePlatform } from './capabilities';
import { DesktopStreamingSpeechCapture } from './desktopStreamingSpeechCapture';
import { WindowsSpeechCapture } from './windowsSpeechCapture';

export function useTeleprompter() {
  const [state, setState] = useState<SessionState>(getBrowserState());
  const [displays, setDisplays] = useState<DisplayInfo[]>([
    { id: 'browser', label: '浏览器预览', width: window.innerWidth, height: window.innerHeight, scaleFactor: 1, primary: true },
  ]);
  const [audioInputs, setAudioInputs] = useState<Array<{ deviceId: string; label: string }>>([]);

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `麦克风 ${index + 1}` })));
    } catch (error) {
      console.error('Unable to enumerate audio input devices', error);
    }
  }, []);

  useEffect(() => {
    if (!window.teleprompter) return subscribeBrowserState(setState);
    void window.teleprompter.getState().then(setState);
    void window.teleprompter.listDisplays().then(setDisplays);
    const offState = window.teleprompter.subscribeState(setState);
    const offDisplays = window.teleprompter.subscribeDisplays(setDisplays);
    return () => {
      offState();
      offDisplays();
    };
  }, []);

  useEffect(() => {
    void refreshAudioInputs();
    const handleDeviceChange = () => void refreshAudioInputs();
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshAudioInputs]);

  useEffect(() => {
    if (!window.teleprompter || !platformCapabilities().desktop) return;
    let capture: DesktopStreamingSpeechCapture | WindowsSpeechCapture | null = null;
    const stopCapture = async () => {
      const current = capture;
      capture = null;
      await current?.stop();
    };
    const off = window.teleprompter.subscribeSpeechCapture(({ enabled, mode, deviceId, processing }) => {
      if (!enabled) {
        void stopCapture();
        return;
      }
      if (capture) {
        void capture.updateProcessing(processing);
        return;
      }
      if (mode === 'segmented') {
        if (runtimePlatform() !== 'windows') return;
        capture = new WindowsSpeechCapture({
          onLevel: (level) => window.teleprompter?.updateInputLevel(level),
          onSegment: async (wav, durationMs) => window.teleprompter?.submitSpeechSegment(wav, durationMs),
          onError: (message) => window.teleprompter?.reportSpeechCaptureError(message),
          onWarning: (message) => window.teleprompter?.reportSpeechCaptureWarning(message),
        }, deviceId, processing);
      } else {
        capture = new DesktopStreamingSpeechCapture({
          onLevel: (level) => window.teleprompter?.updateInputLevel(level),
          onChunk: (samples) => window.teleprompter?.submitSpeechChunk(samples),
          onReady: (deviceId, usedFallback) => window.teleprompter?.reportSpeechCaptureReady(deviceId, usedFallback),
          onError: (message) => window.teleprompter?.reportSpeechCaptureError(message),
          onWarning: (message) => window.teleprompter?.reportSpeechCaptureWarning(message),
        }, deviceId, processing);
      }
      void capture.start().then(refreshAudioInputs);
    });
    return () => {
      off();
      void stopCapture();
    };
  }, [refreshAudioInputs]);

  const command = useCallback((next: SessionCommand) => {
    if (window.teleprompter) {
      setState((current) => sessionReducer(current, next));
      window.teleprompter.command(next);
      return;
    }
    dispatchBrowserCommand(next);
  }, []);

  const toggleDisplay = useCallback((open?: boolean) => {
    if (window.teleprompter) window.teleprompter.toggleDisplay(open);
    else window.open(`${window.location.pathname}?view=display`, 'teleprompter-display', 'popup,width=1280,height=720');
  }, []);

  const importScript = useCallback(async (): Promise<ImportResult | null> => {
    if (window.teleprompter) return window.teleprompter.importScript();
    return null;
  }, []);

  const openSpeechSettings = useCallback(async (engine: 'system' | 'funasr') => {
    await window.teleprompter?.openSpeechSettings(engine);
  }, []);

  const installFunAsr = useCallback(async (modelId?: FunAsrModelId, force?: boolean) => {
    await window.teleprompter?.installFunAsr(modelId, force);
  }, []);

  const inspectFunAsr = useCallback(async () => {
    await window.teleprompter?.inspectFunAsr();
  }, []);

  const openFunAsrModels = useCallback(async () => {
    await window.teleprompter?.openFunAsrModels();
  }, []);

  const deleteFunAsrModel = useCallback(async (modelId: FunAsrModelId) => {
    await window.teleprompter?.deleteFunAsrModel(modelId);
  }, []);

  return { state, displays, audioInputs, refreshAudioInputs, command, toggleDisplay, importScript, openSpeechSettings, installFunAsr, inspectFunAsr, openFunAsrModels, deleteFunAsrModel };
}
