import { useEffect, useRef, useState } from 'react';
import { usePrompterGestures } from '../components/usePrompterGestures';
import { PrompterSurface } from '../components/PrompterSurface';
import type { LayoutReport, SessionState } from '../types/session';

export function RemoteProgramPreview({
  state,
  onLayout,
  command,
  outputConnected = false,
}: {
  state: SessionState;
  onLayout?: (layout: LayoutReport) => void;
  outputConnected?: boolean;
  command: (command: import('../types/session').SessionCommand) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = Math.max(320, outputConnected ? state.layout?.viewportWidth ?? 1280 : 1280);
  const height = Math.max(240, outputConnected ? state.layout?.viewportHeight ?? 720 : 720);
  const [scale, setScale] = useState(0.25);
  const gestures = usePrompterGestures({ command, scale, inverted: state.mirrorMode === 'vertical' || state.mirrorMode === 'both' });

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
        <small>上下拖动调整位置</small>
      </header>
      <div ref={frameRef} className="remote-program-frame" {...gestures}>
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
            onLayout={onLayout}
          />
        </div>
      </div>
    </section>
  );
}
