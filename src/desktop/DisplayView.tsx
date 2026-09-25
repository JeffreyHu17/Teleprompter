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

  return (
    <PrompterSurface
      state={state}
      viewportWidth={viewport.width}
      viewportHeight={viewport.height}
      onLayout={reportLayout}
    />
  );
}
