import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchorAt, initialSessionState } from '../src/core/session';
import type { BrowserSyncMessage } from '../src/desktop/browserSession';
import type { LayoutReport, SessionState } from '../src/types/session';

const sync = vi.hoisted(() => ({
  createBrowserSyncCommand: vi.fn(),
  getBrowserState: vi.fn(),
  receiveBrowserSyncMessage: vi.fn(),
  registerBrowserSyncTransport: vi.fn(),
}));
vi.mock('../src/desktop/browserSession', () => sync);

import { decodePairingEnvelope, encodePairingEnvelope, RemotePeer } from '../src/web/remote/remotePeer';

type Listener = (event: { data?: string; channel?: MockChannel }) => void;

class MockEvents {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Parameters<Listener>[0] = {}): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  listenerCount(type?: string): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class MockChannel extends MockEvents {
  readyState: RTCDataChannelState = 'connecting';
  send = vi.fn<(payload: string) => void>();
  close = vi.fn(() => {
    this.readyState = 'closed';
    this.emit('close');
  });

  open(): void {
    this.readyState = 'open';
    this.emit('open');
  }

  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

class MockPeer extends MockEvents {
  static instances: MockPeer[] = [];
  static initialIceState: RTCIceGatheringState = 'complete';
  readonly channel = new MockChannel();
  iceGatheringState = MockPeer.initialIceState;
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: { toJSON: () => RTCSessionDescriptionInit } | null = null;
  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: 'local-offer' }));
  createAnswer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: 'local-answer' }));
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = { toJSON: () => description };
  });
  setRemoteDescription = vi.fn(async (_description: RTCSessionDescriptionInit) => {});
  createDataChannel = vi.fn(() => this.channel);
  close = vi.fn(() => {
    this.connectionState = 'closed';
    this.emit('connectionstatechange');
  });

  constructor(readonly configuration: RTCConfiguration) {
    super();
    MockPeer.instances.push(this);
  }

  completeIce(): void {
    this.iceGatheringState = 'complete';
    this.emit('icegatheringstatechange');
  }
}

let state: SessionState;
let remotes: RemotePeer[];
let senders: Set<(message: BrowserSyncMessage) => void>;

function createRemote(role: 'control' | 'display' = 'control'): RemotePeer {
  const remote = new RemotePeer(role);
  remotes.push(remote);
  return remote;
}

function layout(revision = 1): LayoutReport {
  return {
    revision,
    documentRevision: state.document.revision,
    pageAnchors: [anchorAt(state.document, 0)],
    pageCount: 1,
    viewportWidth: 1280,
    viewportHeight: 720,
    documentHeight: 900,
    textWidthPx: 1000,
    pageScrollOffsets: [0],
    paragraphScrollOffsets: [0],
  };
}

async function offerPayload(): Promise<string> {
  return encodePairingEnvelope({ version: 1, kind: 'offer', description: { type: 'offer', sdp: 'remote-offer' } });
}

async function connectDisplay(): Promise<{ remote: RemotePeer; peer: MockPeer; channel: MockChannel }> {
  const remote = createRemote('display');
  await remote.acceptOffer(await offerPayload());
  const peer = MockPeer.instances.at(-1)!;
  const channel = new MockChannel();
  peer.emit('datachannel', { channel });
  channel.open();
  return { remote, peer, channel };
}

async function flushPairingSteps(): Promise<void> {
  // createOffer, setLocalDescription, then the ICE-gathering wait.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('RTCPeerConnection', MockPeer);
  MockPeer.instances = [];
  MockPeer.initialIceState = 'complete';
  remotes = [];
  senders = new Set();
  state = initialSessionState();
  sync.getBrowserState.mockImplementation(() => state);
  sync.receiveBrowserSyncMessage.mockImplementation((message: BrowserSyncMessage) => {
    if (message.type === 'state') state = message.state;
  });
  sync.createBrowserSyncCommand.mockImplementation((command) => ({ type: 'command', id: 'test-command', command }));
  sync.registerBrowserSyncTransport.mockImplementation((send) => {
    senders.add(send);
    return () => senders.delete(send);
  });
});

