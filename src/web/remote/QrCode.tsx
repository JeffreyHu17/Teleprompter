import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QrCode({ value, label, size = 260 }: { value: string; label: string; size?: number }) {
  const svg = useMemo(() => {
    if (!value) return '';
    const code = qrcode(0, 'L');
    code.addData(value);
    code.make();
    return code.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }, [value]);

  if (!svg) return null;

  return (
    <div
      className="remote-qr"
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
