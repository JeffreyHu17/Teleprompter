import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from '../src/core/session';
import type { LayoutReport, SessionState } from '../src/types/session';

class FakeChannel {
  static instances: FakeChannel[] = [];
  sent: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(_name: string) { FakeChannel.instances.push(this); }
  postMessage(message: unknown) { this.sent.push(message); }
  receive(message: unknown) { this.onmessage?.({ data: message } as MessageEvent); }
}

let session: typeof import('../src/desktop/browserSession');
let channel: FakeChannel;
let search = '';

function report(state: SessionState, width: number): LayoutReport {
  return {
    revision: 1,
    documentRevision: state.document.revision,
    pageAnchors: [state.anchor],
    pageCount: 1,
    viewportWidth: width,
    viewportHeight: 720,
    documentHeight: 1000,
    textWidthPx: width - 100,
    pageScrollOffsets: [0],
    paragraphScrollOffsets: [0],
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeChannel.instances = [];
  vi.stubGlobal('window', {
    location: { search },
    localStorage: { getItem: () => null, setItem: vi.fn() },
    setInterval,
    clearInterval,
  });
  vi.stubGlobal('navigator', { userAgent: 'test browser' });
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  session = await import('../src/desktop/browserSession');
  channel = FakeChannel.instances[0];
});

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); search = ''; });

describe('one-device browser display synchronization', () => {
  it('sends the current controller snapshot on display hello and prefers the output layout', () => {
    session.dispatchBrowserCommand({ type: 'setDocument', name: 'edited', text: '已经编辑的内容' });
    const current = session.getBrowserState();
    channel.receive({ type: 'local-display-hello', id: 'display-a' });
    expect(session.isBrowserLocalDisplayActive()).toBe(true);
    const snapshot = channel.sent.at(-1) as { type: string; target: string; state: SessionState };
    expect(snapshot.type).toBe('state');
    expect(snapshot.target).toBe('display-a');
    expect(snapshot.state.document.rawText).toBe('已经编辑的内容');

    channel.receive({ type: 'command', id: 'preview', command: { type: 'reportLayout', layout: report(current, 1280) } });
    expect(session.getBrowserState().layout).toBeNull();

    const actualLayout = report(current, 720);
    channel.receive({ type: 'command', id: 'display', source: 'display', command: { type: 'reportLayout', layout: actualLayout } });
    expect(session.getBrowserState().layout?.viewportWidth).toBe(720);

    channel.receive({ type: 'local-display-bye', id: 'display-a' });
    expect(session.isBrowserLocalDisplayActive()).toBe(false);
  });

  it('corrects background-controller scroll drift from display position pulses', () => {
    session.dispatchBrowserCommand({ type: 'reportLayout', layout: report(session.getBrowserState(), 720) });
    session.dispatchBrowserCommand({ type: 'setPlaying', playing: true });
    channel.receive({ type: 'local-display-hello', id: 'display-a' });
    const revision = session.getBrowserState().document.revision;
    channel.receive({ type: 'local-display-pulse', id: 'display-a', documentRevision: revision, playing: true, scrollOffsetPx: 100 });
    expect(session.getBrowserState().scrollOffsetPx).toBe(35);
    channel.receive({ type: 'local-display-pulse', id: 'display-a', documentRevision: revision + 1, playing: true, scrollOffsetPx: 900 });
    expect(session.getBrowserState().scrollOffsetPx).toBe(35);
  });
});

describe('local display hydration', () => {
  beforeEach(async () => {
    vi.resetModules();
    FakeChannel.instances = [];
    vi.stubGlobal('window', {
      location: { search: '?view=display' },
      localStorage: { getItem: () => null, setItem: vi.fn() },
      setInterval,
      clearInterval,
    });
    session = await import('../src/desktop/browserSession');
    channel = FakeChannel.instances[0];
  });

  it('requests the live controller document rather than using stale storage', () => {
    const stop = session.startBrowserLocalDisplaySync();
    const hello = channel.sent.find((msg: any) => msg.type === 'local-display-hello') as { id: string };
    expect(hello.id).toBeTruthy();

    const original = session.getBrowserState();
    const document = createDocument('live', '工作台正在使用的新稿件', original.document.revision + 1);
    const snapshot: SessionState = { ...original, document, layout: report(original, 1920) };
    channel.receive({ type: 'state', target: 'wrong-display', state: snapshot });
    expect(session.getBrowserState().document.rawText).toBe(original.document.rawText);
    channel.receive({ type: 'state', target: hello.id, state: snapshot });
    expect(session.getBrowserState().document.rawText).toBe('工作台正在使用的新稿件');
    expect(session.getBrowserState().layout).toBeNull();
    stop();
    expect(channel.sent.at(-1)).toEqual({ type: 'local-display-bye', id: hello.id });
  });

  it('keeps a compatible local display layout and reports it back', () => {
    const state = session.getBrowserState();
    const ownLayout = report(state, 720);
    session.dispatchBrowserCommand({ type: 'reportLayout', layout: ownLayout });
    const stop = session.startBrowserLocalDisplaySync();
    const hello = channel.sent.find((msg: any) => msg.type === 'local-display-hello') as { id: string };
    channel.receive({ type: 'state', target: hello.id, state: { ...state, layout: report(state, 1920) } });
    expect(session.getBrowserState().layout?.viewportWidth).toBe(720);
    expect(channel.sent.some((msg: any) => msg.type === 'command' && msg.command.type === 'reportLayout' && msg.source === 'display')).toBe(true);
    stop();
  });
});
