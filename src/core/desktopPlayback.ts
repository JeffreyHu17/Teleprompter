import { sessionReducer } from './session.js';
import type { SessionState } from '../types/session.js';

/** Render between authoritative main-process updates, including after suspension. */
export function projectDesktopPlayback(state: SessionState, now: number): SessionState {
  if (!state.playbackUpdatedAt || !state.isPlaying || state.playbackMode !== 'fixed') return state;
  return sessionReducer(state, { type: 'tick', elapsedMs: Math.max(0, now - state.playbackUpdatedAt) });
}
