import { initialSessionState, sessionReducer } from '../core/session';
import { preferencesFromState, stateFromPreferences } from '../core/persistence';
import type { SessionCommand, SessionState } from '../types/session';
import { runtimePlatform } from './capabilities';

const STORAGE_KEY = 'teleprompter_web_preferences';
const SYNC_CHANNEL_NAME = 'teleprompter_web_sync';

function loadInitialState(): SessionState {
  const fallback = initialSessionState(runtimePlatform());
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return stateFromPreferences(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

let state = loadInitialState();
const listeners = new Set<(next: SessionState) => void>();

export type BrowserCommandSyncMessage = { type: 'command'; id: string; command: SessionCommand; source?: 'display' };

export type BrowserSyncMessage =
  | BrowserCommandSyncMessage
  | { type: 'state'; state: SessionState };

type LocalSyncMessage =
  | BrowserSyncMessage
  | { type: 'local-display-hello'; id: string }
  | { type: 'local-display-pulse'; id: string; documentRevision: number; playing: boolean; scrollOffsetPx: number }
  | { type: 'local-display-bye'; id: string };

let localDisplayId: string | null = null;
let activeLocalDisplayId: string | null = null;
let lastLocalDisplayPulse = 0;

function isLocalController(): boolean {
  if (typeof window === 'undefined' || window.teleprompter) return false;
  const params = new URLSearchParams(window.location?.search ?? '');
  return params.get('view') !== 'display' && !params.has('mode');
}

export function isBrowserLocalDisplayActive(): boolean {
  return activeLocalDisplayId !== null && Date.now() - lastLocalDisplayPulse < 5000;
}

function sameDisplayLayoutInputs(a: SessionState, b: SessionState): boolean {
  if (a.document.revision !== b.document.revision || a.document.rawText !== b.document.rawText) return false;
  const x = a.typography;
  const y = b.typography;
  return x.fontFamily === y.fontFamily && x.fontSize === y.fontSize
    && x.fontWeight === y.fontWeight && x.lineHeight === y.lineHeight
    && x.paragraphSpacing === y.paragraphSpacing && x.sidePadding === y.sidePadding
    && x.alignment === y.alignment && x.focusPosition === y.focusPosition;
}

const seenSyncMessages = new Set<string>();
const remoteSyncSenders = new Set<(message: BrowserSyncMessage) => void>();
let lastTick = 0;
let tickFrame: number | null = null;
let persistTimeout: ReturnType<typeof setTimeout> | null = null;

const syncChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(SYNC_CHANNEL_NAME)
  : null;

function schedulePersist(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferencesFromState(state)));
    } catch {
      // Ignore quota errors
    }
  }, 300);
}

export function getBrowserState(): SessionState {
  return state;
}

function publishState(next: SessionState): void {
  state = next;
  updatePlaybackClock();
  listeners.forEach((listener) => listener(state));
}

export function createBrowserSyncCommand(command: SessionCommand): BrowserCommandSyncMessage {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { type: 'command', id, command, ...(localDisplayId ? { source: 'display' as const } : {}) };
}

function rememberSyncMessage(id: string): boolean {
  if (seenSyncMessages.has(id)) return false;
  seenSyncMessages.add(id);
  if (seenSyncMessages.size > 512) {
    const oldest = seenSyncMessages.values().next().value;
    if (oldest) seenSyncMessages.delete(oldest);
  }
  return true;
}

export function registerBrowserSyncTransport(send: (message: BrowserSyncMessage) => void): () => void {
  remoteSyncSenders.add(send);
  return () => remoteSyncSenders.delete(send);
}

export function receiveBrowserSyncMessage(message: BrowserSyncMessage): void {
  if (message.type === 'state') {
    publishState(message.state);
    return;
  }
  if (!rememberSyncMessage(message.id)) return;
  dispatchBrowserCommand(message.command, false);
}

export function dispatchBrowserCommand(command: SessionCommand, broadcast = true): void {
  const next = sessionReducer(state, command);
  if (next === state) return;
  publishState(next);

  if (!['tick', 'reportLayout', 'setTracker', 'setDisplayOpen', 'setPlaying', 'togglePlay', 'seek', 'scrollStep', 'setFocusAdjusting'].includes(command.type)) {
    schedulePersist();
  }

  if (broadcast && command.type !== 'tick') {
    const message = createBrowserSyncCommand(command);
    rememberSyncMessage(message.id);
    if (syncChannel) {
      try {
        syncChannel.postMessage(message);
      } catch {
        // Ignore serialization issues
      }
    }
    remoteSyncSenders.forEach((send) => {
      try {
        send(message);
      } catch {
        // Ignore transport errors; connection UI owns recovery.
      }
    });
  }
}

