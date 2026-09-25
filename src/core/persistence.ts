import { createDocument, initialSessionState, LEGACY_SAMPLE_TEXT } from './session.js';
import type { FunAsrBackend, FunAsrModelId, MicrophoneProcessingSettings, MirrorMode, SessionState, SpeechEngine, TypographySettings } from '../types/session.js';

export interface PersistedPreferences {
  tracking?: SessionState['tracking'];
  version: 1;
  document: { name: string; rawText: string };
  scrollSpeedPxPerSecond: number;
  mirrorMode: MirrorMode;
  typography: TypographySettings;
  selectedDisplayId: string | null;
  microphoneEnabled: boolean;
  microphoneProcessing?: MicrophoneProcessingSettings;
  speechEngine: SpeechEngine;
  speechInputDeviceId?: string | null;
  funasrBackend: FunAsrBackend;
  funasrModel: FunAsrModelId;
}

export function preferencesFromState(state: SessionState): PersistedPreferences {
  return {
    tracking: state.tracking,
    version: 1,
    document: { name: state.document.name, rawText: state.document.rawText },
    scrollSpeedPxPerSecond: state.scrollSpeedPxPerSecond,
    mirrorMode: state.mirrorMode,
    typography: state.typography,
    selectedDisplayId: state.selectedDisplayId,
    microphoneEnabled: state.microphoneEnabled,
    microphoneProcessing: state.microphoneProcessing,
    speechEngine: state.speech.engine,
    speechInputDeviceId: state.speech.inputDeviceId,
    funasrBackend: state.funasr.backend,
    funasrModel: state.funasr.model,
  };
}

export function stateFromPreferences(value: unknown): SessionState {
  const fallback = initialSessionState();
  if (!value || typeof value !== 'object') return fallback;
  const saved = value as Partial<PersistedPreferences>;
  if (saved.version !== 1 || !saved.document?.rawText || !saved.document.name) return fallback;
  const legacyDefault = saved.document.name === '示例稿件' && saved.document.rawText.trim() === LEGACY_SAMPLE_TEXT;
  const document = legacyDefault ? fallback.document : createDocument(saved.document.name, saved.document.rawText);
  const savedTypography = saved.typography as (Partial<TypographySettings> & { textWidth?: number }) | undefined;
  const migratedSidePadding = savedTypography?.sidePadding
    ?? (typeof savedTypography?.textWidth === 'number' ? Math.round(1280 * (100 - savedTypography.textWidth) / 200) : fallback.typography.sidePadding);
  return {
    ...fallback,
    tracking: {
      rewindCharacters: Number.isFinite(saved.tracking?.rewindCharacters) ? Math.max(0, Math.min(2000, Math.round(saved.tracking!.rewindCharacters))) : fallback.tracking.rewindCharacters,
      showRewindRange: typeof saved.tracking?.showRewindRange === 'boolean' ? saved.tracking.showRewindRange : true,
      showRewindRangeOnDisplay: saved.tracking?.showRewindRangeOnDisplay === true,
    },
    document,
    anchor: { paragraphId: document.paragraphs[0].id, paragraphIndex: 0, charOffset: 0, globalOffset: 0 },
    scrollSpeedPxPerSecond: typeof saved.scrollSpeedPxPerSecond === 'number' ? saved.scrollSpeedPxPerSecond : fallback.scrollSpeedPxPerSecond,
    mirrorMode: saved.mirrorMode ?? fallback.mirrorMode,
    typography: { ...fallback.typography, ...savedTypography, sidePadding: migratedSidePadding },
    selectedDisplayId: saved.selectedDisplayId ?? null,
    microphoneEnabled: saved.microphoneEnabled ?? fallback.microphoneEnabled,
    microphoneProcessing: {
      ...fallback.microphoneProcessing,
      ...saved.microphoneProcessing,
      inputGain: Math.max(0, Math.min(8, saved.microphoneProcessing?.inputGain ?? fallback.microphoneProcessing.inputGain)),
    },
    speech: {
      ...fallback.speech,
      engine: normalizeSpeechEngine(saved.speechEngine),
      inputDeviceId: typeof saved.speechInputDeviceId === 'string' ? saved.speechInputDeviceId : null,
    },
    funasr: {
      ...fallback.funasr,
      backend: saved.funasrBackend ?? fallback.funasr.backend,
      model: isFunAsrModelId(saved.funasrModel) ? saved.funasrModel : fallback.funasr.model,
    },
  };
}

function normalizeSpeechEngine(value: unknown): SpeechEngine {
  if (value === 'funasr') return 'funasr';
  if (value === 'system' || value === 'apple') return 'system';
  return 'system';
}

function isFunAsrModelId(value: unknown): value is FunAsrModelId {
  return value === 'paraformer-streaming-int8' || value === 'paraformer-streaming-fp32';
}
