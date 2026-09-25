import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileUp, FlipHorizontal2, Mic2, MicOff, Pause, Play, Settings2, Type, X } from 'lucide-react';
import { BidirectionalScriptTracker } from '../core/scriptTracker';
import { anchorAt } from '../core/session';
import { useMobileTeleprompter } from './useMobileTeleprompter';
import { AndroidSpeech, type AndroidSpeechEvent } from './androidSpeech';
import { PrompterSurface } from '../components/PrompterSurface';

type MobileSheet = 'script' | 'settings' | null;

export function MobileView() {
  const { state, command } = useMobileTeleprompter();
  const [sheet, setSheet] = useState<MobileSheet>(null);
  const [draft, setDraft] = useState(state.document.rawText);
  const [speechAvailable, setSpeechAvailable] = useState<boolean | null>(null);
  const trackerRef = useRef(new BidirectionalScriptTracker());
  const stateRef = useRef(state);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewport = useViewport();
  const aiListening = state.playbackMode === 'ai' && state.microphoneEnabled;

  useEffect(() => setDraft(state.document.rawText), [state.document.revision]);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    let listener: Awaited<ReturnType<typeof AndroidSpeech.addListener>> | null = null;
    let cancelled = false;
    void AndroidSpeech.availability()
      .then(({ available }) => setSpeechAvailable(available))
      .catch(() => setSpeechAvailable(false));
    void AndroidSpeech.addListener('speechEvent', (event) => handleSpeechEvent(event, stateRef.current, command, trackerRef.current)).then((handle) => {
      if (cancelled) void handle.remove();
      else listener = handle;
    }).catch(() => setSpeechAvailable(false));
    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [command]);

  useEffect(() => {
    if (!aiListening) {
      void AndroidSpeech.stop().catch(() => undefined);
      return;
    }
    trackerRef.current.reset(state.document);
    void AndroidSpeech.start({ locale: state.speech.locale }).catch((error) => command({
      type: 'setTracker',
      status: 'lost',
      patch: { message: error instanceof Error ? error.message : String(error), inputLevel: 0 },
    }));
    return () => { void AndroidSpeech.stop().catch(() => undefined); };
  }, [aiListening, command, state.document, state.speech.locale]);

  const pageLabel = useMemo(() => `${state.anchor.paragraphIndex + 1} / ${state.document.paragraphs.length}`, [state.anchor.paragraphIndex, state.document.paragraphs.length]);
  const commitDraft = () => {
    if (draft !== state.document.rawText) command({ type: 'setDocument', name: state.document.name, text: draft });
  };

  return (
    <main className="mobile-app">
      <header className="mobile-header">
        <div><strong>Teleprompter</strong><span>{pageLabel}</span></div>
        <nav>
          <button aria-label="编辑稿件" title="编辑稿件" onClick={() => setSheet('script')}><Type /></button>
          <button aria-label="显示设置" title="显示设置" onClick={() => setSheet('settings')}><Settings2 /></button>
        </nav>
      </header>

      <section className="mobile-stage">
        <PrompterSurface
          state={state}
          viewportWidth={viewport.width}
          viewportHeight={viewport.height}
          onLayout={(layout) => command({ type: 'reportLayout', layout })}
        />
      </section>

      {state.playbackMode === 'ai' && (
        <section className="mobile-speech-strip">
          <div><span className={state.trackerStatus === 'listening' ? 'status-dot live' : state.trackerStatus === 'lost' ? 'status-dot error' : 'status-dot'} />Android 端侧识别</div>
          <p>{state.speech.transcript || state.speech.message || (speechAvailable === false ? '当前设备没有可用的端侧语言包' : '等待朗读')}</p>
          <div className="mobile-level"><span style={{ width: `${state.speech.inputLevel * 100}%` }} /></div>
        </section>
      )}

      <footer className="mobile-transport">
        <button aria-label="上一段" onClick={() => command({ type: 'navigateParagraph', direction: -1 })}><ChevronLeft /></button>
        <button className="mobile-play" aria-label="播放或暂停" onClick={() => command({ type: 'togglePlay' })}>
          {state.isPlaying ? <Pause /> : <Play fill="currentColor" />}
        </button>
        <button className={state.playbackMode === 'ai' ? 'mobile-ai active' : 'mobile-ai'} aria-label="AI 跟随" onClick={() => command({ type: 'setMode', mode: state.playbackMode === 'ai' ? 'fixed' : 'ai' })}><Mic2 /></button>
        <button aria-label="下一段" onClick={() => command({ type: 'navigateParagraph', direction: 1 })}><ChevronRight /></button>
        {state.playbackMode === 'ai' && <button aria-label={state.microphoneEnabled ? '暂停麦克风' : '继续麦克风'} onClick={() => command({ type: 'setMicrophoneEnabled', enabled: !state.microphoneEnabled })}>{state.microphoneEnabled ? <Mic2 /> : <MicOff />}</button>}
      </footer>

      {sheet && <div className="mobile-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
        <section className="mobile-sheet" role="dialog" aria-modal="true">
          <header><h2>{sheet === 'script' ? '稿件' : '显示设置'}</h2><button aria-label="关闭" onClick={() => setSheet(null)}><X /></button></header>
          {sheet === 'script' ? <>
            <textarea value={draft} aria-label="移动端提词稿" onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft} />
            <button className="mobile-command" onClick={() => fileRef.current?.click()}><FileUp />导入文本</button>
            <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(event) => void importMobileFile(event.target.files?.[0], command)} />
          </> : <MobileSettings state={state} command={command} />}
        </section>
      </div>}
    </main>
  );
}