/**
 * One-device Web display requests the controller's live snapshot after opening.
 * The display, not the scaled controller preview, owns the measured geometry.
 */
export function startBrowserLocalDisplaySync(): () => void {
  if (!syncChannel || typeof window === 'undefined' || window.teleprompter) return () => {};
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : `local-${Date.now()}-${Math.random()}`;
  localDisplayId = id;
  syncChannel.postMessage({ type: 'local-display-hello', id } satisfies LocalSyncMessage);
  const pulse = () => {
    const current = getBrowserState();
    syncChannel.postMessage({
      type: 'local-display-pulse',
      id,
      documentRevision: current.document.revision,
      playing: current.isPlaying,
      scrollOffsetPx: current.scrollOffsetPx,
    } satisfies LocalSyncMessage);
  };
  const timer = window.setInterval(pulse, 1000);
  return () => {
    window.clearInterval(timer);
    syncChannel.postMessage({ type: 'local-display-bye', id } satisfies LocalSyncMessage);
    if (localDisplayId === id) localDisplayId = null;
  };
}

if (syncChannel) {
  syncChannel.onmessage = (event: MessageEvent<LocalSyncMessage & { target?: string }>) => {
    const message = event.data;
    if (!message) return;
    if (message.type === 'local-display-hello' && isLocalController()) {
      activeLocalDisplayId = message.id;
      lastLocalDisplayPulse = Date.now();
      syncChannel.postMessage({ type: 'state', state, target: message.id });
      return;
    }
    if (message.type === 'local-display-bye' && isLocalController()) {
      if (activeLocalDisplayId === message.id) activeLocalDisplayId = null;
      return;
    }
    if (message.type === 'local-display-pulse' && isLocalController()) {
      if (activeLocalDisplayId !== message.id) return;
      lastLocalDisplayPulse = Date.now();
      if (!state.layout || state.document.revision !== message.documentRevision
        || state.isPlaying !== message.playing || !Number.isFinite(message.scrollOffsetPx)) return;
      const difference = message.scrollOffsetPx - state.scrollOffsetPx;
      const nextOffset = !state.isPlaying || Math.abs(difference) >= 120
        ? message.scrollOffsetPx : Math.abs(difference) < 2
          ? state.scrollOffsetPx : state.scrollOffsetPx + difference * 0.35;
      if (Math.abs(nextOffset - state.scrollOffsetPx) >= 0.5) {
        dispatchBrowserCommand({ type: 'setPlaying', playing: state.isPlaying, scrollOffsetPx: nextOffset }, false);
      }
      return;
    }
    if (message.type === 'state' && localDisplayId && message.target === localDisplayId) {
      const ownLayout = state.layout && sameDisplayLayoutInputs(state, message.state) ? state.layout : null;
      publishState({ ...message.state, layout: ownLayout });
      if (ownLayout) {
        syncChannel.postMessage(createBrowserSyncCommand({ type: 'reportLayout', layout: ownLayout }));
      }
      return;
    }
    if (message.type === 'command') {
      // Only the actual display may set geometry when the local output is active.
      if (message.command.type === 'reportLayout') {
        if (localDisplayId) return;
        if (isLocalController() && message.source !== 'display') return;
      }
      receiveBrowserSyncMessage(message);
    }
  };
}

export function subscribeBrowserState(listener: (next: SessionState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function shouldTick(): boolean {
  return state.isPlaying && state.playbackMode === 'fixed' && Boolean(state.layout);
}

function updatePlaybackClock(): void {
  if (typeof window === 'undefined') return;
  if (!shouldTick()) {
    if (tickFrame !== null) cancelAnimationFrame(tickFrame);
    tickFrame = null;
    return;
  }
  if (tickFrame === null) {
    lastTick = performance.now();
    tickFrame = requestAnimationFrame(tick);
  }
}

function tick(now: number): void {
  // Keep the current frame marked active while publishing: a subscriber can
  // pause or restart playback synchronously without creating a second clock.
  const activeFrame = tickFrame;
  const delta = now - lastTick;
  lastTick = now;
  const elapsedMs = Math.max(0, delta);
  if (shouldTick()) dispatchBrowserCommand({ type: 'tick', elapsedMs });
  if (tickFrame !== activeFrame || tickFrame === null) return;
  tickFrame = shouldTick() ? requestAnimationFrame(tick) : null;
}

updatePlaybackClock();
