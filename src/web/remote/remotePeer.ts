import { gzipSync, gunzipSync } from 'fflate';
import {
  createBrowserSyncCommand,
  getBrowserState,
  receiveBrowserSyncMessage,
  registerBrowserSyncTransport,
  type BrowserSyncMessage,
} from '../../desktop/browserSession';

export type RemotePeerRole = 'control' | 'display';
export type RemotePeerStatus = 'idle' | 'preparing' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface RemotePeerSnapshot {
  status: RemotePeerStatus;
  latencyMs: number | null;
  error: string | null;
}

type PairingEnvelope = {
  version: 1;
  kind: 'offer' | 'answer';
  description: RTCSessionDescriptionInit;
};

type WireMessage =
  | BrowserSyncMessage
  | { type: 'ping'; sentAt: number }
  | { type: 'pong'; sentAt: number };

const PAIRING_PREFIX = 'teleprompter-pair-v1:';
const ICE_GATHERING_TIMEOUT_MS = 15_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encodePairingEnvelope(envelope: PairingEnvelope): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(envelope));
  return PAIRING_PREFIX + bytesToBase64Url(gzipSync(raw, { level: 6 }));
}

export async function decodePairingEnvelope(payload: string): Promise<PairingEnvelope> {
  const normalized = payload.trim();
  if (!normalized.startsWith(PAIRING_PREFIX)) throw new Error('无法识别配对信息');
  const encoded = normalized.slice(PAIRING_PREFIX.length);
  let bytes: Uint8Array;
  try {
    bytes = gunzipSync(base64UrlToBytes(encoded));
  } catch {
    throw new Error('配对信息损坏或不完整');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('配对信息损坏或不完整');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('配对信息损坏或不完整');
  }

  const envelope = parsed as Partial<PairingEnvelope>;
  if (envelope.version !== 1 || (envelope.kind !== 'offer' && envelope.kind !== 'answer') || !envelope.description) {
    throw new Error('配对信息版本不受支持');
  }
  return envelope as PairingEnvelope;
}

export function buildDisplayPairingUrl(payload: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  url.searchParams.set('mode', 'display');
  url.hash = `pair=${encodeURIComponent(payload)}`;
  return url.toString();
}

