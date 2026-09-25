import { useCallback, useEffect, useState } from 'react';
import { useTeleprompter } from './useTeleprompter';
import type { LayoutReport } from '../types/session';
import { PrompterSurface } from '../components/PrompterSurface';

export function DisplayView() {
  const { state, command } = useTeleprompter();
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const reportLayout = useCallback((layout: LayoutReport) => {
    command({ type: 'reportLayout', layout });
  }, [command]);

  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Ignore wakeLock failures
      }
    };
    void requestWakeLock();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      void wakeLock?.release();
    };
  }, []);

  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div onDoubleClick={toggleFullScreen} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <PrompterSurface
        state={state}
        viewportWidth={viewport.width}
        viewportHeight={viewport.height}
        onLayout={reportLayout}
      />
    </div>
  );
}
