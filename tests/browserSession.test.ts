import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutReport } from '../src/types/session';

let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let now: number;
let session: typeof import('../src/desktop/browserSession');
const layout = (): LayoutReport => ({
  revision: 1, documentRevision: session.getBrowserState().document.revision,
  pageAnchors: [session.getBrowserState().anchor], pageCount: 1,
  viewportWidth: 1280, viewportHeight: 720, documentHeight: 5000, textWidthPx: 1000,
  pageScrollOffsets: [0], paragraphScrollOffsets: [0],
});

function frame(elapsed = 16) {
  now += elapsed;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(now));
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  frames = new Map(); frameId = 0; now = 0;
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: vi.fn() } });
  vi.stubGlobal('navigator', { userAgent: 'test browser' });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback); return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  session = await import('../src/desktop/browserSession');
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser playback clock', () => {
  it('schedules no animation work while paused or waiting for layout', () => {
    expect(frames.size).toBe(0);
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    expect(frames.size).toBe(0);
    session.dispatchBrowserCommand({ type: 'reportLayout', layout: layout() });
    expect(frames.size).toBe(1);
    frame();
    expect(session.getBrowserState().scrollOffsetPx).toBeCloseTo(0.48);
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: false });
    expect(frames.size).toBe(0);
    const requests = vi.mocked(requestAnimationFrame).mock.calls.length;
    for (let i = 0; i < 600; i++) frame();
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(requests);
  });

  it('keeps one clock on repeated updates and restarts from resume time', () => {
    session.dispatchBrowserCommand({ type: 'reportLayout', layout: layout() });
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    for (let i = 0; i < 20; i++) session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    expect(frames.size).toBe(1);
    frame();
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: false });
    now += 80;
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    frame();
    expect(session.getBrowserState().scrollOffsetPx).toBeCloseTo(0.96);
    expect(frames.size).toBe(1);
  });

  it('stops in AI mode and at the end of a script', () => {
    session.dispatchBrowserCommand({ type: 'reportLayout', layout: layout() });
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    session.dispatchBrowserCommand({ type: 'setMode', mode: 'ai' });
    expect(frames.size).toBe(0);
    session.dispatchBrowserCommand({ type: 'setMode', mode: 'fixed' });
    session.dispatchBrowserCommand({ type: 'reportLayout', layout: { ...layout(), documentHeight: 90 } });
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    frame(100);
    frame(100);
    expect(session.getBrowserState().isPlaying).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('starts and stops on remote snapshots without echoing ticks', () => {
    const sender = vi.fn();
    session.registerBrowserSyncTransport(sender);
    session.receiveBrowserSyncMessage({ type: 'state', state: { ...session.getBrowserState(), layout: layout(), isPlaying: true } });
    expect(frames.size).toBe(1);
    frame();
    expect(sender).not.toHaveBeenCalled();
    session.receiveBrowserSyncMessage({ type: 'state', state: { ...session.getBrowserState(), isPlaying: false } });
    expect(frames.size).toBe(0);
  });

  it('does not duplicate clocks when a subscriber pauses and resumes during a tick', () => {
    session.dispatchBrowserCommand({ type: 'reportLayout', layout: layout() });
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    let handled = false;
    session.subscribeBrowserState(() => {
      if (handled) return;
      handled = true;
      session.dispatchBrowserCommand({ type: 'setPlaying', playing: false });
      session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    });
    frame();
    expect(frames.size).toBe(1);
    frame();
    expect(frames.size).toBe(1);
  });
});