afterEach(() => {
  remotes.forEach((remote) => remote.close());
  expect(senders.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('remote pairing lifecycle', () => {
  it('preserves compressed pairing envelopes and ordered backend-free WebRTC setup', async () => {
    const remote = createRemote();
    const payload = await remote.createOffer();
    expect(await decodePairingEnvelope(payload)).toEqual({
      version: 1, kind: 'offer', description: { type: 'offer', sdp: 'local-offer' },
    });
    const peer = MockPeer.instances[0];
    expect(peer.configuration).toEqual({ iceServers: [] });
    expect(peer.createDataChannel).toHaveBeenCalledWith('teleprompter-session', { ordered: true });
    expect(remote.current().status).toBe('waiting');
    expect(peer.listenerCount('icegatheringstatechange')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the ICE waiter and timeout after successful gathering', async () => {
    MockPeer.initialIceState = 'gathering';
    const remote = createRemote();
    const offer = remote.createOffer();
    await flushPairingSteps();
    const peer = MockPeer.instances[0];
    expect(remote.current().status).toBe('preparing');
    expect(peer.listenerCount('icegatheringstatechange')).toBe(1);
    expect(peer.listenerCount('connectionstatechange')).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    peer.completeIce();
    await offer;
    expect(peer.listenerCount('icegatheringstatechange')).toBe(0);
    expect(peer.listenerCount('connectionstatechange')).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending ICE gathering and removes all listeners on close', async () => {
    MockPeer.initialIceState = 'gathering';
    const remote = createRemote();
    const result = remote.createOffer().catch((error: Error) => error);
    await flushPairingSteps();
    const peer = MockPeer.instances[0];
    remote.close();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(peer.listenerCount()).toBe(0);
    expect(peer.channel.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    peer.completeIce();
    expect(remote.current().status).toBe('disconnected');
  });

  it('bounds an ICE gathering stall and cleans up failed pairing resources', async () => {
    MockPeer.initialIceState = 'gathering';
    const remote = createRemote();
    const result = remote.createOffer().catch((error: Error) => error);
    await flushPairingSteps();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ message: '收集连接信息超时，请重新配对' });
    expect(remote.current().status).toBe('error');
    expect(MockPeer.instances[0].listenerCount()).toBe(0);
    expect(MockPeer.instances[0].channel.listenerCount()).toBe(0);
    expect(MockPeer.instances[0].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a failed connection while ICE is gathering', async () => {
    MockPeer.initialIceState = 'gathering';
    const remote = createRemote();
    const result = remote.createOffer().catch((error: Error) => error);
    await flushPairingSteps();
    const peer = MockPeer.instances[0];
    peer.connectionState = 'failed';
    peer.emit('connectionstatechange');
    expect(await result).toMatchObject({ message: 'P2P 连接失败，请重新配对' });
    expect(peer.listenerCount()).toBe(0);
    expect(remote.current().status).toBe('error');
  });

  it('rejects a replaced offer without overwriting the new connection', async () => {
    MockPeer.initialIceState = 'gathering';
    const remote = createRemote();
    const oldResult = remote.createOffer().catch((error: Error) => error);
    await flushPairingSteps();
    MockPeer.initialIceState = 'complete';
    await remote.createOffer();
    expect(await oldResult).toMatchObject({ name: 'AbortError' });
    expect(remote.current().status).toBe('waiting');
    expect(MockPeer.instances[0].listenerCount()).toBe(0);
    expect(MockPeer.instances[1].close).not.toHaveBeenCalled();
  });

  it('does not write a local description after pairing was closed during offer creation', async () => {
    const remote = createRemote();
    const result = remote.createOffer().catch((error: Error) => error);
    remote.close();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(MockPeer.instances[0].setLocalDescription).not.toHaveBeenCalled();
  });

  it('does not recreate a connection when closed during offer decoding', async () => {
    const remote = createRemote('display');
    const payload = await offerPayload();
    const result = remote.acceptOffer(payload).catch((error: Error) => error);
    remote.close();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(MockPeer.instances).toHaveLength(0);
  });

  it('lets the latest concurrent offer acceptance own the connection', async () => {
    const remote = createRemote('display');
    const payload = await offerPayload();
    const oldResult = remote.acceptOffer(payload).catch((error: Error) => error);
    const answer = await remote.acceptOffer(payload);
    expect(await oldResult).toMatchObject({ name: 'AbortError' });
    expect((await decodePairingEnvelope(answer)).kind).toBe('answer');
    expect(MockPeer.instances).toHaveLength(1);
  });

  it('does not apply an old answer to a replacement peer', async () => {
    const remote = createRemote();
    await remote.createOffer();
    const payload = await encodePairingEnvelope({
      version: 1, kind: 'answer', description: { type: 'answer', sdp: 'remote-answer' },
    });
    const result = remote.acceptAnswer(payload).catch((error: Error) => error);
    await remote.createOffer();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(MockPeer.instances[0].setRemoteDescription).not.toHaveBeenCalled();
    expect(MockPeer.instances[1].setRemoteDescription).not.toHaveBeenCalled();
  });

  it('ignores queued events from old peers and channels after reconnecting', async () => {
    const remote = createRemote();
    await remote.createOffer();
    const oldPeer = MockPeer.instances[0];
    const oldChannel = oldPeer.channel;
    oldChannel.open();
    const staleOpen = [...oldChannel.listeners.get('open')!][0];
    const staleClose = [...oldChannel.listeners.get('close')!][0];
    const staleMessage = [...oldChannel.listeners.get('message')!][0];
    const staleConnection = [...oldPeer.listeners.get('connectionstatechange')!][0];

    await remote.createOffer();
    const channel = MockPeer.instances[1].channel;
    channel.open();
    staleOpen({});
    staleClose({});
    staleMessage({ data: JSON.stringify({ type: 'pong', sentAt: 0 }) });
    staleConnection({});
    expect(remote.current()).toEqual({ status: 'connected', error: null, latencyMs: null });
    expect(senders.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(oldPeer.listenerCount()).toBe(0);
    expect(oldChannel.listenerCount()).toBe(0);
    const message = { type: 'command', id: 'speed', command: { type: 'setSpeed', speed: 30 } } satisfies BrowserSyncMessage;
    senders.forEach((send) => send(message));
    expect(channel.send).toHaveBeenLastCalledWith(JSON.stringify(message));
    expect(oldChannel.send).toHaveBeenCalledTimes(1);
  });

  it('keeps one transport and ping timer across repeated reconnects', async () => {
    const remote = createRemote();
    for (let index = 0; index < 25; index += 1) {
      await remote.createOffer();
      MockPeer.instances.at(-1)!.channel.open();
      expect(senders.size).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(MockPeer.instances.slice(0, -1).every((peer) => peer.listenerCount() === 0 && peer.channel.listenerCount() === 0)).toBe(true);
  });

  it('cleans up a replaced display data channel without disconnecting its replacement', async () => {
    const { remote, peer, channel: oldChannel } = await connectDisplay();
    const channel = new MockChannel();
    channel.readyState = 'open';
    peer.emit('datachannel', { channel });
    oldChannel.emit('close');
    expect(oldChannel.close).toHaveBeenCalledOnce();
    expect(oldChannel.listenerCount()).toBe(0);
    expect(remote.current().status).toBe('connected');
    expect(senders.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('remote synchronization', () => {
  it('reports a reusable display layout once across 100 repeated snapshots', async () => {
    const { channel } = await connectDisplay();
    const localLayout = layout();
    state = { ...state, layout: localLayout };
    for (let index = 0; index < 100; index += 1) {
      channel.receive({ type: 'state', state: { ...state, revision: index, layout: null } });
    }
    expect(sync.receiveBrowserSyncMessage).toHaveBeenCalledTimes(100);
    expect(state.layout).toBe(localLayout);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(sync.createBrowserSyncCommand).toHaveBeenCalledTimes(1);
    expect(JSON.parse(channel.send.mock.calls[0][0]).command.layout).toEqual(localLayout);
  });

  it('still reports a new local measurement and invalidates layout after typography changes', async () => {
    const { channel } = await connectDisplay();
    state = { ...state, layout: layout() };
    channel.receive({ type: 'state', state });
    state = { ...state, layout: layout(2) };
    channel.receive({ type: 'state', state });
    expect(channel.send).toHaveBeenCalledTimes(2);
    channel.receive({ type: 'state', state: { ...state, typography: { ...state.typography, fontSize: 120 } } });
    expect(state.layout).toBeNull();
    expect(channel.send).toHaveBeenCalledTimes(2);
    state = { ...state, layout: layout(3) };
    channel.receive({ type: 'state', state });
    expect(channel.send).toHaveBeenCalledTimes(3);
  });

  it('does not echo a measurement already sent by the normal command transport', async () => {
    const { channel } = await connectDisplay();
    const localLayout = layout();
    state = { ...state, layout: localLayout };
    senders.forEach((send) => send({ type: 'command', id: 'layout', command: { type: 'reportLayout', layout: localLayout } }));
    channel.receive({ type: 'state', state });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(sync.createBrowserSyncCommand).not.toHaveBeenCalled();
  });

  it('preserves command delivery, ping/pong, and deduplicates identical status notifications', async () => {
    const { remote, channel } = await connectDisplay();
    const listener = vi.fn();
    remote.subscribe(listener);
    channel.receive({ type: 'pong', sentAt: Date.now() - 10 });
    channel.receive({ type: 'pong', sentAt: Date.now() - 10 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(remote.current().latencyMs).toBe(10);
    channel.receive({ type: 'ping', sentAt: 123 });
    expect(channel.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'pong', sentAt: 123 }));
    const message = { type: 'command', id: 'play', command: { type: 'setPlaying', playing: true } } satisfies BrowserSyncMessage;
    channel.receive(message);
    expect(sync.receiveBrowserSyncMessage).toHaveBeenLastCalledWith(message);
    await vi.advanceTimersByTimeAsync(3000);
    expect(JSON.parse(channel.send.mock.calls.at(-1)![0]).type).toBe('ping');
    channel.close();
    expect(senders.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(channel.listenerCount()).toBe(0);
  });
});
