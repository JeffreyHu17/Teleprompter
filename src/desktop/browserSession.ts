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

export type BrowserSyncMessage =
  | { type: 'command'; command: SessionCommand }
  | { type: 'state'; state: SessionState };

const remoteSyncSenders = new Set<(message: BrowserSyncMessage) => void>();
let lastTick = performance.now();
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
  listeners.forEach((listener) => listener(state));
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
    const message: BrowserSyncMessage = { type: 'command', command };
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

function tick(now: number): void {
  const delta = now - lastTick;
  lastTick = now;
  const elapsedMs = delta > 100 ? 16 : Math.max(0, delta);
  if (state.isPlaying && state.playbackMode === 'fixed') dispatchBrowserCommand({ type: 'tick', elapsedMs });
  requestAnimationFrame(tick);
}

if (typeof window !== 'undefined') requestAnimationFrame(tick);
