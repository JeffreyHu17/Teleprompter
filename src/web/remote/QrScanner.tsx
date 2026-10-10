import { useEffect, useRef, useState } from 'react';

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
  const onScanRef = useRef(onScan);
  const hintRef = useRef(hint);
  const [message, setMessage] = useState('正在打开相机…');

  // Updating a callback or hint must not reopen the camera.
  useEffect(() => {
    onScanRef.current = onScan;
    hintRef.current = hint;
  }, [hint, onScan]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let frame = 0;
    let validating = false;

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      if (video && video.srcObject === stream) video.srcObject = null;
      stream = null;
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法调用摄像头');
        // QR decoding is optional, so keep its large dependency out of route startup.
        const { default: jsQR } = await import('jsqr');
        if (cancelled) return;

        const acquiredStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled || !videoRef.current) {
          acquiredStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = acquiredStream;
        video = videoRef.current;
        video.srcObject = acquiredStream;
        await video.play();
        if (cancelled) return;
        setMessage(hintRef.current);

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('无法创建扫码画布');
        let previousScan = 0;

        const resume = (text: string) => {
          if (cancelled) return;
          validating = false;
          setMessage(text);
          frame = requestAnimationFrame(scan);
        };

        const scan = (now: number) => {
          if (cancelled || !video || validating) return;

          if (now - previousScan >= 100 && video.videoWidth > 0 && video.videoHeight > 0) {
            previousScan = now;
            const sourceWidth = video.videoWidth;
            const sourceHeight = video.videoHeight;
            const scale = Math.min(1, 900 / sourceWidth);
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            // Resizing clears and reallocates the canvas; only do it when the video size changes.
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });

            if (code?.data) {
              validating = true;
              setMessage('正在验证二维码…');
              const value = code.data;
              void Promise.resolve().then(() => cancelled || onScanRef.current(value)).then(
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
        stopStream();
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setMessage(`无法打开摄像头：${detail}。可改用复制 / 粘贴配对信息。`);
      }
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopStream();
    };
  }, []);

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
