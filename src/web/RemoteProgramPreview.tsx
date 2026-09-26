import { useEffect, useRef, useState } from 'react';
import { PrompterSurface } from '../components/PrompterSurface';
import type { SessionState } from '../types/session';

export function RemoteProgramPreview({ state }: { state: SessionState }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = Math.max(320, state.layout?.viewportWidth ?? 1280);
  const height = Math.max(240, state.layout?.viewportHeight ?? 720);
  const [scale, setScale] = useState(0.25);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateScale = () => {
      const availableWidth = Math.max(1, frame.clientWidth);
      const availableHeight = Math.max(1, frame.clientHeight);
      setScale(Math.min(availableWidth / width, availableHeight / height));
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    updateScale();
    return () => observer.disconnect();
  }, [height, width]);

  return (
    <section className="remote-program-card">
      <header>
        <div><span>PROGRAM</span><strong>显示预览</strong></div>
        <small>{width} × {height}</small>
      </header>
      <div ref={frameRef} className="remote-program-frame">
        <div
          className="remote-program-viewport"
          style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <PrompterSurface
            state={state}
            viewportWidth={width}
            viewportHeight={height}
            className="remote-program-surface"
            showTextBounds
          />
        </div>
      </div>
    </section>
  );
}