export function extractPairingPayload(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.startsWith(PAIRING_PREFIX)) return normalized;

  try {
    const url = new URL(normalized, window.location.href);
    const params = new URLSearchParams(url.hash.replace(/^#/, ''));
    return params.get('pair');
  } catch {
    const params = new URLSearchParams(normalized.replace(/^#/, ''));
    return params.get('pair');
  }
}

export function pairingPayloadFromLocation(): string | null {
  return extractPairingPayload(window.location.href);
}


function layoutInputsMatch(a: ReturnType<typeof getBrowserState>, b: ReturnType<typeof getBrowserState>): boolean {
  if (a.document.revision !== b.document.revision || a.document.rawText !== b.document.rawText) return false;
  const left = a.typography;
  const right = b.typography;
  return left.fontFamily === right.fontFamily
    && left.fontSize === right.fontSize
    && left.fontWeight === right.fontWeight
    && left.lineHeight === right.lineHeight
    && left.paragraphSpacing === right.paragraphSpacing
    && left.sidePadding === right.sidePadding
    && left.focusPosition === right.focusPosition
    && left.alignment === right.alignment;
}

function pairingCancelled(): DOMException {
  return new DOMException('配对已取消，请重新配对', 'AbortError');
}

function waitForIceGathering(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(pairingCancelled());
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      peer.removeEventListener('icegatheringstatechange', onState);
      peer.removeEventListener('connectionstatechange', onConnectionState);
      signal.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onState = () => {
      if (peer.iceGatheringState !== 'complete') return;
      cleanup();
      resolve();
    };
    const onConnectionState = () => {
      if (peer.connectionState === 'closed' || peer.connectionState === 'failed') {
        fail(new Error('P2P 连接失败，请重新配对'));
      }
    };
    const onAbort = () => fail(pairingCancelled());
    const timeout = setTimeout(() => fail(new Error('收集连接信息超时，请重新配对')), ICE_GATHERING_TIMEOUT_MS);
    peer.addEventListener('icegatheringstatechange', onState);
    peer.addEventListener('connectionstatechange', onConnectionState);
    signal.addEventListener('abort', onAbort, { once: true });
    onConnectionState();
  });
}

export class RemotePeer {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private detachTransport: (() => void) | null = null;
  private removePeerListeners: (() => void) | null = null;
  private removeChannelListeners: (() => void) | null = null;
  private connectionAbort: AbortController | null = null;
  private pairingAttempt = 0;
  private pingTimer: number | null = null;
  private listeners = new Set<(snapshot: RemotePeerSnapshot) => void>();
  private snapshot: RemotePeerSnapshot = { status: 'idle', latencyMs: null, error: null };

  constructor(private readonly role: RemotePeerRole) {}

  subscribe(listener: (snapshot: RemotePeerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  current(): RemotePeerSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<RemotePeerSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (next.status === this.snapshot.status && next.latencyMs === this.snapshot.latencyMs && next.error === this.snapshot.error) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private createConnection(): { peer: RTCPeerConnection; signal: AbortSignal } {
    this.close();
    const peer = new RTCPeerConnection({ iceServers: [] });
    const controller = new AbortController();
    this.peer = peer;
    this.connectionAbort = controller;
    const onConnectionState = () => {
      if (this.peer !== peer) return;
      if (peer.connectionState === 'connected') this.update({ status: 'connected', error: null });
      else if (peer.connectionState === 'failed') this.update({ status: 'error', error: 'P2P 连接失败，请重新配对' });
      else if (peer.connectionState === 'disconnected' || peer.connectionState === 'closed') this.update({ status: 'disconnected' });
      else if (peer.connectionState === 'connecting') this.update({ status: 'connecting' });
    };
    const onDataChannel = (event: RTCDataChannelEvent) => {
      if (this.peer === peer) this.bindChannel(event.channel);
    };
    peer.addEventListener('connectionstatechange', onConnectionState);
    if (this.role === 'display') peer.addEventListener('datachannel', onDataChannel);
    this.removePeerListeners = () => {
      peer.removeEventListener('connectionstatechange', onConnectionState);
      peer.removeEventListener('datachannel', onDataChannel);
    };
    this.update({ status: 'preparing', error: null, latencyMs: null });
    return { peer, signal: controller.signal };
  }

  private assertCurrentConnection(peer: RTCPeerConnection): void {
    if (this.peer !== peer) throw pairingCancelled();
  }

  private releaseChannel(): void {
    const channel = this.channel;
    this.channel = null;
    this.removeChannelListeners?.();
    this.removeChannelListeners = null;
    this.stopPings();
    this.detachTransport?.();
    this.detachTransport = null;
    channel?.close();
  }

  private bindChannel(channel: RTCDataChannel): void {
    if (this.channel === channel) return;
    this.releaseChannel();
    this.channel = channel;
    let reportedLayout: ReturnType<typeof getBrowserState>['layout'] = null;
    const send = (message: BrowserSyncMessage) => {
      if (this.channel !== channel || channel.readyState !== 'open') return;
      channel.send(JSON.stringify(message));
      if (message.type === 'command' && message.command.type === 'reportLayout') {
        reportedLayout = message.command.layout;
      }
    };
    const onOpen = () => {
      if (this.channel !== channel) return;
      this.detachTransport?.();
      this.detachTransport = registerBrowserSyncTransport(send);
      this.update({ status: 'connected', error: null });
      if (this.role === 'control') {
        send({ type: 'state', state: getBrowserState() });
      }
      this.startPings();
    };
    const onMessage = (event: MessageEvent) => {
      if (this.channel !== channel) return;
      try {
        const message = JSON.parse(String(event.data)) as WireMessage;
        if (message.type === 'ping') {
          if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'pong', sentAt: message.sentAt } satisfies WireMessage));
          return;
        }
        if (message.type === 'pong') {
          this.update({ latencyMs: Math.max(0, Date.now() - message.sentAt) });
          return;
        }
        if (message.type === 'state' && this.role === 'display') {
          const localState = getBrowserState();
          const reusableLayout = localState.layout && layoutInputsMatch(localState, message.state)
            ? localState.layout
            : null;

          receiveBrowserSyncMessage({
            type: 'state',
            state: { ...message.state, layout: reusableLayout },
          });

          // The ordered, reliable channel only needs each local measurement once.
          // Repeated snapshots must not serialize and echo the same page arrays.
          if (reusableLayout && reusableLayout !== reportedLayout) {
            send(createBrowserSyncCommand({ type: 'reportLayout', layout: reusableLayout }));
          } else if (!reusableLayout) {
            reportedLayout = null;
          }
          return;
        }
        receiveBrowserSyncMessage(message);
      } catch (error) {
        this.update({ error: error instanceof Error ? error.message : String(error) });
      }
    };
    const onClose = () => {
      if (this.channel !== channel) return;
      this.releaseChannel();
      this.update({ status: 'disconnected', latencyMs: null });
    };
    channel.addEventListener('open', onOpen);
    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);
    this.removeChannelListeners = () => {
      channel.removeEventListener('open', onOpen);
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
    };
    if (channel.readyState === 'open') onOpen();
  }

  private startPings(): void {
    this.stopPings();
    this.pingTimer = window.setInterval(() => {
      if (this.channel?.readyState === 'open') {
        this.channel.send(JSON.stringify({ type: 'ping', sentAt: Date.now() } satisfies WireMessage));
      }
    }, 3000);
  }

  private stopPings(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private failConnection(peer: RTCPeerConnection, error: unknown): void {
    if (this.peer !== peer) return;
    this.close();
    this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }

  async createOffer(): Promise<string> {
    if (!('RTCPeerConnection' in window)) throw new Error('当前浏览器不支持 WebRTC');
    const { peer, signal } = this.createConnection();
    try {
      const channel = peer.createDataChannel('teleprompter-session', { ordered: true });
      this.bindChannel(channel);
      const offer = await peer.createOffer();
      this.assertCurrentConnection(peer);
      await peer.setLocalDescription(offer);
      this.assertCurrentConnection(peer);
      await waitForIceGathering(peer, signal);
      this.assertCurrentConnection(peer);
      if (!peer.localDescription) throw new Error('无法生成连接请求');
      this.update({ status: 'waiting' });
      return encodePairingEnvelope({ version: 1, kind: 'offer', description: peer.localDescription.toJSON() });
    } catch (error) {
      this.failConnection(peer, error);
      throw error;
    }
  }

  async acceptOffer(payload: string): Promise<string> {
    if (!('RTCPeerConnection' in window)) throw new Error('当前浏览器不支持 WebRTC');
    const attempt = ++this.pairingAttempt;
    const envelope = await decodePairingEnvelope(payload);
    if (attempt !== this.pairingAttempt) throw pairingCancelled();
    if (envelope.kind !== 'offer') throw new Error('需要主控设备的 Offer');
    const { peer, signal } = this.createConnection();
    try {
      await peer.setRemoteDescription(envelope.description);
      this.assertCurrentConnection(peer);
      const answer = await peer.createAnswer();
      this.assertCurrentConnection(peer);
      await peer.setLocalDescription(answer);
      this.assertCurrentConnection(peer);
      await waitForIceGathering(peer, signal);
      this.assertCurrentConnection(peer);
      if (!peer.localDescription) throw new Error('无法生成连接响应');
      this.update({ status: 'waiting' });
      return encodePairingEnvelope({ version: 1, kind: 'answer', description: peer.localDescription.toJSON() });
    } catch (error) {
      this.failConnection(peer, error);
      throw error;
    }
  }

  async acceptAnswer(payload: string): Promise<void> {
    const peer = this.peer;
    if (!peer) throw new Error('请先创建配对二维码');
    const envelope = await decodePairingEnvelope(payload);
    this.assertCurrentConnection(peer);
    if (envelope.kind !== 'answer') throw new Error('需要显示设备的 Answer');
    this.update({ status: 'connecting', error: null });
    await peer.setRemoteDescription(envelope.description);
    this.assertCurrentConnection(peer);
  }

  close(): void {
    this.pairingAttempt += 1;
    const peer = this.peer;
    this.peer = null;
    this.connectionAbort?.abort();
    this.connectionAbort = null;
    this.removePeerListeners?.();
    this.removePeerListeners = null;
    this.releaseChannel();
    peer?.close();
    if (this.snapshot.status !== 'idle') this.update({ status: 'disconnected', latencyMs: null });
  }
}
