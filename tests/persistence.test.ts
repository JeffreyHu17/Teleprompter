import { describe, expect, it } from 'vitest';
import { preferencesFromState, stateFromPreferences } from '../src/core/persistence';
import { initialSessionState, LEGACY_SAMPLE_TEXT, sessionReducer } from '../src/core/session';

describe('preference persistence', () => {
  it('restores the script and user-facing display settings without resuming playback', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'setDocument', name: '保存稿件', text: '持久化后的内容。' });
    state = sessionReducer(state, { type: 'setTypography', patch: { fontSize: 320, lineHeight: 3.5 } });
    state = sessionReducer(state, { type: 'setSpeed', speed: 900 });
    state = sessionReducer(state, { type: 'setPlaying', playing: true });
    state = sessionReducer(state, { type: 'setSpeechEngine', engine: 'funasr' });
    state = sessionReducer(state, { type: 'setSpeechInputDevice', deviceId: 'usb-microphone' });
    state = sessionReducer(state, { type: 'setMicrophoneProcessing', patch: { noiseSuppression: false, inputGain: 2.5 } });
    state = sessionReducer(state, { type: 'setFunAsrBackend', backend: 'cpu' });
    state = sessionReducer(state, { type: 'setFunAsrModel', model: 'paraformer-streaming-fp32' });
    const restored = stateFromPreferences(preferencesFromState(state));
    expect(restored.document.name).toBe('保存稿件');
    expect(restored.document.rawText).toBe('持久化后的内容。');
    expect(restored.typography.fontSize).toBe(320);
    expect(restored.typography.lineHeight).toBe(3.5);
    expect(restored.scrollSpeedPxPerSecond).toBe(900);
    expect(restored.isPlaying).toBe(false);
    expect(restored.trackerStatus).toBe('ready');
    expect(restored.speech.engine).toBe('funasr');
    expect(restored.speech.inputDeviceId).toBe('usb-microphone');
    expect(restored.microphoneProcessing.noiseSuppression).toBe(false);
    expect(restored.microphoneProcessing.inputGain).toBe(2.5);
    expect(restored.funasr.backend).toBe('cpu');
    expect(restored.funasr.model).toBe('paraformer-streaming-fp32');
    expect(restored.funasr.installStatus).toBe('not-installed');
  });

  it('migrates only the untouched legacy welcome script to the new default document', () => {
    const saved = preferencesFromState(initialSessionState());
    const restored = stateFromPreferences({
      ...saved,
      document: { name: '示例稿件', rawText: LEGACY_SAMPLE_TEXT },
    });
    expect(restored.document.name).toBe('荷塘月色');
    expect(restored.document.rawText).toContain('这几天心里颇不宁静');
    expect(restored.document.rawText).toContain('1927年7月，北京清华园。');
  });

  it('migrates the legacy Apple engine identifier to the shared system engine', () => {
    const saved = preferencesFromState(initialSessionState());
    const restored = stateFromPreferences({ ...saved, speechEngine: 'apple' });
    expect(restored.speech.engine).toBe('system');
  });
});

it('persists range settings and migrates older preferences', () => {
  const state = sessionReducer(initialSessionState(), { type: 'setTracking', patch: { rewindCharacters: 125, showRewindRangeOnDisplay: true } });
  expect(stateFromPreferences(preferencesFromState(state)).tracking).toEqual(state.tracking);
  const old = preferencesFromState(state);
  delete old.tracking;
  expect(stateFromPreferences(old).tracking.rewindCharacters).toBe(560);
  expect(sessionReducer(state, { type: 'setTracking', patch: { rewindCharacters: NaN } }).tracking.rewindCharacters).toBe(125);
});

it('keeps reread observations separate from saved settings and invalidates them on script edits', () => {
  let state = initialSessionState();
  const event = { documentRevision: state.document.revision, fromOffset: 80, toOffset: 20, observedAt: 1234, confidence: 0.9, transcript: '重新朗读', timeBasis: 'recognition-observation' as const };
  state = sessionReducer(state, { type: 'recordReread', event });
  expect(state.rereadEvents).toEqual([event]);
  expect(stateFromPreferences(preferencesFromState(state)).rereadEvents).toEqual([]);
  state = sessionReducer(state, { type: 'setDocument', name: '新稿', text: '不同稿件' });
  expect(sessionReducer(state, { type: 'recordReread', event }).rereadEvents).toEqual([]);
});
