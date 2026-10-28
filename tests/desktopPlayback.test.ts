import { describe, expect, it } from 'vitest';
import { projectDesktopPlayback } from '../src/core/desktopPlayback';
import { anchorAt, createDocument, initialSessionState, sessionReducer } from '../src/core/session';

describe('authoritative playback and AI navigation', () => {
  function playingState() {
    const state = initialSessionState();
    return { ...state, isPlaying: true, playbackUpdatedAt: 1000, layout: {
      revision: 1, documentRevision: state.document.revision, viewportWidth: 1280, viewportHeight: 720,
      documentHeight: 5000, textWidthPx: 1000, pageCount: 1, pageAnchors: [state.anchor], pageScrollOffsets: [0], paragraphScrollOffsets: [0],
    } };
  }
  it('restores the same position in new or suspended renderers', () => {
    const state = playingState();
    expect(projectDesktopPlayback(state, 3000).scrollOffsetPx).toBe(60);
    expect(projectDesktopPlayback({ ...state }, 3000).scrollOffsetPx).toBe(60);
    expect(state.scrollOffsetPx).toBe(0);
  });
  it('does not extrapolate paused states or negative clock deltas', () => {
    const state = playingState();
    expect(projectDesktopPlayback({ ...state, isPlaying: false }, 3000).scrollOffsetPx).toBe(0);
    expect(projectDesktopPlayback(state, 500).scrollOffsetPx).toBe(0);
  });
  it('stops exactly at the document end', () => {
    const state = playingState();
    const end = projectDesktopPlayback(state, 1_000_000);
    expect(end.isPlaying).toBe(false);
    expect(end.scrollOffsetPx).toBe(state.layout.documentHeight - state.typography.fontSize * state.typography.lineHeight);
  });
  it('uses the current AI anchor for forward and backward pages', () => {
    const document = createDocument('test', 'a'.repeat(1000));
    const state = { ...initialSessionState(), document, playbackMode: 'ai' as const, anchor: anchorAt(document, 600), layout: {
      revision: 1, documentRevision: document.revision, viewportWidth: 1280, viewportHeight: 720,
      documentHeight: 4000, textWidthPx: 1000, pageCount: 5, pageScrollOffsets: [0,800,1600,2400,3200],
      pageAnchors: [0,200,400,600,800].map((n) => anchorAt(document,n)), paragraphScrollOffsets: [0],
    } };
    expect(sessionReducer(state, { type: 'navigatePage', direction: 1 }).anchor.globalOffset).toBe(800);
    expect(sessionReducer(state, { type: 'navigatePage', direction: -1 }).anchor.globalOffset).toBe(400);
  });
});
