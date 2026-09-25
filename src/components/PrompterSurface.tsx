import { rewindRangeStart } from '../core/scriptTracker';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayoutReport, MirrorMode, ScriptAnchor, SessionState } from '../types/session';

function viewTransform(mode: MirrorMode, viewMirrorHorizontal: boolean): string {
  const horizontal = mode === 'horizontal' || mode === 'both' ? -1 : 1;
  const vertical = mode === 'vertical' || mode === 'both' ? -1 : 1;
  return `scale(${viewMirrorHorizontal ? -horizontal : horizontal}, ${vertical})`;
}

interface PrompterSurfaceProps {
  state: SessionState;
  viewportWidth: number;
  viewportHeight: number;
  onLayout?: (layout: LayoutReport) => void;
  className?: string;
  viewMirrorHorizontal?: boolean;
  showTextBounds?: boolean;
}

export function PrompterSurface({
  state,
  viewportWidth,
  viewportHeight,
  onLayout,
  className = '',
  viewMirrorHorizontal = false,
  showTextBounds = false,
}: PrompterSurfaceProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const currentCharacterRef = useRef<HTMLSpanElement>(null);
  const layoutSignatureRef = useRef('');
  const layoutRevisionRef = useRef(0);
  const [anchorY, setAnchorY] = useState(0);
  const { typography, document, anchor } = state;

  const rangeStart = useMemo(() => rewindRangeStart(document.paragraphs.map((paragraph) => paragraph.text).join('\n'), anchor.globalOffset, state.tracking.rewindCharacters), [document.rawText, anchor.globalOffset, state.tracking.rewindCharacters]);
  const showRange = state.playbackMode === 'ai' && (showTextBounds ? state.tracking.showRewindRange : state.tracking.showRewindRangeOnDisplay);
  const rangeText = (text: string, offset: number) => {
    if (!showRange) return text;
    const start = Math.max(0, Math.min(text.length, rangeStart - offset));
    const end = Math.max(start, Math.min(text.length, anchor.globalOffset - offset));
    return <>{text.slice(0, start)}{end > start && <span className="rewind-range" title="回看范围">{text.slice(start, end)}</span>}{text.slice(end)}</>;
  };

  const stageStyle = useMemo(() => ({
    fontFamily: typography.fontFamily,
    fontSize: `${typography.fontSize}px`,
    fontWeight: typography.fontWeight,
    lineHeight: typography.lineHeight,
    color: typography.foreground,
    width: `max(1px, calc(100% - ${typography.sidePadding * 2}px))`,
    textAlign: typography.alignment,
  } as const), [typography]);
  const typographySignature = useMemo(() => JSON.stringify({
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    fontWeight: typography.fontWeight,
    lineHeight: typography.lineHeight,
    paragraphSpacing: typography.paragraphSpacing,
    sidePadding: typography.sidePadding,
    focusPosition: typography.focusPosition,
    alignment: typography.alignment,
  }), [typography]);

  useLayoutEffect(() => {
    const marker = currentCharacterRef.current;
    const active = paragraphRefs.current[anchor.paragraphIndex];
    if (marker) {
      setAnchorY(marker.offsetTop + marker.offsetHeight / 2);
      return;
    }
    if (active) setAnchorY(active.offsetTop);
  }, [anchor.charOffset, anchor.paragraphIndex, document.revision, typography]);

  useLayoutEffect(() => {
    if (!onLayout) return;
    layoutSignatureRef.current = '';
    let cancelled = false;
    let frame = 0;
    const reportLayout = () => {
      const stage = stageRef.current;
      const paragraphElements = paragraphRefs.current.slice(0, document.paragraphs.length);
      if (cancelled || !stage || !paragraphElements.length) return;
      const focusY = viewportHeight * typography.focusPosition / 100;
      const pageHeight = Math.max(200, viewportHeight - focusY * 0.65);
      const pageAnchors: ScriptAnchor[] = [];
      const pageScrollOffsets: number[] = [];
      const paragraphScrollOffsets = paragraphElements.map((element) => element?.offsetTop ?? 0);

      for (let pageY = 0; pageY < stage.scrollHeight; pageY += pageHeight) {
        pageScrollOffsets.push(pageY);
        let paragraphIndex = paragraphElements.findIndex((element) => (
          Boolean(element) && pageY >= element!.offsetTop && pageY < element!.offsetTop + element!.offsetHeight
        ));
        if (paragraphIndex < 0) paragraphIndex = Math.max(0, document.paragraphs.length - 1);
        const element = paragraphElements[paragraphIndex];
        const paragraph = document.paragraphs[paragraphIndex];
        const relative = element
          ? Math.max(0, Math.min(1, (pageY - element.offsetTop) / Math.max(1, element.offsetHeight)))
          : 0;
        const charOffset = Math.round(paragraph.text.length * relative);
        pageAnchors.push({
          paragraphId: paragraph.id,
          paragraphIndex,
          charOffset,
          globalOffset: paragraph.startOffset + charOffset,
        });
      }

      const layout: LayoutReport = {
        revision: layoutRevisionRef.current + 1,
        documentRevision: document.revision,
        pageAnchors,
        pageCount: pageAnchors.length,
        viewportWidth,
        viewportHeight,
        documentHeight: stage.scrollHeight,
        textWidthPx: stage.offsetWidth,
        pageScrollOffsets,
        paragraphScrollOffsets,
      };
      const signature = JSON.stringify({
        typographySignature,
        documentRevision: layout.documentRevision,
        viewportWidth,
        viewportHeight,
        anchors: pageAnchors.map((item) => item.globalOffset),
        documentHeight: layout.documentHeight,
        textWidthPx: layout.textWidthPx,
        pageScrollOffsets,
        paragraphScrollOffsets,
      });
      if (signature === layoutSignatureRef.current) return;
      layoutRevisionRef.current = layout.revision;
      layoutSignatureRef.current = signature;
      onLayout(layout);
    };

    const scheduleReport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reportLayout);
    };
    frame = requestAnimationFrame(() => {
      reportLayout();
      scheduleReport();
    });
    const observer = new ResizeObserver(scheduleReport);
    if (stageRef.current) observer.observe(stageRef.current);
    paragraphRefs.current.slice(0, document.paragraphs.length).forEach((element) => {
      if (element) observer.observe(element);
    });

    const fonts = window.document.fonts;
    const onFontsLoaded = () => scheduleReport();
    fonts.addEventListener('loadingdone', onFontsLoaded);
    const fontDeclaration = `${typography.fontWeight} ${typography.fontSize}px ${typography.fontFamily}`;
    void fonts.load(fontDeclaration, document.rawText.slice(0, 128)).then(onFontsLoaded, scheduleReport);
    void fonts.ready.then(onFontsLoaded, scheduleReport);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      fonts.removeEventListener('loadingdone', onFontsLoaded);
    };
  }, [document.paragraphs, document.rawText, document.revision, onLayout, typography, typographySignature, viewportHeight, viewportWidth]);

  const focusY = viewportHeight * typography.focusPosition / 100;
  const translateY = state.playbackMode === 'ai'
    ? focusY - anchorY
    : focusY - state.scrollOffsetPx;
  return (
    <div
      className={`prompter-output ${className}`.trim()}
      style={{ width: viewportWidth, height: viewportHeight, backgroundColor: typography.background }}
      aria-label="提词器显示窗口"
    >
      {showTextBounds && (
        <div
          className="text-width-guides"
          aria-label="提词窗口边界"
          data-viewport-width={viewportWidth}
        >
          <span />
          <span />
        </div>
      )}
      <div className="prompter-mirror-layer" style={{ transform: viewTransform(state.mirrorMode, viewMirrorHorizontal) }}>
        {state.playbackMode === 'ai' && (
          <div
            className="focus-band"
            style={{
              top: `${typography.focusPosition}%`,
              height: `${typography.fontSize * typography.lineHeight}px`,
              backgroundColor: typography.focusColor,
              opacity: typography.focusOpacity,
            }}
          />
        )}
        <div
          ref={stageRef}
          className={`prompter-stage ${state.isPlaying && state.playbackMode === 'fixed' ? 'is-playing' : ''}`.trim()}
          style={{
            ...stageStyle,
            '--paragraph-spacing': `${typography.paragraphSpacing}em`,
            '--stage-y': `${Number(translateY.toFixed(2))}px`,
          } as React.CSSProperties}
        >
        {document.paragraphs.map((paragraph, index) => {
          const current = state.playbackMode === 'ai' && index === anchor.paragraphIndex;
          const latinAtAnchor = current && /[A-Za-z0-9]/.test(paragraph.text[anchor.charOffset] ?? '');
          let markerStart = anchor.charOffset;
          let markerEnd = anchor.charOffset + 1;
          if (latinAtAnchor) {
            while (markerStart > 0 && /[A-Za-z0-9'_-]/.test(paragraph.text[markerStart - 1])) markerStart -= 1;
            while (markerEnd < paragraph.text.length && /[A-Za-z0-9'_-]/.test(paragraph.text[markerEnd])) markerEnd += 1;
          }
          const read = current ? paragraph.text.slice(0, markerStart) : '';
          const marker = current ? paragraph.text.slice(markerStart, markerEnd) : '';
          const unread = current ? paragraph.text.slice(markerEnd) : paragraph.text;
          return (
            <p
              key={paragraph.id}
              ref={(element) => { paragraphRefs.current[index] = element; }}
              className={state.playbackMode === 'ai' && index < anchor.paragraphIndex ? 'is-read' : current ? 'is-current' : ''}
            >
              {current ? <><span className="read-text">{rangeText(read, paragraph.startOffset)}</span><span ref={currentCharacterRef} className="current-character">{marker || ' '}</span>{unread}</> : rangeText(unread, paragraph.startOffset)}
            </p>
          );
        })}
        </div>
      </div>
      <div className="display-status" aria-hidden="true">
        <span className={state.isPlaying ? 'status-dot live' : 'status-dot'} />
        {state.playbackMode === 'ai' ? 'AI' : `${state.scrollSpeedPxPerSecond} px/s`}
      </div>
    </div>
  );
}
