export type MirrorMode = 'none' | 'horizontal' | 'vertical' | 'both';
export type PlaybackMode = 'fixed' | 'ai';
export type SpeechEngine = 'system' | 'funasr';
export type FunAsrBackend = 'auto' | 'cuda' | 'vulkan' | 'cpu';
export type FunAsrModelId = 'paraformer-streaming-int8' | 'paraformer-streaming-fp32';

export interface MicrophoneProcessingSettings {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputGain: number;
}

export interface FunAsrModelState {
  id: FunAsrModelId;
  name: string;
  variant: string;
  description: string;
  sizeBytes: number;
  status: 'not-installed' | 'checking' | 'downloading' | 'installed' | 'update-available' | 'error';
  progress: number;
  installedVersion: string | null;
  availableVersion: string;
  message: string | null;
}

export interface Paragraph {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface ScriptDocument {
  name: string;
  revision: number;
  rawText: string;
  paragraphs: Paragraph[];
  totalCharacters: number;
}

export interface ScriptAnchor {
  paragraphId: string;
  paragraphIndex: number;
  charOffset: number;
  globalOffset: number;
}

export interface TypographySettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  paragraphSpacing: number;
  sidePadding: number;
  alignment: 'left' | 'center' | 'right';
  foreground: string;
  background: string;
  focusColor: string;
  focusPosition: number;
  focusOpacity: number;
}

export interface DisplayInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export interface SpeechTrackerState {
  engine: SpeechEngine;
  locale: string;
  inputDeviceId: string | null;
  onDevice: boolean;
  transcript: string;
  asrConfidence: number | null;
  matchConfidence: number | null;
  direction: 'forward' | 'backward' | 'hold' | null;
  message: string | null;
  inputLevel: number;
}

export interface FunAsrState {
  installStatus: 'not-installed' | 'checking' | 'downloading' | 'installing' | 'ready' | 'error';
  installProgress: number;
  backend: FunAsrBackend;
  availableBackends: Array<Exclude<FunAsrBackend, 'auto'>>;
  resolvedBackend: Exclude<FunAsrBackend, 'auto'> | null;
  model: FunAsrModelId;
  models: FunAsrModelState[];
  queuedSegments: number;
  lastLatencyMs: number | null;
  message: string | null;
}

export interface LayoutReport {
  revision: number;
  documentRevision: number;
  pageAnchors: ScriptAnchor[];
  pageCount: number;
  viewportWidth: number;
  viewportHeight: number;
  documentHeight: number;
  textWidthPx: number;
  pageScrollOffsets: number[];
  paragraphScrollOffsets: number[];
}

export interface RereadEvent {
  documentRevision: number;
  fromOffset: number;
  toOffset: number;
  observedAt: number;
  confidence: number;
  transcript: string;
  timeBasis: 'recognition-observation';
}

export interface TrackingSettings {
  rewindCharacters: number;
  showRewindRange: boolean;
  showRewindRangeOnDisplay: boolean;
}

export interface SessionState {
  tracking: TrackingSettings;
  rereadEvents: RereadEvent[];
  revision: number;
  document: ScriptDocument;
  anchor: ScriptAnchor;
  isPlaying: boolean;
  scrollOffsetPx: number;
  playbackMode: PlaybackMode;
  microphoneEnabled: boolean;
  microphoneProcessing: MicrophoneProcessingSettings;
  scrollSpeedPxPerSecond: number;
  mirrorMode: MirrorMode;
  typography: TypographySettings;
  selectedDisplayId: string | null;
  displayOpen: boolean;
  layout: LayoutReport | null;
  trackerStatus: 'idle' | 'ready' | 'listening' | 'paused' | 'lost';
  speech: SpeechTrackerState;
  funasr: FunAsrState;
}

export type SessionCommand =
  | { type: 'recordReread'; event: RereadEvent }
  | { type: 'setTracking'; patch: Partial<TrackingSettings> }
  | { type: 'setDocument'; name: string; text: string }
  | { type: 'togglePlay' }
  | { type: 'setPlaying'; playing: boolean }
  | { type: 'setMode'; mode: PlaybackMode }
  | { type: 'setMicrophoneEnabled'; enabled: boolean }
  | { type: 'setMicrophoneProcessing'; patch: Partial<MicrophoneProcessingSettings> }
  | { type: 'setSpeechEngine'; engine: SpeechEngine }
  | { type: 'setSpeechInputDevice'; deviceId: string | null }
  | { type: 'setFunAsrBackend'; backend: FunAsrBackend }
  | { type: 'setFunAsrModel'; model: FunAsrModelId }
  | { type: 'setFunAsrState'; patch: Partial<FunAsrState> }
  | { type: 'adjustSpeed'; delta: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'navigatePage'; direction: -1 | 1 }
  | { type: 'navigateParagraph'; direction: -1 | 1 }
  | { type: 'rewindStep' }
  | { type: 'seek'; anchor: ScriptAnchor }
  | { type: 'setMirror'; mode: MirrorMode }
  | { type: 'setTypography'; patch: Partial<TypographySettings> }
  | { type: 'setDisplay'; displayId: string | null }
  | { type: 'setDisplayOpen'; open: boolean }
  | { type: 'setTracker'; status: SessionState['trackerStatus']; patch?: Partial<SpeechTrackerState> }
  | { type: 'reportLayout'; layout: LayoutReport }
  | { type: 'tick'; elapsedMs: number };

export interface ImportResult {
  name: string;
  text: string;
}
