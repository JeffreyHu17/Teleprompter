import { describe, expect, it } from 'vitest';
import { anchorAt, createDocument, focusAnchorForState, initialSessionState, sessionReducer } from '../src/core/session';

describe('session reducer', () => {
  it('uses 荷塘月色 as the default script', () => {
    const state = initialSessionState();
    expect(state.document.name).toBe('荷塘月色');
    expect(state.document.rawText).toContain('作者: 朱自清');
    expect(state.document.paragraphs.length).toBeGreaterThan(10);
  });

  it('normalizes fractional offsets to character boundaries', () => {
    const state = initialSessionState();
    expect(anchorAt(state.document, 12.9).globalOffset).toBe(12);
  });

  it('builds stable paragraph anchors', () => {
    const document = createDocument('test', '第一段。\n\n第二段文字。');
    expect(document.paragraphs).toHaveLength(2);
    expect(anchorAt(document, document.paragraphs[1].startOffset).paragraphIndex).toBe(1);
  });

  it('preserves typography when the script is edited', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'setTypography', patch: { fontFamily: 'SimSun, serif', fontSize: 180, fontWeight: 800 } });
    state = sessionReducer(state, { type: 'setDocument', name: 'edited', text: '编辑后的稿件。' });
    expect(state.typography.fontFamily).toBe('SimSun, serif');
    expect(state.typography.fontSize).toBe(180);
    expect(state.typography.fontWeight).toBe(800);
  });

  it('navigates paragraphs in both directions', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'navigateParagraph', direction: 1 });
    expect(state.anchor.paragraphIndex).toBe(1);
    state = sessionReducer(state, { type: 'navigateParagraph', direction: -1 });
    expect(state.anchor.paragraphIndex).toBe(0);
  });

  it('uses display page anchors when available', () => {
    let state = initialSessionState();
    const second = anchorAt(state.document, 60);
    state = sessionReducer(state, {
      type: 'reportLayout',
      layout: {
        revision: 1,
        documentRevision: state.document.revision,
        pageAnchors: [anchorAt(state.document, 0), second],
        pageCount: 2,
        viewportWidth: 1280,
        viewportHeight: 720,
        documentHeight: 1800,
        textWidthPx: 998,
        pageScrollOffsets: [0, 800],
        paragraphScrollOffsets: [0, 700, 1400],
      },
    });
    state = sessionReducer(state, { type: 'navigatePage', direction: 1 });
    expect(state.anchor.globalOffset).toBe(second.globalOffset);
  });

  it('ignores equivalent layout reports', () => {
    const state = initialSessionState();
    const layout = {
      revision: 1,
      documentRevision: state.document.revision,
      pageAnchors: [anchorAt(state.document, 0)],
      pageCount: 1,
      viewportWidth: 1280,
      viewportHeight: 720,
      documentHeight: 900,
      textWidthPx: 998,
      pageScrollOffsets: [0],
      paragraphScrollOffsets: [0],
    };
    const withLayout = sessionReducer(state, { type: 'reportLayout', layout });
    const unchanged = sessionReducer(withLayout, { type: 'reportLayout', layout: { ...layout, revision: 2 } });
    expect(unchanged).toBe(withLayout);
  });

  it('preserves the live output viewport while typography is remeasured', () => {
    const state = initialSessionState();
    const layout = {
      revision: 1,
      documentRevision: state.document.revision,
      pageAnchors: [anchorAt(state.document, 0)],
      pageCount: 1,
      viewportWidth: 1280,
      viewportHeight: 720,
      documentHeight: 900,
      textWidthPx: 1000,
      pageScrollOffsets: [0],
      paragraphScrollOffsets: [0],
    };
    const withLayout = sessionReducer(state, { type: 'reportLayout', layout });
    const changed = sessionReducer(withLayout, { type: 'setTypography', patch: { sidePadding: 300 } });
    expect(changed.layout).toBe(withLayout.layout);
    expect(changed.typography.sidePadding).toBe(300);
  });

  it('ignores layout reports from an older document revision', () => {
    let state = initialSessionState();
    const staleRevision = state.document.revision;
    state = sessionReducer(state, { type: 'setDocument', name: 'new-script', text: '新的稿件内容。' });

    const unchanged = sessionReducer(state, {
      type: 'reportLayout',
      layout: {
        revision: 99,
        documentRevision: staleRevision,
        pageAnchors: [anchorAt(state.document, 0)],
        pageCount: 1,
        viewportWidth: 1920,
        viewportHeight: 1080,
        documentHeight: 1400,
        textWidthPx: 1200,
        pageScrollOffsets: [0],
        paragraphScrollOffsets: [0],
      },
    });

    expect(unchanged).toBe(state);
    expect(unchanged.layout).toBeNull();
  });

  it('preserves the content at the focus line when the viewport is reflowed', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'setDocument', name: 'focus-test', text: 'abcdefghij\n\nklmnopqrst' });
    state = sessionReducer(state, { type: 'setTypography', patch: { fontSize: 20, lineHeight: 1 } });

    state = sessionReducer(state, {
      type: 'reportLayout',
      layout: {
        revision: 1,
        documentRevision: state.document.revision,
        pageAnchors: [anchorAt(state.document, 0)],
        pageCount: 1,
        viewportWidth: 800,
        viewportHeight: 600,
        documentHeight: 200,
        textWidthPx: 600,
        pageScrollOffsets: [0],
        paragraphScrollOffsets: [0, 100],
      },
    });
    state = sessionReducer(state, { type: 'scrollStep', deltaPx: 40 });

    const focusAnchor = focusAnchorForState(state);
    expect(focusAnchor.paragraphIndex).toBe(0);
    expect(focusAnchor.charOffset).toBe(5);

    state = sessionReducer(state, {
      type: 'reportLayout',
      preserveFocusAnchor: focusAnchor,
      layout: {
        revision: 2,
        documentRevision: state.document.revision,
        pageAnchors: [anchorAt(state.document, 0)],
        pageCount: 1,
        viewportWidth: 1200,
        viewportHeight: 800,
        documentHeight: 400,
        textWidthPx: 900,
        pageScrollOffsets: [0],
        paragraphScrollOffsets: [0, 200],
      },
    });

    expect(state.anchor.globalOffset).toBe(focusAnchor.globalOffset);
    expect(state.scrollOffsetPx).toBe(90);
  });

  it('does not revise state before display layout is available', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'setPlaying', playing: true });
    const unchanged = sessionReducer(state, { type: 'tick', elapsedMs: 20 });
    expect(unchanged).toBe(state);
  });

  it('scrolls continuously by pixels while fixed playback is active', () => {
    let state = initialSessionState();
    state = sessionReducer(state, {
      type: 'reportLayout',
      layout: {
        revision: 1,
        documentRevision: state.document.revision,
        pageAnchors: [anchorAt(state.document, 0)],
        pageCount: 1,
        viewportWidth: 1280,
        viewportHeight: 720,
        documentHeight: 2000,
        textWidthPx: 998,
        pageScrollOffsets: [0],
        paragraphScrollOffsets: [0, 400, 800, 1200],
      },
    });
    state = sessionReducer(state, { type: 'setPlaying', playing: true });
    state = sessionReducer(state, { type: 'tick', elapsedMs: 1000 });
    expect(state.scrollOffsetPx).toBe(30);
    expect(state.anchor.globalOffset).toBe(0);
  });

  it('continues fixed scrolling from the current AI anchor', () => {
    let state = initialSessionState();
    state = sessionReducer(state, {
      type: 'reportLayout',
      layout: {
        revision: 1,
        documentRevision: state.document.revision,
        pageAnchors: [anchorAt(state.document, 0)],
        pageCount: 1,
        viewportWidth: 1280,
        viewportHeight: 720,
        documentHeight: 1600,
        textWidthPx: 998,
        pageScrollOffsets: [0],
        paragraphScrollOffsets: [0, 300, 600, 900],
      },
    });
    state = sessionReducer(state, { type: 'setMode', mode: 'ai' });
    state = sessionReducer(state, { type: 'seek', anchor: anchorAt(state.document, state.document.paragraphs[2].startOffset) });
    state = sessionReducer(state, { type: 'setMode', mode: 'fixed' });
    expect(state.scrollOffsetPx).toBe(600);
  });

  it('tracks whether the AI microphone is paused', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'setMode', mode: 'ai' });
    state = sessionReducer(state, { type: 'setMicrophoneEnabled', enabled: false });
    expect(state.microphoneEnabled).toBe(false);
    expect(state.trackerStatus).toBe('paused');
    expect(state.speech.message).toBe('麦克风已暂停');
    expect(state.speech.inputLevel).toBe(0);
    state = sessionReducer(state, { type: 'setMicrophoneEnabled', enabled: true });
    expect(state.microphoneEnabled).toBe(true);
    expect(state.trackerStatus).toBe('idle');
  });

  it('switches between system and FunASR engines without losing the script position', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'seek', anchor: anchorAt(state.document, 80) });
    state = sessionReducer(state, { type: 'setSpeechEngine', engine: 'funasr' });
    state = sessionReducer(state, { type: 'setFunAsrBackend', backend: 'vulkan' });
    expect(state.anchor.globalOffset).toBe(80);
    expect(state.speech.engine).toBe('funasr');
    expect(state.funasr.backend).toBe('vulkan');
    expect(state.trackerStatus).toBe('ready');
  });

  it('stores the selected speech input device without changing the script position', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'seek', anchor: anchorAt(state.document, 80) });
    state = sessionReducer(state, { type: 'setSpeechInputDevice', deviceId: 'external-microphone' });
    expect(state.anchor.globalOffset).toBe(80);
    expect(state.speech.inputDeviceId).toBe('external-microphone');
    expect(state.speech.message).toBe('正在切换输入麦克风');
  });

  it('updates microphone processing without moving the script and clamps manual gain', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'seek', anchor: anchorAt(state.document, 80) });
    state = sessionReducer(state, {
      type: 'setMicrophoneProcessing',
      patch: { noiseSuppression: false, autoGainControl: false, echoCancellation: true, inputGain: 20 },
    });
    expect(state.anchor.globalOffset).toBe(80);
    expect(state.microphoneProcessing).toEqual({
      noiseSuppression: false,
      autoGainControl: false,
      echoCancellation: true,
      inputGain: 8,
    });
  });

  it('switches FunASR models without changing the script position', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'seek', anchor: anchorAt(state.document, 80) });
    state = sessionReducer(state, { type: 'setFunAsrModel', model: 'paraformer-streaming-fp32' });
    expect(state.anchor.globalOffset).toBe(80);
    expect(state.funasr.model).toBe('paraformer-streaming-fp32');
    expect(state.funasr.lastLatencyMs).toBeNull();
  });

  it('rewinds within document bounds', () => {
    let state = initialSessionState();
    state = sessionReducer(state, { type: 'seek', anchor: anchorAt(state.document, 120) });
    state = sessionReducer(state, { type: 'rewindStep' });
    expect(state.anchor.globalOffset).toBe(40);
    state = sessionReducer(state, { type: 'rewindStep' });
    expect(state.anchor.globalOffset).toBe(0);
  });
});
