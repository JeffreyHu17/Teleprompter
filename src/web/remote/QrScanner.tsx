import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export function QrScanner({
  title,
  hint,
  onScan,
  onClose,
}: {
  title: string;
  hint: string;
  onScan: (value: string) => boolean | Promise<boolean>;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('正在打开相机…');

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let validating = false;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法调用摄像头');
        const acquiredStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled || !videoRef.current) {
          acquiredStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = acquiredStream;
        videoRef.current.srcObject = acquiredStream;
        await videoRef.current.play();
        setMessage(hint);

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        let previousScan = 0;

        const resume = (text: string) => {
          if (cancelled) return;
          validating = false;
          setMessage(text);
          frame = requestAnimationFrame(scan);
        };

        const scan = (now: number) => {
          if (cancelled || !videoRef.current || !context || validating) return;

          if (now - previousScan >= 100 && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
            previousScan = now;
            const sourceWidth = videoRef.current.videoWidth;
            const sourceHeight = videoRef.current.videoHeight;
            const scale = Math.min(1, 900 / sourceWidth);
            canvas.width = Math.max(1, Math.round(sourceWidth * scale));
            canvas.height = Math.max(1, Math.round(sourceHeight * scale));
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });

            if (code?.data) {
              validating = true;
              setMessage('正在验证二维码…');
              void Promise.resolve(onScan(code.data)).then(
                (accepted) => {
                  if (!accepted) resume('二维码无效或不匹配，请重新对准');
                },
                () => resume('二维码验证失败，请重新对准'),
              );
              return;
            }
          }

          frame = requestAnimationFrame(scan);
        };

        frame = requestAnimationFrame(scan);
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setMessage(`无法打开摄像头：${detail}。可改用复制 / 粘贴配对信息。`);
      }
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [hint, onScan]);

  return (
    <div className="remote-scanner-backdrop">
      <section className="remote-scanner" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <video ref={videoRef} playsInline muted />
        <p>{message}</p>
        <button onClick={onClose}>关闭扫描</button>
      </section>
    </div>
  );
}
