import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileUp,
  FlipHorizontal2,
  ExternalLink,
  FolderOpen,
  HardDriveDownload,
  Keyboard,
  Library,
  LoaderCircle,
  Maximize2,
  Mic2,
  MicOff,
  MonitorUp,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RotateCcw,
  Settings2,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useTeleprompter } from './useTeleprompter';
import type { FunAsrBackend, FunAsrModelId, MirrorMode, SessionCommand } from '../types/session';
import { PrompterSurface } from '../components/PrompterSurface';
import { platformCapabilities } from './capabilities';

const FONT_OPTIONS = [
  { label: '梦源黑体', value: '"Dream Han Sans CN", system-ui' },
  { label: '梦源宋体', value: '"Dream Han Serif CN", serif' },
  { label: '系统无衬线', value: 'system-ui' },
  { label: '苹方 / 微软雅黑', value: '"PingFang SC", "Microsoft YaHei", system-ui' },
  { label: '宋体', value: 'SimSun, "Songti SC", serif' },
  { label: '等宽', value: '"SFMono-Regular", Consolas, monospace' },
];

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function ControlView() {
  const { state, displays, audioInputs, refreshAudioInputs, command, toggleDisplay, importScript, openSpeechSettings, installFunAsr, inspectFunAsr, openFunAsrModels, deleteFunAsrModel } = useTeleprompter();
  const [draft, setDraft] = useState(state.document.rawText);
  const [previewMirror, setPreviewMirror] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<'output' | 'speech' | 'help'>('output');
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [paragraphsCollapsed, setParagraphsCollapsed] = useState(false);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const [modelActionError, setModelActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const paragraph = state.document.paragraphs[state.anchor.paragraphIndex];
  const previewDisplay = displays.find((display) => display.id === state.selectedDisplayId)
    ?? displays.find((display) => !display.primary)
    ?? displays[0];
  const maxScroll = Math.max(
    0,
    (state.layout?.documentHeight ?? 0) - state.typography.fontSize * state.typography.lineHeight,
  );
  const progress = state.playbackMode === 'fixed'
    ? maxScroll > 0 ? Math.round(state.scrollOffsetPx / maxScroll * 100) : 0
    : state.document.totalCharacters
      ? Math.round(state.anchor.globalOffset / state.document.totalCharacters * 100)
      : 0;

  useEffect(() => setDraft(state.document.rawText), [state.document.revision]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      let next: SessionCommand | null = null;
      if (event.code === 'Space') next = { type: 'togglePlay' };
      else if (event.key === 'ArrowLeft') next = { type: event.shiftKey ? 'navigateParagraph' : 'navigatePage', direction: -1 };
      else if (event.key === 'ArrowRight') next = { type: event.shiftKey ? 'navigateParagraph' : 'navigatePage', direction: 1 };
      else if (event.key === 'ArrowUp') next = { type: 'adjustSpeed', delta: 10 };
      else if (event.key === 'ArrowDown') next = { type: 'adjustSpeed', delta: -10 };
      else if (event.key === 'PageUp') next = { type: 'rewindStep' };
      else if (event.key === 'Enter') next = { type: 'togglePlay' };
      if (next) {
        event.preventDefault();
        command(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [command]);

  const commitDraft = () => {
    if (draft !== state.document.rawText) command({ type: 'setDocument', name: state.document.name, text: draft });
  };

  const openImport = async () => {
    const imported = await importScript();
    if (imported) command({ type: 'setDocument', ...imported });
    else if (!window.teleprompter) fileRef.current?.click();
  };

  const handleBrowserFile = async (file?: File) => {
    if (!file) return;
    command({ type: 'setDocument', name: file.name, text: await file.text() });
  };

  const pageNumber = useMemo(() => {
    const pages = state.layout?.pageAnchors ?? [];
    let current = 0;
    pages.forEach((anchor, index) => {
      if (anchor.globalOffset <= state.anchor.globalOffset) current = index;
    });
    return pages.length ? `${current + 1} / ${pages.length}` : '未分页';
  }, [state.anchor.globalOffset, state.layout]);
  const capabilities = platformCapabilities();
  const systemSpeechLabel = capabilities.platform === 'macos' ? 'Apple 系统' : 'Windows 系统';
  const trackerLabel = state.playbackMode !== 'ai'
    ? '定速跟随'
    : state.trackerStatus === 'paused'
      ? '麦克风已暂停'
    : state.trackerStatus === 'listening'
      ? state.speech.engine === 'funasr' ? 'FunASR 本地识别中' : `${capabilities.platform === 'windows' ? 'Windows' : 'Apple'} 系统识别中`
      : state.trackerStatus === 'lost'
        ? '本地识别异常'
        : '正在启动本地识别';
  const selectedFunAsrModel = state.funasr.models.find((model) => model.id === state.funasr.model);
  const streamingFunAsr = state.funasr.model === 'paraformer-streaming-int8' || state.funasr.model === 'paraformer-streaming-fp32';
  const rendererMicrophoneProcessing = streamingFunAsr || capabilities.platform === 'windows';
  const systemVoiceProcessing = state.microphoneProcessing.noiseSuppression
    || state.microphoneProcessing.autoGainControl
    || state.microphoneProcessing.echoCancellation;

  useEffect(() => {
    if (!modelManagerOpen) return;
    void inspectFunAsr();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelManagerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectFunAsr, modelManagerOpen]);

  return (
    <main className="control-app">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">TS</div>
          <div>
            <h1>Teleprompter Studio</h1>
            <p>{state.document.name}</p>
          </div>
        </div>
        <div className="header-status">
          <span className={state.trackerStatus === 'listening' ? 'status-dot live' : state.trackerStatus === 'lost' ? 'status-dot error' : 'status-dot'} />
          <span>{trackerLabel}</span>
          <span className="header-divider" />
          <span>{pageNumber}</span>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={() => void openImport()}><FileUp size={17} />导入稿件</button>
          <button className="button primary" onClick={() => toggleDisplay(!state.displayOpen)}>
            <MonitorUp size={17} />{state.displayOpen ? '关闭显示' : '打开显示'}
          </button>
          <input ref={fileRef} type="file" accept=".txt,.md" hidden onChange={(event) => void handleBrowserFile(event.target.files?.[0])} />
        </div>
      </header>

      <section className="transport-bar" aria-label="播放控制">
        <button className="icon-button" title="上一页" onClick={() => command({ type: 'navigatePage', direction: -1 })}><ChevronLeft /></button>
        <button className="play-button" title="播放或暂停" onClick={() => command({ type: 'togglePlay' })}>
          {state.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button className="icon-button" title="下一页" onClick={() => command({ type: 'navigatePage', direction: 1 })}><ChevronRight /></button>
        <button className="icon-button" title="向上回滚" onClick={() => command({ type: 'rewindStep' })}><RotateCcw /></button>
        <div className={state.playbackMode === 'ai' ? 'transport-field speed-field inactive' : 'transport-field speed-field'}>
          <span>滚速</span>
          <HoldAdjustButton label="降低滚动速度" delta={-20} onAdjust={(delta) => command({ type: 'adjustSpeed', delta })}>-</HoldAdjustButton>
          <input
            className="speed-input"
            type="number"
            min={1}
            max={2000}
            value={state.scrollSpeedPxPerSecond}
            aria-label="滚动速度"
            onChange={(event) => command({ type: 'setSpeed', speed: Number(event.target.value) })}
          />
          <HoldAdjustButton label="提高滚动速度" delta={20} onAdjust={(delta) => command({ type: 'adjustSpeed', delta })}>+</HoldAdjustButton>
          <small>px/s</small>
        </div>
        <div className="segmented-control" aria-label="播放模式">
          <button className={state.playbackMode === 'fixed' ? 'active' : ''} onClick={() => command({ type: 'setMode', mode: 'fixed' })}>定速</button>
          <button className={state.playbackMode === 'ai' ? 'active' : ''} onClick={() => command({ type: 'setMode', mode: 'ai' })}><Mic2 size={14} />AI 跟随</button>
        </div>
        <div className="progress-block">
          <div><span>稿件进度</span><strong>{progress}%</strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        </div>
      </section>

      <div className={`workspace${editorCollapsed ? ' editor-collapsed' : ''}${settingsCollapsed ? ' settings-collapsed' : ''}`}>
        <section className="editor-pane">
          <div className="pane-heading">
            <div><span className="eyebrow">SCRIPT</span><h2>稿件编辑</h2></div>
            <div className="pane-heading-actions">
              <span>{state.document.totalCharacters} 字 · {state.document.paragraphs.length} 段</span>
              <button className="icon-button compact" title="折叠稿件编辑" aria-label="折叠稿件编辑" onClick={() => setEditorCollapsed(true)}><PanelLeftClose /></button>
            </div>
          </div>
          <textarea
            value={draft}
            spellCheck={false}
            style={{
              fontFamily: state.typography.fontFamily,
              fontSize: `${Math.max(12, Math.min(48, state.typography.fontSize * 0.3))}px`,
              fontWeight: state.typography.fontWeight,
              lineHeight: state.typography.lineHeight,
            }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            aria-label="提词稿编辑器"
          />
          <footer className="editor-footer">
            <span>当前段落 {state.anchor.paragraphIndex + 1}</span>
            <span className="current-line">{paragraph?.text.slice(Math.max(0, state.anchor.charOffset - 12), state.anchor.charOffset + 28)}</span>
          </footer>
        </section>

        {editorCollapsed && (
          <button
            className="collapsed-pane-rail left"
            title="展开稿件编辑"
            aria-label="展开稿件编辑"
            onClick={() => setEditorCollapsed(false)}
          >
            <PanelLeftOpen />
          </button>
        )}

        <section className={`preview-pane${state.playbackMode === 'ai' ? ' ai-active' : ''}${paragraphsCollapsed ? ' paragraphs-collapsed' : ''}`}>
          <div className="pane-heading">
            <div><span className="eyebrow">PROGRAM</span><h2>显示预览</h2></div>
            <div className="preview-actions">
              <button
                className={previewMirror ? 'icon-button compact active' : 'icon-button compact'}
                title="仅镜像控制台预览"
                aria-label="镜像查看"
                aria-pressed={previewMirror}
                onClick={() => setPreviewMirror((current) => !current)}
              >
                <FlipHorizontal2 />
              </button>
              <button className="icon-button compact" title="打开显示窗口" onClick={() => toggleDisplay(true)}><Maximize2 /></button>
            </div>
          </div>
          <ProgramMonitor
            state={state}
            width={state.layout?.viewportWidth ?? previewDisplay?.width ?? 1280}
            height={state.layout?.viewportHeight ?? previewDisplay?.height ?? 720}
            viewMirrorHorizontal={previewMirror}
          />
          {state.playbackMode === 'ai' && (
            <section className={state.trackerStatus === 'lost' ? 'speech-monitor error' : 'speech-monitor'} aria-label="本地语音跟踪状态">
              <div className="speech-monitor-heading">
                <span><span className={state.trackerStatus === 'listening' ? 'status-dot live' : state.trackerStatus === 'lost' ? 'status-dot error' : 'status-dot'} />{trackerLabel}</span>
                <span className="speech-monitor-actions">
                  <span>{state.speech.engine === 'funasr' ? `${selectedFunAsrModel?.name ?? 'FunASR'} ${selectedFunAsrModel?.variant ?? ''} · ${state.funasr.resolvedBackend ?? '待选择'}` : `${systemSpeechLabel} · ${state.speech.locale}`}</span>
                  <button
                    className={state.microphoneEnabled ? 'mic-toggle live' : 'mic-toggle'}
                    title={state.microphoneEnabled ? '暂停麦克风' : '继续麦克风'}
                    aria-label={state.microphoneEnabled ? '暂停麦克风' : '继续麦克风'}
                    onClick={() => command({ type: 'setMicrophoneEnabled', enabled: !state.microphoneEnabled })}
                  >
                    {state.microphoneEnabled ? <Mic2 size={13} /> : <MicOff size={13} />}
                  </button>
                </span>
              </div>
              <p>{state.speech.transcript || state.speech.message || '请对着麦克风朗读稿件'}</p>
              <div className="mic-level-row">
                <span>输入响度</span>
                <div className="mic-level-meter" role="meter" aria-label="麦克风响度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.speech.inputLevel * 100)}>
                  <span style={{ width: `${state.speech.inputLevel * 100}%` }} />
                </div>
                <strong>{Math.round(state.speech.inputLevel * 100)}%</strong>
              </div>
              <footer>
                <span>匹配 {state.speech.matchConfidence === null ? '--' : `${Math.round(state.speech.matchConfidence * 100)}%`}</span>
                <span>{state.speech.direction === 'backward' ? '重读回跳' : state.speech.direction === 'forward' ? '向前跟随' : state.speech.direction === 'hold' ? '位置稳定' : '等待定位'}</span>
                {state.speech.engine === 'funasr' && <span>队列 {state.funasr.queuedSegments} · {state.funasr.lastLatencyMs === null ? '--' : `${state.funasr.lastLatencyMs}ms`}</span>}
                {state.trackerStatus === 'lost' && <>
                  <button onClick={() => void openSpeechSettings('funasr')}><ExternalLink size={12} />打开麦克风设置</button>
                  {state.speech.engine === 'system' && capabilities.platform === 'macos' && <button onClick={() => void openSpeechSettings('system')}><ExternalLink size={12} />打开语音识别设置</button>}
                </>}
              </footer>
            </section>
          )}
          <section className={paragraphsCollapsed ? 'paragraph-section collapsed' : 'paragraph-section'}>
            <div className="paragraph-heading">
              <span>段落跳转</span>
              <button className="icon-button compact" title={paragraphsCollapsed ? '展开段落跳转' : '折叠段落跳转'} aria-label={paragraphsCollapsed ? '展开段落跳转' : '折叠段落跳转'} onClick={() => setParagraphsCollapsed((current) => !current)}>
                {paragraphsCollapsed ? <ChevronUp /> : <ChevronDown />}
              </button>
            </div>
            {!paragraphsCollapsed && <div className="paragraph-strip">
              {state.document.paragraphs.map((item, index) => (
                <button key={item.id} className={index === state.anchor.paragraphIndex ? 'active' : ''} onClick={() => command({ type: 'seek', anchor: { paragraphId: item.id, paragraphIndex: index, charOffset: 0, globalOffset: item.startOffset } })}>
                  <span>{String(index + 1).padStart(2, '0')}</span>{item.text.slice(0, 34)}
                </button>
              ))}
            </div>}
          </section>
        </section>

        <aside className={`settings-pane settings-category-${settingsCategory}`}>
          <div className="pane-heading">
            <div><span className="eyebrow">OUTPUT</span><h2>工作台设置</h2></div>
            <div className="pane-heading-actions"><Settings2 size={18} /><button className="icon-button compact" title="折叠显示设置" aria-label="折叠显示设置" onClick={() => setSettingsCollapsed(true)}><PanelRightClose /></button></div>
          </div>

          <nav className="settings-navigation" aria-label="设置分类">
            {([['output', '显示排版'], ['speech', '语音跟随'], ['help', '快捷键']] as const).map(([id, label]) => (
              <button key={id} aria-pressed={settingsCategory === id} className={settingsCategory === id ? 'active' : ''} onClick={() => setSettingsCategory(id)}>{label}</button>
            ))}
          </nav>
          <div className="settings-category-intro">{settingsCategory === 'output' ? '调整提词屏幕与阅读样式' : settingsCategory === 'speech' ? '设置重读范围、识别与麦克风' : '录制时常用的键盘操作'}</div>
          <div hidden={settingsCategory !== 'speech'} className="tracking-settings">
            <SettingsSection icon={<RotateCcw size={15} />} title="重读跟随" value={`${state.tracking.rewindCharacters} 字`} defaultOpen>
              <RangeField label="重读回看范围" value={state.tracking.rewindCharacters} min={0} max={2000} suffix="字" onChange={(rewindCharacters) => command({ type: 'setTracking', patch: { rewindCharacters } })} />
              <p className="settings-hint">从当前位置向前查找。汉字、英文字母和数字各计 1 字，忽略标点和空格；设为 0 关闭自动回跳。短句仍需足够证据确认。</p>
              <label className="toggle-row"><span><strong>预览中标记范围</strong></span><input type="checkbox" checked={state.tracking.showRewindRange} onChange={(event) => command({ type: 'setTracking', patch: { showRewindRange: event.target.checked } })} /></label>
              <label className="toggle-row"><span><strong>提词屏也显示范围</strong></span><input type="checkbox" checked={state.tracking.showRewindRangeOnDisplay} onChange={(event) => command({ type: 'setTracking', patch: { showRewindRangeOnDisplay: event.target.checked } })} /></label>
              <p className="settings-hint">本次已记录 {state.rereadEvents.length} 次重读（最多 1000 条）。修改稿件或退出会清空；记录时间仅作定位线索。</p>
              <button className="button secondary" disabled={!state.rereadEvents.length} onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, document: state.document, events: state.rereadEvents }, null, 2)], { type: 'application/json' }));
                const link = window.document.createElement('a');
                link.href = url;
                link.download = 'teleprompter-rereads.json';
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}>导出重读记录</button>
              <p className="settings-hint range-legend"><span />下划线为回看范围 · 亮色字为当前位置</p>
            </SettingsSection>
          </div>

          <SettingsSection className="output-settings" icon={<MonitorUp size={15} />} title="显示输出" value={previewDisplay?.label ?? '自动选择'} defaultOpen>
            <label className="field-label">目标显示器
              <select value={state.selectedDisplayId ?? ''} onChange={(event) => command({ type: 'setDisplay', displayId: event.target.value || null })}>
                <option value="">自动选择外接屏</option>
                {displays.map((display) => <option key={display.id} value={display.id}>{display.label} · {display.width}×{display.height}{display.primary ? '（主屏）' : ''}</option>)}
              </select>
            </label>
            <div className="settings-subgroup-title"><FlipHorizontal2 size={14} />镜像</div>
            <div className="segmented-control full">
              {([['none', '正常'], ['horizontal', '水平'], ['vertical', '垂直'], ['both', '双轴']] as Array<[MirrorMode, string]>).map(([mode, label]) => (
                <button key={mode} className={state.mirrorMode === mode ? 'active' : ''} onClick={() => command({ type: 'setMirror', mode })}>{label}</button>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection className="speech-engine-settings" icon={<Mic2 size={15} />} title="AI 识别引擎" value={state.speech.engine === 'funasr' ? 'FunASR' : systemSpeechLabel}>
            <div className="segmented-control full" aria-label="识别引擎">
              {capabilities.systemSpeech && <button className={state.speech.engine === 'system' ? 'active' : ''} onClick={() => command({ type: 'setSpeechEngine', engine: 'system' })}>{systemSpeechLabel}</button>}
              <button className={state.speech.engine === 'funasr' ? 'active' : ''} onClick={() => command({ type: 'setSpeechEngine', engine: 'funasr' })}>FunASR 本地</button>
            </div>
            {state.speech.engine === 'funasr' && <>
              <label className="field-label">识别模型
                <select value={state.funasr.model} onChange={(event) => command({ type: 'setFunAsrModel', model: event.target.value as FunAsrModelId })}>
                  {state.funasr.models.map((model) => (
                    <option key={model.id} value={model.id}>{model.name} {model.variant}{model.status === 'installed' || model.status === 'update-available' ? '' : '（未安装）'}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">{streamingFunAsr ? '推理后端（流式模型固定 CPU）' : '推理后端'}
                <select value={streamingFunAsr ? 'cpu' : state.funasr.backend} disabled={streamingFunAsr} onChange={(event) => command({ type: 'setFunAsrBackend', backend: event.target.value as FunAsrBackend })}>
                  <option value="auto">自动选择 GPU / CPU</option>
                  <option value="cuda" disabled={!state.funasr.availableBackends.includes('cuda')}>CUDA（Windows NVIDIA）</option>
                  <option value="vulkan" disabled={!state.funasr.availableBackends.includes('vulkan')}>Vulkan（Windows GPU）</option>
                  <option value="cpu">CPU</option>
                </select>
              </label>
              <div className="funasr-install-status">
                <div>
                  <span>{selectedFunAsrModel ? `${selectedFunAsrModel.name} ${selectedFunAsrModel.variant}` : '本地模型'}</span>
                  <strong>{state.funasr.installStatus === 'ready' ? `${state.funasr.resolvedBackend?.toUpperCase()} 已就绪` : `${Math.round(state.funasr.installProgress * 100)}%`}</strong>
                </div>
                <div className="progress-track" role="progressbar" aria-label="FunASR 安装进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.funasr.installProgress * 100)}><span style={{ width: `${state.funasr.installProgress * 100}%` }} /></div>
                <p>{state.funasr.message}</p>
                <div className="funasr-install-actions">
                  {state.funasr.installStatus !== 'ready' && <button className="button secondary" disabled={state.funasr.installStatus === 'downloading' || state.funasr.installStatus === 'installing'} onClick={() => void installFunAsr().catch(console.error)}>
                    {state.funasr.installStatus === 'downloading' || state.funasr.installStatus === 'installing' ? <LoaderCircle className="spin" /> : <HardDriveDownload />}
                    {state.funasr.installStatus === 'error' ? '重试安装' : '安装模型'}
                  </button>}
                  <button className="icon-button compact" title="重新检查本地模型" aria-label="重新检查本地模型" onClick={() => void inspectFunAsr()}><RotateCcw /></button>
                  <button className="icon-button compact" title="打开模型目录" aria-label="打开模型目录" onClick={() => void openFunAsrModels()}><FolderOpen /></button>
                  <button className="button secondary manage-models-button" onClick={() => setModelManagerOpen(true)}><Library />管理模型</button>
                </div>
              </div>
            </>}
          </SettingsSection>

          <SettingsSection className="microphone-processing-settings" icon={<Settings2 size={15} />} title="麦克风" value={state.speech.engine === 'funasr' ? audioInputs.find((device) => device.deviceId === state.speech.inputDeviceId)?.label ?? '系统默认' : '系统默认'}>
            {state.speech.engine === 'funasr' ? <div className="microphone-device-row">
              <label className="field-label">输入麦克风
                <select value={state.speech.inputDeviceId ?? ''} onChange={(event) => command({ type: 'setSpeechInputDevice', deviceId: event.target.value || null })}>
                  <option value="">系统默认麦克风</option>
                  {state.speech.inputDeviceId && !audioInputs.some((device) => device.deviceId === state.speech.inputDeviceId) && (
                    <option value={state.speech.inputDeviceId}>已断开的麦克风</option>
                  )}
                  {audioInputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
                </select>
              </label>
              <button className="icon-button compact" title="刷新麦克风列表" aria-label="刷新麦克风列表" onClick={() => void refreshAudioInputs()}><RotateCcw /></button>
            </div> : <label className="field-label">输入麦克风
              <select value="" disabled><option value="">系统默认麦克风</option></select>
            </label>}
            {state.speech.engine === 'funasr' && rendererMicrophoneProcessing && <>
              <label className="toggle-row">
                <span><strong>降噪</strong></span>
                <input type="checkbox" aria-label="降噪" checked={state.microphoneProcessing.noiseSuppression} onChange={(event) => command({ type: 'setMicrophoneProcessing', patch: { noiseSuppression: event.target.checked } })} />
              </label>
              <label className="toggle-row">
                <span><strong>自动增益</strong></span>
                <input type="checkbox" aria-label="自动增益" checked={state.microphoneProcessing.autoGainControl} onChange={(event) => command({ type: 'setMicrophoneProcessing', patch: { autoGainControl: event.target.checked } })} />
              </label>
              <label className="toggle-row">
                <span><strong>回声消除</strong></span>
                <input type="checkbox" aria-label="回声消除" checked={state.microphoneProcessing.echoCancellation} onChange={(event) => command({ type: 'setMicrophoneProcessing', patch: { echoCancellation: event.target.checked } })} />
              </label>
            </>}
            {state.speech.engine === 'system' && capabilities.platform === 'macos' && <label className="toggle-row">
              <span><strong>系统语音处理</strong></span>
              <input type="checkbox" aria-label="系统语音处理" checked={systemVoiceProcessing} onChange={(event) => command({
                type: 'setMicrophoneProcessing',
                patch: {
                  noiseSuppression: event.target.checked,
                  autoGainControl: event.target.checked,
                  echoCancellation: event.target.checked,
                },
              })} />
            </label>}
            {(state.speech.engine === 'funasr' && rendererMicrophoneProcessing) || (state.speech.engine === 'system' && capabilities.platform === 'macos') ? (
              <RangeField label="手动增益" value={state.microphoneProcessing.inputGain} min={0} max={8} step={0.05} suffix="×" onChange={(inputGain) => command({ type: 'setMicrophoneProcessing', patch: { inputGain } })} />
            ) : null}
          </SettingsSection>

          <SettingsSection className="output-settings" icon={<Type size={15} />} title="字体排版" value={`${state.typography.fontSize}px`}>
            <label className="field-label">字体
              <select value={state.typography.fontFamily} onChange={(event) => command({ type: 'setTypography', patch: { fontFamily: event.target.value } })}>
                {FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
              </select>
            </label>
            <RangeField label="字号" value={state.typography.fontSize} min={4} max={1200} suffix="px" onChange={(fontSize) => command({ type: 'setTypography', patch: { fontSize } })} />
            <RangeField label="字重" value={state.typography.fontWeight} min={100} max={1000} step={25} onChange={(fontWeight) => command({ type: 'setTypography', patch: { fontWeight } })} />
            <RangeField label="行距" value={state.typography.lineHeight} min={0.5} max={5} step={0.05} onChange={(lineHeight) => command({ type: 'setTypography', patch: { lineHeight } })} />
            <RangeField label="段间距" value={state.typography.paragraphSpacing} min={0} max={12} step={0.1} suffix="em" onChange={(paragraphSpacing) => command({ type: 'setTypography', patch: { paragraphSpacing } })} />
            <RangeField label="左右间距" value={state.typography.sidePadding} min={0} max={2000} step={5} suffix="px" onChange={(sidePadding) => command({ type: 'setTypography', patch: { sidePadding } })} />
            <RangeField label="焦点位置" value={state.typography.focusPosition} min={0} max={100} suffix="%" onChange={(focusPosition) => command({ type: 'setTypography', patch: { focusPosition } })} />
            <RangeField label="高亮强度" value={state.typography.focusOpacity} min={0} max={1} step={0.01} onChange={(focusOpacity) => command({ type: 'setTypography', patch: { focusOpacity } })} />
            <div className="alignment-row">
              <span>对齐</span>
              <div className="segmented-control compact-control">
                <button className={state.typography.alignment === 'left' ? 'active' : ''} onClick={() => command({ type: 'setTypography', patch: { alignment: 'left' } })}><AlignLeft /></button>
                <button className={state.typography.alignment === 'center' ? 'active' : ''} onClick={() => command({ type: 'setTypography', patch: { alignment: 'center' } })}><AlignCenter /></button>
                <button className={state.typography.alignment === 'right' ? 'active' : ''} onClick={() => command({ type: 'setTypography', patch: { alignment: 'right' } })}><AlignRight /></button>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection className="help-settings" icon={<Keyboard size={15} />} title="快捷键">
            <div className="shortcut-grid">
              <kbd>Space</kbd><span>播放 / 暂停</span>
              <kbd>Enter</kbd><span>播放 / 暂停</span>
              <kbd>← →</kbd><span>按页跳转</span>
              <kbd>Shift + ← →</kbd><span>按段跳转</span>
              <kbd>↑ ↓</kbd><span>调整速度</span>
            </div>
          </SettingsSection>
        </aside>

        {settingsCollapsed && (
          <button
            className="collapsed-pane-rail right"
            title="展开显示设置"
            aria-label="展开显示设置"
            onClick={() => setSettingsCollapsed(false)}
          >
            <PanelRightOpen />
          </button>
        )}
      </div>
      {modelManagerOpen && (
        <div className="model-manager-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModelManagerOpen(false);
        }}>
          <section className="model-manager" role="dialog" aria-modal="true" aria-labelledby="model-manager-title">
            <header>
              <div>
                <span className="eyebrow">LOCAL ASR</span>
                <h2 id="model-manager-title">模型管理</h2>
              </div>
              <div className="model-manager-header-actions">
                <button className="icon-button compact" title="重新检查模型" aria-label="重新检查模型" onClick={() => void inspectFunAsr()}><RotateCcw /></button>
                <button className="icon-button compact" title="关闭模型管理" aria-label="关闭模型管理" onClick={() => setModelManagerOpen(false)}><X /></button>
              </div>
            </header>
            {modelActionError && <div className="model-manager-error" role="alert">{modelActionError}</div>}
            <div className="model-list">
              {state.funasr.models.map((model) => {
                const current = state.funasr.model === model.id;
                const installed = model.status === 'installed' || model.status === 'update-available';
                const busy = model.status === 'checking' || model.status === 'downloading';
                return (
                  <article className={`model-row${current ? ' current' : ''}`} key={model.id}>
                    <div className="model-row-main">
                      <div className="model-title-row">
                        <h3>{model.name} <span>{model.variant}</span></h3>
                        {current && <span className="model-badge current">当前</span>}
                        {model.status === 'installed' && <span className="model-badge ready">已安装</span>}
                        {model.status === 'update-available' && <span className="model-badge update">可更新</span>}
                        {model.status === 'error' && <span className="model-badge error">异常</span>}
                      </div>
                      <p>{model.description}</p>
                      <div className="model-meta">
                        <span>{formatBytes(model.sizeBytes)}</span>
                        <span>版本 {model.installedVersion ?? '--'} / {model.availableVersion}</span>
                        <span>GGUF · 本地离线</span>
                      </div>
                      {(busy || model.status === 'error' || model.message) && <>
                        <div className="progress-track model-download-progress" role="progressbar" aria-label={`${model.name} ${model.variant} 下载进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(model.progress * 100)}><span style={{ width: `${model.progress * 100}%` }} /></div>
                        <small className={model.status === 'error' ? 'model-error-text' : ''}>{model.message ?? '正在处理'}</small>
                      </>}
                    </div>
                    <div className="model-row-actions">
                      {!installed && <button className="button primary" disabled={busy} onClick={() => {
                        setModelActionError(null);
                        void installFunAsr(model.id).catch((error) => setModelActionError(String(error)));
                      }}>{busy ? <LoaderCircle className="spin" /> : <HardDriveDownload />}下载</button>}
                      {model.status === 'update-available' && <button className="button primary" disabled={busy} onClick={() => {
                        setModelActionError(null);
                        void installFunAsr(model.id, true).catch((error) => setModelActionError(String(error)));
                      }}><HardDriveDownload />更新</button>}
                      {installed && !current && <button className="button secondary" onClick={() => command({ type: 'setFunAsrModel', model: model.id })}>使用</button>}
                      {installed && !current && <button className="icon-button compact danger" title={`删除 ${model.name} ${model.variant}`} aria-label={`删除 ${model.name} ${model.variant}`} onClick={() => {
                        if (!window.confirm(`删除 ${model.name} ${model.variant}（${formatBytes(model.sizeBytes)}）？`)) return;
                        setModelActionError(null);
                        void deleteFunAsrModel(model.id).catch((error) => setModelActionError(String(error)));
                      }}><Trash2 /></button>}
                    </div>
                  </article>
                );
              })}
            </div>
            <footer>
              <span>模型保存在本机，不上传音频或转写结果。</span>
              <button className="button secondary" onClick={() => void openFunAsrModels()}><FolderOpen />打开目录</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function ProgramMonitor({ state, width, height, viewMirrorHorizontal }: {
  state: ReturnType<typeof useTeleprompter>['state'];
  width: number;
  height: number;
  viewMirrorHorizontal: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
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
    <div ref={frameRef} className="preview-frame" data-testid="program-monitor">
      <div
        className="preview-viewport"
        style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <PrompterSurface
          state={state}
          viewportWidth={width}
          viewportHeight={height}
          className="preview-surface"
          viewMirrorHorizontal={viewMirrorHorizontal}
          showTextBounds
        />
      </div>
    </div>
  );
}

function SettingsSection({ icon, title, value, defaultOpen = false, className = '', children }: {
  icon: React.ReactNode;
  title: string;
  value?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={`settings-group settings-section ${className}`.trim()} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="settings-section-summary">
        <span className="settings-section-title">{icon}<strong>{title}</strong></span>
        <span className="settings-section-state">{value && <small>{value}</small>}<ChevronDown size={15} /></span>
      </summary>
      <div className="settings-section-content">{children}</div>
    </details>
  );
}

function RangeField({ label, value, min, max, step = 1, suffix = '', onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  return (
    <label className="range-field">
      <span>
        <span>{label}</span>
        <span className="range-number">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={`${label}数值`}
            onChange={(event) => onChange(clamp(Number(event.target.value)))}
          />
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function HoldAdjustButton({ label, delta, onAdjust, children }: {
  label: string;
  delta: number;
  onAdjust: (delta: number) => void;
  children: React.ReactNode;
}) {
  const delayRef = useRef<number | null>(null);
  const repeatRef = useRef<number | null>(null);
  const stop = () => {
    if (delayRef.current !== null) window.clearTimeout(delayRef.current);
    if (repeatRef.current !== null) window.clearInterval(repeatRef.current);
    delayRef.current = null;
    repeatRef.current = null;
  };
  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    stop();
    onAdjust(delta);
    delayRef.current = window.setTimeout(() => {
      repeatRef.current = window.setInterval(() => onAdjust(delta), 80);
    }, 320);
  };
  useEffect(() => stop, []);
  return (
    <button
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onClick={(event) => { if (event.detail === 0) onAdjust(delta); }}
    >
      {children}
    </button>
  );
}
