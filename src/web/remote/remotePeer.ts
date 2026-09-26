import { gzipSync, gunzipSync } from 'fflate';
import {
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
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as PairingEnvelope;
  if (parsed.version !== 1 || (parsed.kind !== 'offer' && parsed.kind !== 'answer') || !parsed.description) {
    throw new Error('配对信息版本不受支持');
  }
  return parsed;
}

export function buildDisplayPairingUrl(payload: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  url.searchParams.set('mode', 'display');
  url.hash = `pair=${encodeURIComponent(payload)}`;
  return url.toString();
}

export function pairingPayloadFromLocation(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('pair');
}

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const onState = () => {
      if (peer.iceGatheringState !== 'complete') return;
      peer.removeEventListener('icegatheringstatechange', onState);
      resolve();
    };
    peer.addEventListener('icegatheringstatechange', onState);
  });
}

export class RemotePeer {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private detachTransport: (() => void) | null = null;
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
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private createConnection(): RTCPeerConnection {
    this.close();
    const peer = new RTCPeerConnection({ iceServers: [] });
    this.peer = peer;
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'connected') this.update({ status: 'connected', error: null });
      else if (peer.connectionState === 'failed') this.update({ status: 'error', error: 'P2P 连接失败，请重新配对' });
      else if (peer.connectionState === 'disconnected' || peer.connectionState === 'closed') this.update({ status: 'disconnected' });
      else if (peer.connectionState === 'connecting') this.update({ status: 'connecting' });
    });
    if (this.role === 'display') {
      peer.addEventListener('datachannel', (event) => this.bindChannel(event.channel));
    }
    return peer;
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.addEventListener('open', () => {
      this.detachTransport?.();
      this.detachTransport = registerBrowserSyncTransport((message) => {
        if (channel.readyState === 'open') channel.send(JSON.stringify(message));
      });
      this.update({ status: 'connected', error: null });
      if (this.role === 'control') {
        channel.send(JSON.stringify({ type: 'state', state: getBrowserState() } satisfies BrowserSyncMessage));
      }
      this.startPings();
    });
    channel.addEventListener('message', (event) => {
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
          receiveBrowserSyncMessage({ type: 'state', state: { ...message.state, layout: null } });
          return;
        }
        receiveBrowserSyncMessage(message);
      } catch (error) {
        this.update({ error: error instanceof Error ? error.message : String(error) });
      }
    });
    channel.addEventListener('close', () => {
      this.stopPings();
      this.detachTransport?.();
      this.detachTransport = null;
      this.update({ status: 'disconnected' });
    });
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

  async createOffer(): Promise<string> {
    if (!('RTCPeerConnection' in window)) throw new Error('当前浏览器不支持 WebRTC');
    this.update({ status: 'preparing', error: null, latencyMs: null });
    const peer = this.createConnection();
    const channel = peer.createDataChannel('teleprompter-session', { ordered: true });
    this.bindChannel(channel);
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIceGathering(peer);
    if (!peer.localDescription) throw new Error('无法生成连接请求');
    this.update({ status: 'waiting' });
    return encodePairingEnvelope({ version: 1, kind: 'offer', description: peer.localDescription.toJSON() });
  }

  async acceptOffer(payload: string): Promise<string> {
    if (!('RTCPeerConnection' in window)) throw new Error('当前浏览器不支持 WebRTC');
    this.update({ status: 'preparing', error: null, latencyMs: null });
    const envelope = await decodePairingEnvelope(payload);
    if (envelope.kind !== 'offer') throw new Error('需要主控设备的 Offer');
    const peer = this.createConnection();
    await peer.setRemoteDescription(envelope.description);
    await peer.setLocalDescription(await peer.createAnswer());
    await waitForIceGathering(peer);
    if (!peer.localDescription) throw new Error('无法生成连接响应');
    this.update({ status: 'waiting' });
    return encodePairingEnvelope({ version: 1, kind: 'answer', description: peer.localDescription.toJSON() });
  }

  async acceptAnswer(payload: string): Promise<void> {
    if (!this.peer) throw new Error('请先创建配对二维码');
    const envelope = await decodePairingEnvelope(payload);
    if (envelope.kind !== 'answer') throw new Error('需要显示设备的 Answer');
    this.update({ status: 'connecting', error: null });
    await this.peer.setRemoteDescription(envelope.description);
  }

  close(): void {
    this.stopPings();
    this.detachTransport?.();
    this.detachTransport = null;
    this.channel?.close();
    this.peer?.close();
    this.channel = null;
    this.peer = null;
    if (this.snapshot.status !== 'idle') this.update({ status: 'disconnected', latencyMs: null });
  }
}
