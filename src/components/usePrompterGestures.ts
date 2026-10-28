import { useCallback, useRef, type PointerEvent } from 'react';
import type { SessionCommand } from '../types/session';

/** Keep taps, vertical scrubbing and cancelled/multi-touch gestures distinct. */
export function usePrompterGestures({ command, scale = 1, inverted = false, onTap }: {
  command: (command: SessionCommand) => void;
  scale?: number;
  inverted?: boolean;
  onTap?: () => void;
}) {
  const pointer = useRef<{ id: number; x: number; startY: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current || !event.isPrimary) { pointer.current = null; return; }
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,textarea,[data-display-control]')) return;
    pointer.current = { id: event.pointerId, x: event.clientX, startY: event.clientY, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.startY) <= 6) return;
      current.moved = true;
      command({ type: 'setPlaying', playing: false });
    }
    event.preventDefault();
    const delta = (current.y - event.clientY) / Math.max(0.01, scale) * (inverted ? -1 : 1);
    current.y = event.clientY;
    if (delta) command({ type: 'scrollStep', deltaPx: delta });
  }, [command, inverted, scale]);
  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.moved) onTap?.();
  }, [onTap]);
  const onPointerCancel = useCallback(() => { pointer.current = null; }, []);
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel };
}
