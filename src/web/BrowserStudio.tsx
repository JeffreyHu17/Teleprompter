import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileUp, Monitor, Play, Radio, Settings2, Smartphone, Type } from 'lucide-react';
import { DisplayView } from '../desktop/DisplayView';
import { useMobileTeleprompter } from '../mobile/useMobileTeleprompter';
import { DEFAULT_TYPOGRAPHY } from '../core/session';
import { navigateBrowserMode } from './navigation';

export function BrowserStudio() {
  const { state, command } = useMobileTeleprompter();
  const [reading, setReading] = useState(false);
  const [tab, setTab] = useState<'script' | 'settings'>('script');
  const [draft, setDraft] = useState(state.document.rawText);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const typographyFitted = useRef(false);
  useEffect(() => {
    setDraft((current) => current.trim() === state.document.rawText ? current : state.document.rawText);
  }, [state.document.revision]);

  // Desktop side padding and type size must not leave a phone with a one-letter column.
  useEffect(() => {
    if (typographyFitted.current) return;
    typographyFitted.current = true;
    if (state.typography.sidePadding > window.innerWidth * 0.2 || state.typography.fontSize > window.innerWidth * 0.15) {
      command({ type: 'setTypography', patch: { fontSize: 38, sidePadding: 24, lineHeight: 1.65 } });
    }
  }, [command, state.typography.fontSize, state.typography.sidePadding]);

  useEffect(() => {
    if (draft.trim() === state.document.rawText) return;
    const timer = window.setTimeout(() => command({ type: 'setDocument', name: state.document.name, text: draft }), 500);
    return () => window.clearTimeout(timer);
  }, [command, draft, state.document.name, state.document.rawText]);

  const save = () => {
    if (draft.trim() !== state.document.rawText) command({ type: 'setDocument', name: state.document.name, text: draft });
  };
  const remote = (mode: 'control' | 'display') => {
    save();
    navigateBrowserMode(mode);
  };
  const importFile = async (source?: File) => {
    if (!source) return;
    setError('');
    try {
      const text = source.name.toLowerCase().endsWith('.docx')
        ? (await (await import('mammoth')).extractRawText({ arrayBuffer: await source.arrayBuffer() })).value
        : await source.text();
      command({ type: 'setDocument', name: source.name, text });
      setDraft(text);
    } catch (nextError) {
      setError(`导入失败：${nextError instanceof Error ? nextError.message : String(nextError)}`);
    }
    if (file.current) file.current.value = '';
  };
  if (reading) return <DisplayView onExit={() => { command({ type: 'setPlaying', playing: false }); setReading(false); }} />;

  return <main className="browser-studio">
    <header className="studio-header"><span className="brand-mark">TS</span><div><strong>提词工作台</strong><small>随时开讲 · 稿件保存在本机</small></div><span className="studio-device"><Smartphone size={14} />浏览器版</span></header>
    <section className="studio-intro"><span className="eyebrow">READY WHEN YOU ARE</span><h1>准备好，就开讲。</h1><p>一部手机直接提词，也可以连接另一台屏幕。</p></section>
    <section className="studio-modes" aria-label="使用模式">
      <button className="studio-mode-primary" onClick={() => { save(); setReading(true); }}><Smartphone /><div><strong>本机提词</strong><span>在这台设备上全屏阅读</span></div><ArrowRight /></button>
      <button onClick={() => remote('control')}><Radio /><div><strong>双机遥控</strong><span>用手机控制另一台屏幕</span></div><ArrowRight /></button>
      <button className="studio-display-link" onClick={() => remote('display')}><Monitor size={16} />把这台设备作为显示端<ArrowRight size={16} /></button>
    </section>
    <section className="studio-document">
      <nav className="studio-tabs" aria-label="工作台面板">
        <button aria-pressed={tab === 'script'} className={tab === 'script' ? 'active' : ''} onClick={() => setTab('script')}><Type size={16} />稿件</button>
        <button aria-pressed={tab === 'settings'} className={tab === 'settings' ? 'active' : ''} onClick={() => { save(); setTab('settings'); }}><Settings2 size={16} />阅读设置</button>
        <button className="studio-import" onClick={() => file.current?.click()}><FileUp size={16} />导入</button>
      </nav>
      <input type="file" accept=".txt,.md,.docx" hidden ref={file} onChange={(event) => void importFile(event.target.files?.[0])} />
      {error && <p className="remote-error" role="alert">{error}</p>}
      {tab === 'script' ? <>
        <label className="studio-script-label" htmlFor="browser-script"><strong>{state.document.name}</strong><span>{draft.length} 字</span></label>
        <textarea id="browser-script" aria-label="提词稿编辑器" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} spellCheck={false} />
        <p className="studio-save-note">修改后自动保存 · 支持 TXT、Markdown 和 Word</p>
      </> : <div className="studio-settings remote-settings">
        <label>字号<output>{state.typography.fontSize}px</output><input aria-label="字号" type="range" min="20" max="80" value={state.typography.fontSize} onChange={(event) => command({ type: 'setTypography', patch: { fontSize: Number(event.target.value) } })} /></label>
        <label>滚动速度<output>{state.scrollSpeedPxPerSecond} px/s</output><input aria-label="滚动速度" type="range" min="5" max="150" value={state.scrollSpeedPxPerSecond} onChange={(event) => command({ type: 'setSpeed', speed: Number(event.target.value) })} /></label>
        <label>行距<output>{state.typography.lineHeight.toFixed(2)}</output><input aria-label="行距" type="range" min="1" max="2.5" step="0.05" value={state.typography.lineHeight} onChange={(event) => command({ type: 'setTypography', patch: { lineHeight: Number(event.target.value) } })} /></label>
        <label>左右留白<output>{state.typography.sidePadding}px</output><input aria-label="左右留白" type="range" min="8" max="60" value={state.typography.sidePadding} onChange={(event) => command({ type: 'setTypography', patch: { sidePadding: Number(event.target.value) } })} /></label>
        <div className="remote-mirror-setting"><span>镜像</span><div className="remote-mirror-options">{(['none', 'horizontal', 'vertical', 'both'] as const).map((mode, index) => <button key={mode} aria-pressed={state.mirrorMode === mode} className={state.mirrorMode === mode ? 'active' : ''} onClick={() => command({ type: 'setMirror', mode })}>{['正常', '水平', '垂直', '双轴'][index]}</button>)}</div></div>
        <button className="button secondary" onClick={() => command({ type: 'setTypography', patch: { ...DEFAULT_TYPOGRAPHY, fontSize: 38, sidePadding: 24, lineHeight: 1.65 } })}>恢复阅读设置</button>
      </div>}
    </section>
    <footer className="studio-footer"><button onClick={() => { save(); setReading(true); }} disabled={!draft.trim()}><Play size={18} fill="currentColor" />开始提词<ArrowRight size={18} /></button><small>阅读时上下拖动调位置，轻触画面播放或暂停</small></footer>
  </main>;
}
