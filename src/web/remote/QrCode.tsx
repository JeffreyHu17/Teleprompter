import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QrCode({ value, label, size = 260 }: { value: string; label: string; size?: number }) {
  const rendered = useMemo(() => {
    if (!value) return { svg: '', error: null as string | null };
    try {
      const code = qrcode(0, 'L');
      code.addData(value);
      code.make();
      return { svg: code.createSvgTag({ cellSize: 4, margin: 4, scalable: true }), error: null };
    } catch {
      return { svg: '', error: '配对信息超出二维码容量，请使用复制/粘贴方式完成配对。' };
    }
  }, [value]);

  if (rendered.error) return <p className="remote-error">{rendered.error}</p>;
  if (!rendered.svg) return null;

  return (
    <div
      className="remote-qr"
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: rendered.svg }}
    />
  );
}
