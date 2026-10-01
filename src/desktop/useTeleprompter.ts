import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatchBrowserCommand, getBrowserState, subscribeBrowserState } from './browserSession';
import { sessionReducer } from '../core/session';
import type { DisplayInfo, FunAsrModelId, ImportResult, SessionCommand, SessionState } from '../types/session';
import { platformCapabilities, runtimePlatform } from './capabilities';
import { DesktopStreamingSpeechCapture } from './desktopStreamingSpeechCapture';
import { WindowsSpeechCapture } from './windowsSpeechCapture';

export function useTeleprompter() {
  const [state, setState] = useState<SessionState>(getBrowserState());
  const stateRef = useRef(state);
  stateRef.current = state;
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
    const offState = window.teleprompter.subscribeState((next) => {
      setState((current) => {
        if (
          current.isPlaying &&
          next.isPlaying &&
          current.playbackMode === 'fixed' &&
          next.playbackMode === 'fixed' &&
          current.document.revision === next.document.revision &&
          current.anchor.globalOffset === next.anchor.globalOffset
        ) {
          return {
            ...next,
            scrollOffsetPx: current.scrollOffsetPx,
          };
        }
        return next;
      });
    });
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

  useEffect(() => {
    if (!window.teleprompter) return;
    if (!state.isPlaying || state.playbackMode !== 'fixed') return;

    let animId: number;
    let lastTime = performance.now();
    const onFrame = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      const elapsedMs = delta > 100 ? 16 : Math.max(0, delta);
      setState((current) => sessionReducer(current, { type: 'tick', elapsedMs }));
      animId = requestAnimationFrame(onFrame);
    };
    animId = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(animId);
  }, [state.isPlaying, state.playbackMode]);

  const command = useCallback((next: SessionCommand) => {
    if (window.teleprompter) {
      const enriched = {
        ...next,
        ...(next.type === 'togglePlay' || next.type === 'setPlaying' ? { scrollOffsetPx: next.scrollOffsetPx ?? stateRef.current.scrollOffsetPx } : {}),
        currentScrollOffsetPx: stateRef.current.scrollOffsetPx,
      };
      setState((current) => sessionReducer(current, enriched as SessionCommand));
      window.teleprompter.command(enriched as SessionCommand);
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
