import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Copy, RotateCcw } from 'lucide-react';
import { QrCode } from './remote/QrCode';
import { QrScanner } from './remote/QrScanner';
import { copyText } from './remote/clipboard';
import {
  extractPairingPayload,
  pairingPayloadFromLocation,
  RemotePeer,
  type RemotePeerSnapshot,
} from './remote/remotePeer';

export function RemoteDisplayPairing() {
  const peerRef = useRef<RemotePeer | null>(null);
  if (!peerRef.current) peerRef.current = new RemotePeer('display');
  const peer = peerRef.current;

  const [snapshot, setSnapshot] = useState<RemotePeerSnapshot>(peer.current());
  const [answer, setAnswer] = useState('');
  const [manualOffer, setManualOffer] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => peer.subscribe(setSnapshot), [peer]);
  useEffect(() => () => peer.close(), [peer]);

  const acceptOffer = useCallback(async (value: string) => {
    const payload = extractPairingPayload(value);
    if (!payload) {
      setError('没有在二维码或文本中找到有效的主控配对信息');
      return;
    }

    setError(null);
    setCopyStatus(null);
    try {
      const nextAnswer = await peer.acceptOffer(payload);
      setAnswer(nextAnswer);
      setScannerOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [peer]);

  useEffect(() => {
    if (startedRef.current) return;
    const payload = pairingPayloadFromLocation();
    if (!payload) return;
    startedRef.current = true;
    void acceptOffer(payload);
  }, [acceptOffer]);

  useEffect(() => {
    if (snapshot.status !== 'connected') return;
    const url = new URL(window.location.href);
    url.hash = '';
    history.replaceState(null, '', url);
  }, [snapshot.status]);

  const copyAnswer = async () => {
    const copied = await copyText(answer);
    setCopyStatus(copied ? '返回信息已复制' : '复制失败，请长按文本或改用二维码扫描');
  };

  const resetPairing = () => {
    peer.close();
    setAnswer('');
    setManualOffer('');
    setError(null);
    setCopyStatus(null);
    startedRef.current = false;
  };

  if (snapshot.status === 'connected') return null;

  return (
    <div className="remote-display-pairing">
      <section>
        <span className="remote-display-kicker">REMOTE DISPLAY</span>
        <h1>{answer ? '请主控扫描返回码' : '连接主控设备'}</h1>

        {answer ? <>
          <p>保持此页面打开，在主控设备的“远程显示”区域扫描下面的返回二维码。连接成功后本提示会自动消失。</p>
          <QrCode value={answer} label="返回主控设备的配对二维码" size={300} />
          <div className="remote-pair-actions">
            <button onClick={() => void copyAnswer()}><Copy />复制返回信息</button>
            <button onClick={resetPairing}><RotateCcw />重新配对</button>
          </div>
          {copyStatus && <p className={copyStatus.includes('失败') ? 'remote-error' : 'remote-copy-status'}>{copyStatus}</p>}
          <label className="remote-answer-field">
            <span>返回信息（可长按手动复制）</span>
            <textarea readOnly value={answer} onFocus={(event) => event.currentTarget.select()} />
          </label>
        </> : <>
          <p>点击下面的按钮直接调用摄像头扫描主控二维码；也可以粘贴主控生成的配对链接或原始配对信息。</p>
          <button className="remote-primary" onClick={() => setScannerOpen(true)}><Camera />扫描主控二维码</button>
          <textarea value={manualOffer} onChange={(event) => setManualOffer(event.target.value)} placeholder="粘贴主控配对链接或 teleprompter-pair-v1:…" />
          <button disabled={!manualOffer.trim()} onClick={() => void acceptOffer(manualOffer.trim())}>连接主控</button>
        </>}

        {snapshot.status === 'preparing' && <p>正在准备本地 P2P 连接…</p>}
        {snapshot.status === 'connecting' && <p>正在建立连接…</p>}
        {(error || snapshot.error) && <p className="remote-error">{error || snapshot.error}</p>}
      </section>

      {scannerOpen && (
        <QrScanner
          title="扫描主控二维码"
          hint="对准主控设备上的配对二维码"
          onScan={(value) => void acceptOffer(value)}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}
