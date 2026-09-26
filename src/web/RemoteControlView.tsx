import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Minus, MonitorUp, Pause, Play, Plus, QrCode as QrIcon, RotateCcw } from 'lucide-react';
import { dispatchBrowserCommand, getBrowserState, subscribeBrowserState } from '../desktop/browserSession';
import type { SessionCommand, SessionState } from '../types/session';
import { QrCode } from './remote/QrCode';
import { RemotePeer, buildDisplayPairingUrl, type RemotePeerSnapshot } from './remote/remotePeer';

function useBrowserSession() {
  const [state, setState] = useState<SessionState>(getBrowserState());
  useEffect(() => subscribeBrowserState(setState), []);
  return { state, command: (command: SessionCommand) => dispatchBrowserCommand(command) };
}

function statusLabel(snapshot: RemotePeerSnapshot): string {
  if (snapshot.status === 'connected') return snapshot.latencyMs === null ? '显示设备已连接' : `显示设备已连接 · ${snapshot.latencyMs} ms`;
  if (snapshot.status === 'preparing') return '正在生成配对信息…';
  if (snapshot.status === 'waiting') return '等待显示设备返回连接响应';
  if (snapshot.status === 'connecting') return '正在建立 P2P 连接…';
  if (snapshot.status === 'error') return snapshot.error ?? '连接失败';
  if (snapshot.status === 'disconnected') return '显示设备已断开';
  return '尚未连接显示设备';
}

