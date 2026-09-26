import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Minus, MonitorUp, Pause, Play, Plus, QrCode as QrIcon, RotateCcw } from 'lucide-react';
import { dispatchBrowserCommand, getBrowserState, subscribeBrowserState } from '../desktop/browserSession';
import { DEFAULT_TYPOGRAPHY } from '../core/session';
import type { LayoutReport, MirrorMode, SessionCommand, SessionState } from '../types/session';
import { RemoteProgramPreview } from './RemoteProgramPreview';
import { QrCode } from './remote/QrCode';
import { QrScanner } from './remote/QrScanner';
import { copyText } from './remote/clipboard';
import { RemotePeer, buildDisplayPairingUrl, type RemotePeerSnapshot } from './remote/remotePeer';

function useBrowserSession() {
  const [state, setState] = useState<SessionState>(getBrowserState());
  useEffect(() => subscribeBrowserState(setState), []);
  const command = useCallback((next: SessionCommand) => dispatchBrowserCommand(next), []);
  return { state, command };
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

const MIRROR_OPTIONS: Array<{ mode: MirrorMode; label: string }> = [
  { mode: 'none', label: '正常' },
  { mode: 'horizontal', label: '水平' },
  { mode: 'vertical', label: '垂直' },
  { mode: 'both', label: '双轴' },
];

function returnToSingleDeviceMode() {
  const url = new URL(window.location.href);
  url.searchParams.delete('mode');
  url.hash = '';
  window.location.assign(url.toString());
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
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => peer.subscribe(setPeerState), [peer]);
  useEffect(() => () => peer.close(), [peer]);
  useEffect(() => setDraft(state.document.rawText), [state.document.revision]);

  const remoteConnected = peerState.status === 'connected';

  const pageNumber = useMemo(() => {
    const offsets = state.layout?.pageScrollOffsets ?? [];
    if (!offsets.length) return 1;
    let page = 1;
    offsets.forEach((offset, index) => {
      if (offset <= state.scrollOffsetPx + 1) page = index + 1;
    });
    return page;
  }, [state.layout, state.scrollOffsetPx]);

  const startPairing = async () => {
    setError(null);
    setCopyStatus(null);
    setAnswer('');
    try {
      const offer = await peer.createOffer();
      setPairingUrl(buildDisplayPairingUrl(offer));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const applyAnswer = useCallback(async (value: string): Promise<boolean> => {
    const normalized = value.trim();
    if (!normalized) return false;
    setError(null);
    try {
      await peer.acceptAnswer(normalized);
      setScannerOpen(false);
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return false;
    }
  }, [peer]);

  const handleAnswerScan = useCallback((value: string) => {
    setAnswer(value);
    return applyAnswer(value);
  }, [applyAnswer]);

  const reportLocalPreviewLayout = useCallback((layout: LayoutReport) => {
    if (remoteConnected) return;
    command({ type: 'reportLayout', layout });
  }, [command, remoteConnected]);

  const copyPairingUrl = async () => {
    const copied = await copyText(pairingUrl);
    setCopyStatus(copied ? '配对链接已复制' : '复制失败，请长按二维码或使用手动配对');
  };

  const commitDraft = () => {
    if (draft !== state.document.rawText) {
      command({ type: 'setDocument', name: state.document.name, text: draft });
    }
  };

  const resetTypography = () => {
    command({ type: 'setTypography', patch: { ...DEFAULT_TYPOGRAPHY } });
  };

  return (
    <main className="remote-control-app">
      <div className="remote-control-fixed">
        <header className="remote-control-header">
          <div>
            <span className={remoteConnected ? 'remote-dot connected' : 'remote-dot'} />
            <div>
              <strong>Teleprompter Remote</strong>
              <small>{statusLabel(peerState)}</small>
            </div>
          </div>
          <div className="remote-header-actions">
            <span className="remote-page">{pageNumber} / {Math.max(1, state.layout?.pageCount ?? 1)}</span>
            <button onClick={returnToSingleDeviceMode}>一机模式</button>
          </div>
        </header>

        <RemoteProgramPreview state={state} onLayout={reportLocalPreviewLayout} />

        <section className="remote-transport" aria-label="远程播放控制">
          <button aria-label="上一页" onClick={() => command({ type: 'navigatePage', direction: -1 })}><ChevronLeft /></button>
          <button className="remote-play" aria-label="播放或暂停" onClick={() => command({ type: 'togglePlay' })}>
            {state.isPlaying ? <Pause /> : <Play fill="currentColor" />}
          </button>
          <button aria-label="下一页" onClick={() => command({ type: 'navigatePage', direction: 1 })}><ChevronRight /></button>
        </section>
      </div>

      <div className="remote-control-scroll">
        {!remoteConnected && (
          <p className="remote-local-preview-note">
            尚未连接显示设备：当前可直接在本机预览播放、翻页和调速；连接后会自动切换为显示端的真实排版。
          </p>
        )}

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
            {!pairingUrl && !remoteConnected && (
              <button className="remote-primary" onClick={() => void startPairing()}><QrIcon />创建配对二维码</button>
            )}

            {pairingUrl && !remoteConnected && <>
              <p>显示设备可直接进入“远程模式 → 显示端”并调用摄像头扫描，也可以用系统相机扫描下面的二维码。</p>
              <QrCode value={pairingUrl} label="显示设备配对二维码" />
              <div className="remote-pair-actions">
                <button onClick={() => setScannerOpen(true)}><QrIcon />扫描显示端返回码</button>
                <button onClick={() => void copyPairingUrl()}><Copy />复制配对链接</button>
                <button onClick={() => void startPairing()}><RotateCcw />重新生成</button>
              </div>
              {copyStatus && <p className={copyStatus.includes('失败') ? 'remote-error' : 'remote-copy-status'}>{copyStatus}</p>}
              <label className="remote-answer-field">
                <span>无法扫码时粘贴显示端返回信息</span>
                <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="teleprompter-pair-v1:…" />
              </label>
              <button disabled={!answer.trim()} onClick={() => void applyAnswer(answer)}>应用返回信息</button>
            </>}

            {remoteConnected && (
              <p className="remote-connected-note">连接完成。播放、翻页、速度、稿件与排版修改会直接同步到显示设备。</p>
            )}
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
            <label>字重 <output>{state.typography.fontWeight}</output><input type="range" min="100" max="900" step="100" value={state.typography.fontWeight} onChange={(event) => command({ type: 'setTypography', patch: { fontWeight: Number(event.target.value) } })} /></label>
            <label>行距 <output>{state.typography.lineHeight.toFixed(2)}</output><input type="range" min="0.7" max="3" step="0.05" value={state.typography.lineHeight} onChange={(event) => command({ type: 'setTypography', patch: { lineHeight: Number(event.target.value) } })} /></label>
            <label>段落间距 <output>{state.typography.paragraphSpacing.toFixed(2)}</output><input type="range" min="0" max="3" step="0.05" value={state.typography.paragraphSpacing} onChange={(event) => command({ type: 'setTypography', patch: { paragraphSpacing: Number(event.target.value) } })} /></label>
            <label>左右间距 <output>{state.typography.sidePadding}px</output><input type="range" min="0" max="400" step="4" value={Math.min(400, state.typography.sidePadding)} onChange={(event) => command({ type: 'setTypography', patch: { sidePadding: Number(event.target.value) } })} /></label>
            <label>焦点位置 <output>{state.typography.focusPosition}%</output><input type="range" min="10" max="80" value={state.typography.focusPosition} onChange={(event) => command({ type: 'setTypography', patch: { focusPosition: Number(event.target.value) } })} /></label>
            <div className="remote-mirror-setting">
              <span>镜像模式</span>
              <div className="remote-mirror-options">
                {MIRROR_OPTIONS.map(({ mode, label }) => (
                  <button
                    key={mode}
                    className={state.mirrorMode === mode ? 'active' : ''}
                    aria-pressed={state.mirrorMode === mode}
                    onClick={() => command({ type: 'setMirror', mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="remote-setting-actions">
              <button onClick={resetTypography}><RotateCcw />恢复默认排版</button>
            </div>
          </div>
        </details>
      </div>

      {scannerOpen && (
        <QrScanner
          title="扫描显示端返回码"
          hint="对准显示设备上的返回二维码"
          onScan={handleAnswerScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </main>
  );
}
