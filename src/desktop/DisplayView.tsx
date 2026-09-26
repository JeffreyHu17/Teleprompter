import { useCallback, useEffect, useState } from 'react';
import { useTeleprompter } from './useTeleprompter';
import type { LayoutReport, SessionCommand } from '../types/session';
import { PrompterSurface } from '../components/PrompterSurface';
import { anchorAt } from '../core/session';

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLInputElement && /^(text|search|password|email|number|tel|url)$/i.test(target.type)) return;

      const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar' || event.keyCode === 32;
      const isEnter = event.code === 'Enter' || event.key === 'Enter' || event.keyCode === 13;
      const isRight = event.code === 'ArrowRight' || event.key === 'ArrowRight' || event.key === 'Right' || event.keyCode === 39;
      const isLeft = event.code === 'ArrowLeft' || event.key === 'ArrowLeft' || event.key === 'Left' || event.keyCode === 37;
      const isDown = event.code === 'ArrowDown' || event.key === 'ArrowDown' || event.key === 'Down' || event.keyCode === 40;
      const isUp = event.code === 'ArrowUp' || event.key === 'ArrowUp' || event.key === 'Up' || event.keyCode === 38;
      const isPageDown = event.code === 'PageDown' || event.key === 'PageDown' || event.keyCode === 34;
      const isPageUp = event.code === 'PageUp' || event.key === 'PageUp' || event.keyCode === 33;
      const isHome = event.code === 'Home' || event.key === 'Home' || event.keyCode === 36;

      const isBracketLeft = event.code === 'BracketLeft' || event.key === '[' || event.key === '【' || event.code === 'Minus' || event.key === '-';
      const isBracketRight = event.code === 'BracketRight' || event.key === ']' || event.key === '】' || event.code === 'Equal' || event.key === '=' || event.key === '+';

      let next: SessionCommand | null = null;
      if (isSpace || isEnter) {
        next = { type: 'togglePlay' };
      } else if (isRight || isPageDown) {
        next = { type: event.shiftKey ? 'navigateParagraph' : 'navigatePage', direction: 1 };
      } else if (isLeft || isPageUp) {
        next = { type: event.shiftKey ? 'navigateParagraph' : 'navigatePage', direction: -1 };
      } else if (isDown) {
        next = state.isPlaying ? { type: 'adjustSpeed', delta: -10 } : { type: 'scrollStep', deltaPx: 60 };
      } else if (isUp) {
        next = state.isPlaying ? { type: 'adjustSpeed', delta: 10 } : { type: 'scrollStep', deltaPx: -60 };
      } else if (isBracketLeft) {
        next = { type: 'adjustSpeed', delta: -10 };
      } else if (isBracketRight) {
        next = { type: 'adjustSpeed', delta: 10 };
      } else if (isHome) {
        next = { type: 'seek', anchor: anchorAt(state.document, 0) };
      } else if (event.key === 'f' || event.key === 'F') {
        toggleFullScreen();
        event.preventDefault();
        event.stopPropagation();
        return;
      } else if (event.key === 'Escape') {
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        } else if (state.isPlaying) {
          next = { type: 'setPlaying', playing: false };
        }
      }

      if (next) {
        event.preventDefault();
        event.stopPropagation();
        command(next);
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [command, state.isPlaying, state.document, toggleFullScreen]);

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