export function RemoteControlView() {
  const { state, command } = useBrowserSession();
  const peerRef = useRef<RemotePeer | null>(null);
  if (!peerRef.current) peerRef.current = new RemotePeer('control');
  const peer = peerRef.current;
  const [peerState, setPeerState] = useState<RemotePeerSnapshot>(peer.current());
  const [pairingUrl, setPairingUrl] = useState('');
  const [answer, setAnswer] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [draft, setDraft] = useState(state.document.rawText);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => peer.subscribe(setPeerState), [peer]);
  useEffect(() => () => peer.close(), [peer]);
  useEffect(() => setDraft(state.document.rawText), [state.document.revision]);

  const pageNumber = useMemo(() => {
    const offsets = state.layout?.pageScrollOffsets ?? [];
    if (!offsets.length) return 1;
    let page = 1;
    offsets.forEach((offset, index) => {
      if (offset <= state.scrollOffsetPx + 1) page = index + 1;
    });
    return page;
  }, [state.layout, state.scrollOffsetPx]);

  const paragraphIndex = useMemo(() => {
    const offsets = state.layout?.paragraphScrollOffsets ?? [];
    if (!offsets.length) return state.anchor.paragraphIndex;
    let index = 0;
    offsets.forEach((offset, current) => {
      if (offset <= state.scrollOffsetPx + state.typography.fontSize) index = current;
    });
    return Math.min(index, state.document.paragraphs.length - 1);
  }, [state.anchor.paragraphIndex, state.document.paragraphs.length, state.layout, state.scrollOffsetPx, state.typography.fontSize]);

  const paragraph = state.document.paragraphs[paragraphIndex];

  const startPairing = async () => {
    setError(null);
    setAnswer('');
    try {
      const offer = await peer.createOffer();
      setPairingUrl(buildDisplayPairingUrl(offer));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const applyAnswer = useCallback(async (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setError(null);
    try {
      await peer.acceptAnswer(normalized);
      setScannerOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [peer]);

  const commitDraft = () => {
    if (draft !== state.document.rawText) command({ type: 'setDocument', name: state.document.name, text: draft });
  };

  return (
    <main className="remote-control-app">
      <header className="remote-control-header">
        <div>
          <span className={peerState.status === 'connected' ? 'remote-dot connected' : 'remote-dot'} />
          <div><strong>Teleprompter Remote</strong><small>{statusLabel(peerState)}</small></div>
        </div>
        <span className="remote-page">{pageNumber} / {Math.max(1, state.layout?.pageCount ?? 1)}</span>
      </header>

      <section className="remote-now">
        <span>当前内容</span>
        <p>{paragraph?.text || '暂无稿件'}</p>
        <div className="remote-progress">
          <span style={{ width: `${Math.min(100, Math.max(0, state.layout?.documentHeight ? state.scrollOffsetPx / state.layout.documentHeight * 100 : 0))}%` }} />
        </div>
      </section>

      <section className="remote-transport">
        <button aria-label="上一页" onClick={() => command({ type: 'navigatePage', direction: -1 })}><ChevronLeft /></button>
        <button className="remote-play" aria-label="播放或暂停" onClick={() => command({ type: 'togglePlay' })}>
          {state.isPlaying ? <Pause /> : <Play fill="currentColor" />}
        </button>
        <button aria-label="下一页" onClick={() => command({ type: 'navigatePage', direction: 1 })}><ChevronRight /></button>
      </section>

      <section className="remote-speed">
        <span>滚动速度</span>
        <div>
          <button aria-label="降低速度" onClick={() => command({ type: 'adjustSpeed', delta: -5 })}><Minus /></button>
          <strong>{Math.round(state.scrollSpeedPxPerSecond)} <small>px/s</small></strong>
          <button aria-label="提高速度" onClick={() => command({ type: 'adjustSpeed', delta: 5 })}><Plus /></button>
        </div>
      </section>

      <details className="remote-panel" open>
        <summary><MonitorUp />远程显示</summary>
        <div className="remote-panel-body remote-pairing-panel">
          {!pairingUrl && peerState.status !== 'connected' && (
            <button className="remote-primary" onClick={() => void startPairing()}><QrIcon />创建配对二维码</button>
          )}
          {pairingUrl && peerState.status !== 'connected' && <>
            <p>在显示设备上用系统相机扫描此二维码。显示设备打开页面后会生成返回二维码，再用本页扫描完成 P2P 配对。</p>
            <QrCode value={pairingUrl} label="显示设备配对二维码" />
            <div className="remote-pair-actions">
              <button onClick={() => setScannerOpen(true)}><QrIcon />扫描显示端返回码</button>
              <button onClick={() => void navigator.clipboard?.writeText(pairingUrl)}><Copy />复制配对链接</button>
              <button onClick={() => void startPairing()}><RotateCcw />重新生成</button>
            </div>
            <label className="remote-answer-field">
              <span>无法扫码时粘贴返回信息</span>
              <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="teleprompter-pair-v1:…" />
            </label>
            <button disabled={!answer.trim()} onClick={() => void applyAnswer(answer)}>应用返回信息</button>
          </>}
          {peerState.status === 'connected' && <p className="remote-connected-note">连接完成。播放、翻页、速度、稿件与排版修改会直接同步到显示设备。</p>}
          {(error || peerState.error) && <p className="remote-error">{error || peerState.error}</p>}
        </div>
      </details>

      <details className="remote-panel">
        <summary>稿件编辑</summary>
        <div className="remote-panel-body">
          <textarea className="remote-script-editor" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft} />
          <button onClick={commitDraft}>同步稿件</button>
        </div>
      </details>

      <details className="remote-panel">
        <summary>显示排版</summary>
        <div className="remote-panel-body remote-settings">
          <label>字号 <output>{state.typography.fontSize}px</output><input type="range" min="16" max="240" value={state.typography.fontSize} onChange={(event) => command({ type: 'setTypography', patch: { fontSize: Number(event.target.value) } })} /></label>
          <label>行距 <output>{state.typography.lineHeight.toFixed(2)}</output><input type="range" min="0.7" max="3" step="0.05" value={state.typography.lineHeight} onChange={(event) => command({ type: 'setTypography', patch: { lineHeight: Number(event.target.value) } })} /></label>
          <label>左右间距 <output>{state.typography.sidePadding}px</output><input type="range" min="0" max="400" step="4" value={Math.min(400, state.typography.sidePadding)} onChange={(event) => command({ type: 'setTypography', patch: { sidePadding: Number(event.target.value) } })} /></label>
          <label>焦点位置 <output>{state.typography.focusPosition}%</output><input type="range" min="10" max="80" value={state.typography.focusPosition} onChange={(event) => command({ type: 'setTypography', patch: { focusPosition: Number(event.target.value) } })} /></label>
          <button onClick={() => command({ type: 'setMirror', mode: state.mirrorMode === 'horizontal' ? 'none' : 'horizontal' })}>
            {state.mirrorMode === 'horizontal' ? '关闭水平镜像' : '开启水平镜像'}
          </button>
        </div>
      </details>

      {scannerOpen && <AnswerScanner onScan={(value) => { setAnswer(value); void applyAnswer(value); }} onClose={() => setScannerOpen(false)} />}
    </main>
  );
}

function AnswerScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('正在打开相机…');

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;

    const start = async () => {
      const Detector = (window as typeof window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
      if (!Detector) {
        setMessage('当前浏览器不支持页面内二维码识别，请使用下方手动粘贴方式。');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setMessage('对准显示设备上的返回二维码');
        const detector = new Detector({ formats: ['qr_code'] });
        const scan = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes[0]?.rawValue;
            if (value) {
              onScan(value);
              return;
            }
          } catch {
            // Keep scanning while the camera is active.
          }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (scanError) {
        setMessage(scanError instanceof Error ? scanError.message : '无法打开相机');
      }
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onScan]);

  return (
    <div className="remote-scanner-backdrop">
      <section className="remote-scanner" role="dialog" aria-modal="true">
        <video ref={videoRef} playsInline muted />
        <p>{message}</p>
        <button onClick={onClose}>关闭扫描</button>
      </section>
    </div>
  );
}
