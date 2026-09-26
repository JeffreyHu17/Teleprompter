import { useEffect, useRef, useState } from 'react';
import { Copy, RotateCcw } from 'lucide-react';
import { QrCode } from './remote/QrCode';
import { pairingPayloadFromLocation, RemotePeer, type RemotePeerSnapshot } from './remote/remotePeer';

export function RemoteDisplayPairing() {
  const peerRef = useRef<RemotePeer | null>(null);
  if (!peerRef.current) peerRef.current = new RemotePeer('display');
  const peer = peerRef.current;
  const [snapshot, setSnapshot] = useState<RemotePeerSnapshot>(peer.current());
  const [answer, setAnswer] = useState('');
  const [manualOffer, setManualOffer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => peer.subscribe(setSnapshot), [peer]);
  useEffect(() => () => peer.close(), [peer]);

  const acceptOffer = async (payload: string) => {
    setError(null);
    try {
      const nextAnswer = await peer.acceptOffer(payload);
      setAnswer(nextAnswer);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    const payload = pairingPayloadFromLocation();
    if (!payload) return;
    startedRef.current = true;
    void acceptOffer(payload);
  }, []);

  useEffect(() => {
    if (snapshot.status !== 'connected') return;
    const url = new URL(window.location.href);
    url.hash = '';
    history.replaceState(null, '', url);
  }, [snapshot.status]);

  if (snapshot.status === 'connected') return null;

  return (
    <div className="remote-display-pairing">
      <section>
        <span className="remote-display-kicker">REMOTE DISPLAY</span>
        <h1>{answer ? '请主控扫描返回码' : '连接主控设备'}</h1>
        {answer ? <>
          <p>保持此页面打开，在主控设备的“远程显示”区域选择“扫描显示端返回码”。连接成功后本提示会自动消失。</p>
          <QrCode value={answer} label="返回主控设备的配对二维码" size={300} />
          <div className="remote-pair-actions">
            <button onClick={() => void navigator.clipboard?.writeText(answer)}><Copy />复制返回信息</button>
            <button onClick={() => { peer.close(); setAnswer(''); startedRef.current = false; }}><RotateCcw />重新配对</button>
          </div>
        </> : <>
          <p>推荐直接使用本设备的系统相机扫描主控设备二维码，它会自动打开当前站点的显示模式。也可以在这里粘贴主控配对信息。</p>
          <textarea value={manualOffer} onChange={(event) => setManualOffer(event.target.value)} placeholder="teleprompter-pair-v1:…" />
          <button disabled={!manualOffer.trim()} onClick={() => void acceptOffer(manualOffer.trim())}>连接主控</button>
        </>}
        {snapshot.status === 'preparing' && <p>正在准备本地 P2P 连接…</p>}
        {snapshot.status === 'connecting' && <p>正在建立连接…</p>}
        {(error || snapshot.error) && <p className="remote-error">{error || snapshot.error}</p>}
      </section>
    </div>
  );
}
