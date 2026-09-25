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

export function dispatchBrowserCommand(command: SessionCommand, broadcast = true): void {
  const next = sessionReducer(state, command);
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener(state));

  if (!['tick', 'reportLayout', 'setTracker', 'setDisplayOpen', 'setPlaying', 'togglePlay', 'seek', 'scrollStep'].includes(command.type)) {
    schedulePersist();
  }

  if (broadcast && syncChannel && command.type !== 'tick') {
    try {
      syncChannel.postMessage({ type: 'command', command });
    } catch {
      // Ignore serialization issues
    }
  }
}

if (syncChannel) {
  syncChannel.onmessage = (event: MessageEvent<{ type: string; command?: SessionCommand }>) => {
    if (event.data?.type === 'command' && event.data.command) {
      dispatchBrowserCommand(event.data.command, false);
    }
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
