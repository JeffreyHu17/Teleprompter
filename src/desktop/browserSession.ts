import { initialSessionState, sessionReducer } from '../core/session';
import type { SessionCommand, SessionState } from '../types/session';
import { runtimePlatform } from './capabilities';

let state = initialSessionState(runtimePlatform());
const listeners = new Set<(next: SessionState) => void>();
let lastTick = performance.now();

export function getBrowserState(): SessionState {
  return state;
}

export function dispatchBrowserCommand(command: SessionCommand): void {
  const next = sessionReducer(state, command);
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener(state));
}

export function subscribeBrowserState(listener: (next: SessionState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function tick(now: number): void {
  const elapsedMs = Math.min(250, now - lastTick);
  lastTick = now;
  if (state.isPlaying && state.playbackMode === 'fixed') dispatchBrowserCommand({ type: 'tick', elapsedMs });
  requestAnimationFrame(tick);
}

if (typeof window !== 'undefined') requestAnimationFrame(tick);
