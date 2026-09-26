import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FlipHorizontal2, Maximize2, Minus, Pause, Play, Plus } from 'lucide-react';
import { useTeleprompter } from './useTeleprompter';
import type { LayoutReport, MirrorMode, SessionCommand } from '../types/session';
import { PrompterSurface } from '../components/PrompterSurface';
import { anchorAt } from '../core/session';

interface DisplayPointerState {
  pointerId: number;
  pointerType: string;
  startY: number;
  y: number;
  moved: boolean;
}

const MIRROR_OPTIONS: Array<{ mode: MirrorMode; label: string }> = [
  { mode: 'none', label: '正常' },
  { mode: 'horizontal', label: '水平' },
  { mode: 'vertical', label: '垂直' },
  { mode: 'both', label: '双轴' },
];

export function DisplayView() {
  const { state, command } = useTeleprompter();
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [controlsVisible, setControlsVisible] = useState(true);
  const [mirrorMenuOpen, setMirrorMenuOpen] = useState(false);
  const pointerRef = useRef<DisplayPointerState | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const reportLayout = useCallback((layout: LayoutReport) => {
    command({ type: 'reportLayout', layout });
  }, [command]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      setMirrorMenuOpen(false);
      hideTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    };
  }, [revealControls]);

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

  const schedulePlayToggle = useCallback(() => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      command({ type: 'togglePlay' });
      clickTimerRef.current = null;
    }, 220);
  }, [command]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    revealControls();
    const target = event.target as HTMLElement;
    if (target.closest('[data-display-control]')) return;

    pointerRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startY: event.clientY,
      y: event.clientY,
      moved: false,
    };

    if (event.pointerType === 'touch') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }, [revealControls]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    revealControls();
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;

    if (Math.abs(event.clientY - pointer.startY) > 6) pointer.moved = true;
    if (pointer.pointerType !== 'touch') return;

    const delta = pointer.y - event.clientY;
    pointer.y = event.clientY;
    if (Math.abs(delta) < 0.5) return;
    event.preventDefault();
    command({ type: 'scrollStep', deltaPx: delta });
  }, [command, revealControls]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerRef.current = null;

    if (pointer.pointerType === 'touch') {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released by the browser.
      }
    }

    if (!pointer.moved) schedulePlayToggle();
  }, [schedulePlayToggle]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.pointerId === event.pointerId) pointerRef.current = null;
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    revealControls();
    toggleFullScreen();
  }, [revealControls, toggleFullScreen]);

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
        revealControls();
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
        revealControls();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [command, revealControls, state.isPlaying, state.document, toggleFullScreen]);

  return (
    <div
      className="display-touch-surface"
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}
    >
      <PrompterSurface
        state={state}
        viewportWidth={viewport.width}
        viewportHeight={viewport.height}
        onLayout={reportLayout}
      />

      <div
        className={`display-mirror-menu ${controlsVisible && mirrorMenuOpen ? 'is-visible' : ''}`}
        data-display-control
        onPointerDown={(event) => {
          event.stopPropagation();
          revealControls();
        }}
      >
        <span>镜像模式</span>
        <div>
          {MIRROR_OPTIONS.map(({ mode, label }) => (
            <button
              key={mode}
              className={state.mirrorMode === mode ? 'active' : ''}
              aria-pressed={state.mirrorMode === mode}
              onClick={() => {
                command({ type: 'setMirror', mode });
                setMirrorMenuOpen(false);
                revealControls();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`display-control-bar ${controlsVisible ? 'is-visible' : ''}`}
        data-display-control
        onPointerDown={(event) => {
          event.stopPropagation();
          revealControls();
        }}
      >
        <button title="上一页" aria-label="上一页" onClick={() => command({ type: 'navigatePage', direction: -1 })}><ChevronLeft /></button>
        <button title="降低速度" aria-label="降低速度" onClick={() => command({ type: 'adjustSpeed', delta: -10 })}><Minus /></button>
        <button className="display-control-play" title="播放或暂停" aria-label="播放或暂停" onClick={() => command({ type: 'togglePlay' })}>
          {state.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <span>{Math.round(state.scrollSpeedPxPerSecond)} px/s</span>
        <button title="提高速度" aria-label="提高速度" onClick={() => command({ type: 'adjustSpeed', delta: 10 })}><Plus /></button>
        <button title="下一页" aria-label="下一页" onClick={() => command({ type: 'navigatePage', direction: 1 })}><ChevronRight /></button>
        <button
          title="镜像模式"
          aria-label="镜像模式"
          aria-expanded={mirrorMenuOpen}
          onClick={() => {
            setMirrorMenuOpen((current) => !current);
            revealControls();
          }}
        >
          <FlipHorizontal2 />
        </button>
        <button title="全屏" aria-label="全屏" onClick={() => { revealControls(); toggleFullScreen(); }}><Maximize2 /></button>
      </div>
    </div>
  );
}
