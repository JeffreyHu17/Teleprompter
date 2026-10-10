import { anchorAt } from './session.js';
import type { BidirectionalScriptTracker } from './scriptTracker.js';
import type { SessionCommand, SessionState } from '../types/session.js';

export function speechFollowActive(state: Pick<SessionState, 'playbackMode' | 'microphoneEnabled'>): boolean {
  // AI listening is controlled by the microphone, not the fixed-speed play clock.
  return state.playbackMode === 'ai' && state.microphoneEnabled;
}

export function manualPositionCommand(command: Pick<SessionCommand, 'type'>): boolean {
  return ['navigatePage', 'navigateParagraph', 'rewindStep', 'seek', 'scrollStep'].includes(command.type);
}

export interface FollowTranscript {
  text?: string;
  isFinal?: boolean;
  confidence?: number;
  onDevice?: boolean;
}

/** One shared consumer path for desktop and mobile; never apply late results when off. */
export function transcriptCommands(
  state: SessionState,
  event: FollowTranscript,
  tracker: Pick<BidirectionalScriptTracker, 'match'>,
  now = Date.now(),
): SessionCommand[] {
  if (!speechFollowActive(state)) return [];
  const transcript = event.text?.trim() ?? '';
  if (!transcript) return [];
  const match = tracker.match(state.document, transcript, state.anchor.globalOffset, event.isFinal ?? false, now, state.tracking.rewindCharacters);
  const commands: SessionCommand[] = [{
    type: 'setTracker', status: 'listening', patch: {
      transcript, asrConfidence: event.confidence ?? null,
      matchConfidence: match?.confidence ?? null, direction: match?.direction ?? null,
      message: match ? null : '正在确认稿件位置', onDevice: event.onDevice ?? true,
    },
  }];
  if (match?.direction === 'backward') commands.push({ type: 'recordReread', event: {
    documentRevision: state.document.revision, fromOffset: state.anchor.globalOffset,
    toOffset: match.offset, observedAt: now, confidence: match.confidence,
    transcript, timeBasis: 'recognition-observation',
  } });
  if (match && match.direction !== 'hold') commands.push({ type: 'seek', anchor: anchorAt(state.document, match.offset) });
  return commands;
}
