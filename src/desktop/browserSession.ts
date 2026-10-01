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

export type BrowserCommandSyncMessage = { type: 'command'; id: string; command: SessionCommand };

export type BrowserSyncMessage =
  | BrowserCommandSyncMessage
  | { type: 'state'; state: SessionState };

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
  return { type: 'command', id, command };
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

if (syncChannel) {
  syncChannel.onmessage = (event: MessageEvent<BrowserSyncMessage>) => {
    if (event.data?.type === 'command') receiveBrowserSyncMessage(event.data);
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
  const elapsedMs = delta > 100 ? 16 : Math.max(0, delta);
  if (shouldTick()) dispatchBrowserCommand({ type: 'tick', elapsedMs });
  if (tickFrame !== activeFrame || tickFrame === null) return;
  tickFrame = shouldTick() ? requestAnimationFrame(tick) : null;
}

updatePlaybackClock();