function MobileSettings({ state, command }: { state: ReturnType<typeof useMobileTeleprompter>['state']; command: ReturnType<typeof useMobileTeleprompter>['command'] }) {
  return <div className="mobile-settings">
    <label>镜像<div className="mobile-segments">{([['none', '正常'], ['horizontal', '水平'], ['vertical', '垂直'], ['both', '双轴']] as const).map(([mode, label]) => <button key={mode} className={state.mirrorMode === mode ? 'active' : ''} onClick={() => command({ type: 'setMirror', mode })}>{label}</button>)}</div></label>
    <label>字号 <input type="range" min="16" max="240" value={state.typography.fontSize} onChange={(event) => command({ type: 'setTypography', patch: { fontSize: Number(event.target.value) } })} /><output>{state.typography.fontSize}px</output></label>
    <label>左右间距 <input type="range" min="0" max="400" step="4" value={Math.min(400, state.typography.sidePadding)} onChange={(event) => command({ type: 'setTypography', patch: { sidePadding: Number(event.target.value) } })} /><output>{state.typography.sidePadding}px</output></label>
    <label>行距 <input type="range" min="0.7" max="3" step="0.05" value={state.typography.lineHeight} onChange={(event) => command({ type: 'setTypography', patch: { lineHeight: Number(event.target.value) } })} /><output>{state.typography.lineHeight.toFixed(2)}</output></label>
    <label>滚速 <input type="range" min="1" max="1000" value={state.scrollSpeedPxPerSecond} onChange={(event) => command({ type: 'setSpeed', speed: Number(event.target.value) })} /><output>{state.scrollSpeedPxPerSecond}px/s</output></label>
    <label className="mobile-engine">识别模型<select value="android-system" disabled><option value="android-system">Android 系统端侧</option></select></label>
    <button className="mobile-command" onClick={() => command({ type: 'setMirror', mode: state.mirrorMode === 'horizontal' ? 'none' : 'horizontal' })}><FlipHorizontal2 />切换水平镜像</button>
  </div>;
}

function handleSpeechEvent(event: AndroidSpeechEvent, state: ReturnType<typeof useMobileTeleprompter>['state'], command: ReturnType<typeof useMobileTeleprompter>['command'], tracker: BidirectionalScriptTracker): void {
  if (event.type === 'level') {
    command({ type: 'setTracker', status: state.trackerStatus, patch: { inputLevel: Math.max(0, Math.min(1, event.level ?? 0)) } });
    return;
  }
  if (event.type === 'error') {
    command({ type: 'setTracker', status: 'lost', patch: { message: event.message ?? '端侧识别失败', inputLevel: 0 } });
    return;
  }
  if (event.type === 'transcript') {
    const transcript = event.text?.trim() ?? '';
    const match = tracker.match(state.document, transcript, state.anchor.globalOffset, event.isFinal ?? false, Date.now(), state.tracking.rewindCharacters);
    command({ type: 'setTracker', status: 'listening', patch: { transcript, asrConfidence: event.confidence ?? null, matchConfidence: match?.confidence ?? null, direction: match?.direction ?? null, onDevice: true, message: match ? null : '正在确认稿件位置' } });
    if (match?.direction === 'backward') command({ type: 'recordReread', event: { documentRevision: state.document.revision, fromOffset: state.anchor.globalOffset, toOffset: match.offset, observedAt: Date.now(), confidence: match.confidence, transcript, timeBasis: 'recognition-observation' } });
    if (match && match.direction !== 'hold') command({ type: 'seek', anchor: anchorAt(state.document, match.offset) });
    return;
  }
  command({ type: 'setTracker', status: event.status === 'listening' ? 'listening' : 'idle', patch: { message: event.message ?? null, onDevice: event.onDevice ?? true } });
}

async function importMobileFile(file: File | undefined, command: ReturnType<typeof useMobileTeleprompter>['command']): Promise<void> {
  if (!file) return;
  command({ type: 'setDocument', name: file.name, text: await file.text() });
}

function useViewport(): { width: number; height: number } {
  const read = () => ({ width: Math.max(320, window.innerWidth), height: Math.max(260, window.innerHeight - 156) });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const update = () => setViewport(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
}
