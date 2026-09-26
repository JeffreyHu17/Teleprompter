import type {
  Paragraph,
  ScriptAnchor,
  ScriptDocument,
  SessionCommand,
  SessionState,
  TypographySettings,
} from '../types/session.js';

export const LEGACY_SAMPLE_TEXT = `欢迎使用 Teleprompter Studio。

这是控制窗口。你可以在这里编辑稿件、调整字体、打开显示窗口，并控制播放速度。

显示窗口默认以独立窗口打开，可以移动、缩放或手动全屏。启用水平镜像后，文字经过提词器玻璃反射会恢复为正常方向。

空格键用于播放或暂停，左右方向键翻页，按住 Shift 再按左右方向键可以按段落跳转。上键加速，下键减速。`;

export const SAMPLE_TEXT = `荷塘月色

作者: 朱自清

这几天心里颇不宁静。今晚在院子里坐着乘凉，忽然想起日日走过的荷塘，在这满月的光里，总该另有一番样子吧。月亮渐渐地升高了，墙外马路上孩子们的欢笑，已经听不见了；妻在屋里拍着闰儿，迷迷糊糊地哼着眠歌。我悄悄地披了大衫，带上门出去。

沿着荷塘，是一条曲折的小煤屑路。这是一条幽僻的路；白天也少人走，夜晚更加寂寞。荷塘四面，长着许多树，蓊蓊郁郁的。路的一旁，是些杨柳，和一些不知道名字的树。没有月光的晚上，这路上阴森森的，有些怕人。今晚却很好，虽然月光也还是淡淡的。

路上只我一个人，背着手踱着。这一片天地好像是我的；我也像超出了平常的自己，到了另一世界里。我爱热闹，也爱冷静；爱群居，也爱独处。像今晚上，一个人在这苍茫的月下，什么都可以想，什么都可以不想，便觉是个自由的人。白天里一定要做的事，一定要说的话，现在都可不理。这是独处的妙处，我且受用这无边的荷香月色好了。

曲曲折折的荷塘上面，弥望的是田田的叶子。叶子出水很高，像亭亭的舞女的裙。层层的叶子中间，零星地点缀着些白花，有袅娜地开着的，有羞涩地打着朵儿的；正如一粒粒的明珠，又如碧天里的星星，又如刚出浴的美人。微风过处，送来缕缕清香，仿佛远处高楼上渺茫的歌声似的。这时候叶子与花也有一丝的颤动，像闪电般，霎时传过荷塘的那边去了。叶子本是肩并肩密密地挨着，这便宛然有了一道凝碧的波痕。叶子底下是脉脉的流水，遮住了，不能见一些颜色；而叶子却更见风致了。

月光如流水一般，静静地泻在这一片叶子和花上。薄薄的青雾浮起在荷塘里。叶子和花仿佛在牛乳中洗过一样；又像笼着轻纱的梦。虽然是满月，天上却有一层淡淡的云，所以不能朗照；但我以为这恰是到了好处——酣眠固不可少，小睡也别有风味的。月光是隔了树照过来的，高处丛生的灌木，落下参差的斑驳的黑影，峭楞楞如鬼一般；弯弯的杨柳的稀疏的倩影，却又像是画在荷叶上。塘中的月色并不均匀；但光与影有着和谐的旋律，如梵婀玲上奏着的名曲。

荷塘的四面，远远近近，高高低低都是树，而杨柳最多。这些树将一片荷塘重重围住；只在小路一旁，漏着几段空隙，像是特为月光留下的。树色一例是阴阴的，乍看像一团烟雾；但杨柳的丰姿，便在烟雾里也辨得出。树梢上隐隐约约的是一带远山，只有些大意罢了。树缝里也漏着一两点路灯光，没精打采的，是渴睡人的眼。这时候最热闹的，要数树上的蝉声与水里的蛙声；但热闹是它们的，我什么也没有。

忽然想起采莲的事情来了。采莲是江南的旧俗，似乎很早就有，而六朝时为盛；从诗歌里可以约略知道。采莲的是少年的女子，她们是荡着小船，唱着艳歌去的。采莲人不用说很多，还有看采莲的人。那是一个热闹的季节，也是一个风流的季节。梁元帝《采莲赋》里说得好：

于是妖童媛女，荡舟心许；鷁首徐回，兼传羽杯；欋将移而藻挂，船欲动而萍开。尔其纤腰束素，迁延顾步；夏始春余，叶嫩花初，恐沾裳而浅笑，畏倾船而敛裾。

可见当时嬉游的光景了。这真是有趣的事，可惜我们现在早已无福消受了。

于是又记起《西洲曲》里的句子：

采莲南塘秋，莲花过人头；低头弄莲子，莲子清如水。今晚若有采莲人，这儿的莲花也算得“过人头”了；只不见一些流水的影子，是不行的。这令我到底惦着江南了。——这样想着，猛一抬头，不觉已是自己的门前；轻轻地推门进去，什么声息也没有，妻已睡熟好久了。

1927年7月，北京清华园。`;

export function createDocument(name: string, text: string, revision = 1): ScriptDocument {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const blocks = normalized ? normalized.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean) : [''];
  let cursor = 0;
  const paragraphs: Paragraph[] = blocks.map((block, index) => {
    const startOffset = cursor;
    cursor += block.length;
    const paragraph = {
      id: `p-${revision}-${index}`,
      text: block,
      startOffset,
      endOffset: cursor,
    };
    cursor += 1;
    return paragraph;
  });

  return {
    name,
    revision,
    rawText: normalized,
    paragraphs,
    totalCharacters: Math.max(0, cursor - 1),
  };
}

export function anchorAt(document: ScriptDocument, globalOffset: number): ScriptAnchor {
  const bounded = Math.max(0, Math.min(Math.floor(globalOffset), document.totalCharacters));
  const paragraphIndex = Math.max(
    0,
    document.paragraphs.findIndex((paragraph) => bounded <= paragraph.endOffset),
  );
  const paragraph = document.paragraphs[paragraphIndex] ?? document.paragraphs[0];
  return {
    paragraphId: paragraph.id,
    paragraphIndex,
    charOffset: Math.max(0, Math.min(paragraph.text.length, bounded - paragraph.startOffset)),
    globalOffset: bounded,
  };
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontFamily: 'system-ui',
  fontSize: 56,
  fontWeight: 600,
  lineHeight: 1.55,
  paragraphSpacing: 1.1,
  sidePadding: 140,
  alignment: 'center',
  foreground: '#f4f4ef',
  background: '#050606',
  focusColor: '#f2c94c',
  focusPosition: 42,
  focusOpacity: 0.16,
};

export function initialSessionState(platform: 'macos' | 'windows' | 'android' | 'browser' = 'macos'): SessionState {
  const document = createDocument('荷塘月色', SAMPLE_TEXT);
  return {
    rereadEvents: [],
    tracking: { rewindCharacters: 560, showRewindRange: true, showRewindRangeOnDisplay: false },
    revision: 1,
    document,
    anchor: anchorAt(document, 0),
    isPlaying: false,
    scrollOffsetPx: 0,
    playbackMode: 'fixed',
    microphoneEnabled: true,
    microphoneProcessing: {
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
      inputGain: 1,
    },
    scrollSpeedPxPerSecond: 30,
    mirrorMode: 'horizontal',
    typography: { ...DEFAULT_TYPOGRAPHY },
    selectedDisplayId: null,
    displayOpen: false,
    layout: null,
    trackerStatus: 'ready',
    focusAdjusting: false,
    speech: {
      engine: platform === 'browser' ? 'funasr' : 'system',
      locale: 'zh-CN',
      inputDeviceId: null,
      onDevice: true,
      transcript: '',
      asrConfidence: null,
      matchConfidence: null,
      direction: null,
      message: null,
      inputLevel: 0,
    },
    funasr: {
      installStatus: 'not-installed',
      installProgress: 0,
      backend: 'auto',
      availableBackends: platform === 'windows' ? ['cuda', 'vulkan', 'cpu'] : ['cpu'],
      resolvedBackend: null,
      model: 'paraformer-streaming-int8',
      models: [
        {
          id: 'paraformer-streaming-int8',
          name: 'Paraformer Streaming',
          variant: 'INT8',
          description: '实时跟稿默认，约 480-600ms 增量更新',
          sizeBytes: 237_202_501,
          status: 'not-installed',
          progress: 0,
          installedVersion: null,
          availableVersion: '8e40c432',
          message: null,
        },
        {
          id: 'paraformer-streaming-fp32',
          name: 'Paraformer Streaming',
          variant: 'FP32',
          description: '未量化精度版，约 825 MiB，内存占用高',
          sizeBytes: 864_888_677,
          status: 'not-installed',
          progress: 0,
          installedVersion: null,
          availableVersion: '8e40c432',
          message: null,
        },
      ],
      queuedSegments: 0,
      lastLatencyMs: null,
      message: null,
    },
  };
}

function navigateParagraph(state: SessionState, direction: -1 | 1): ScriptAnchor {
  const nextIndex = Math.max(
    0,
    Math.min(state.document.paragraphs.length - 1, state.anchor.paragraphIndex + direction),
  );
  return anchorAt(state.document, state.document.paragraphs[nextIndex].startOffset);
}

function navigatePage(state: SessionState, direction: -1 | 1): { anchor: ScriptAnchor; scrollOffsetPx: number } {
  const layout = state.layout;
  const pageOffsets = layout?.pageScrollOffsets ?? [];
  const pageAnchors = layout?.pageAnchors ?? [];

  if (pageOffsets.length > 1 && pageAnchors.length === pageOffsets.length) {
    const currentOffset = state.scrollOffsetPx;
    let targetIndex = -1;
    if (direction === 1) {
      targetIndex = pageOffsets.findIndex((offset) => offset > currentOffset + 10);
      if (targetIndex < 0) targetIndex = pageOffsets.length - 1;
    } else {
      for (let i = pageOffsets.length - 1; i >= 0; i -= 1) {
        if (pageOffsets[i] < currentOffset - 10) {
          targetIndex = i;
          break;
        }
      }
      if (targetIndex < 0) targetIndex = 0;
    }
    return {
      anchor: pageAnchors[targetIndex],
      scrollOffsetPx: pageOffsets[targetIndex],
    };
  }

  const fallbackStep = Math.max(200, (layout?.viewportHeight ?? 600) * 0.75);
  const maxScroll = Math.max(0, (layout?.documentHeight ?? 0) - state.typography.fontSize * state.typography.lineHeight);
  const nextScroll = Math.max(0, Math.min(maxScroll || 999999, state.scrollOffsetPx + direction * fallbackStep));
  const nextParagraphAnchor = navigateParagraph(state, direction);
  return {
    anchor: nextParagraphAnchor,
    scrollOffsetPx: nextScroll,
  };
}

function scrollOffsetForAnchor(state: SessionState, anchor: ScriptAnchor, layout = state.layout): number {
  const start = layout?.paragraphScrollOffsets?.[anchor.paragraphIndex] ?? state.scrollOffsetPx;
  const paragraph = state.document.paragraphs[anchor.paragraphIndex];
  const fallbackEnd = start + state.typography.fontSize * state.typography.lineHeight;
  const end = layout?.paragraphScrollOffsets?.[anchor.paragraphIndex + 1] ?? fallbackEnd;
  const relative = paragraph?.text.length ? anchor.charOffset / paragraph.text.length : 0;
  return start + (end - start) * relative;
}

export function focusAnchorForState(state: SessionState): ScriptAnchor {
  if (state.playbackMode === 'ai') return state.anchor;

  const layout = state.layout;
  const offsets = layout?.paragraphScrollOffsets ?? [];
  if (!layout || !offsets.length) return state.anchor;

  const lineCenterOffset = state.typography.fontSize * state.typography.lineHeight / 2;
  const focusStageOffset = Math.max(0, state.scrollOffsetPx + lineCenterOffset);

  let paragraphIndex = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] <= focusStageOffset) paragraphIndex = index;
    else break;
  }
  paragraphIndex = Math.min(paragraphIndex, state.document.paragraphs.length - 1);

  const paragraph = state.document.paragraphs[paragraphIndex];
  if (!paragraph) return state.anchor;

  const start = offsets[paragraphIndex] ?? 0;
  const nextStart = offsets[paragraphIndex + 1]
    ?? Math.max(start + state.typography.fontSize * state.typography.lineHeight, layout.documentHeight);
  const relative = Math.max(0, Math.min(1, (focusStageOffset - start) / Math.max(1, nextStart - start)));
  const charOffset = Math.round(paragraph.text.length * relative);

  return anchorAt(state.document, paragraph.startOffset + charOffset);
}

export function sessionReducer(state: SessionState, command: SessionCommand): SessionState {
  let patch: Partial<SessionState> = {};
  switch (command.type) {
    case 'recordReread':
      if (command.event.documentRevision !== state.document.revision) return state;
      patch = { rereadEvents: [...state.rereadEvents, command.event].slice(-1000) };
      break;
    case 'setTracking':
      patch = { tracking: { ...state.tracking, ...command.patch, rewindCharacters: Number.isFinite(command.patch.rewindCharacters) ? Math.max(0, Math.min(2000, Math.round(command.patch.rewindCharacters!))) : state.tracking.rewindCharacters } };
      break;
    case 'setDocument': {
      const document = createDocument(command.name, command.text, state.document.revision + 1);
      patch = { document, rereadEvents: [], anchor: anchorAt(document, 0), scrollOffsetPx: 0, isPlaying: false, layout: null };
      break;
    }
    case 'togglePlay':
      patch = {
        isPlaying: !state.isPlaying,
        ...(command.scrollOffsetPx !== undefined ? { scrollOffsetPx: command.scrollOffsetPx } : {}),
      };
      break;
    case 'setPlaying':
      patch = {
        isPlaying: command.playing,
        ...(command.scrollOffsetPx !== undefined ? { scrollOffsetPx: command.scrollOffsetPx } : {}),
      };
      break;
    case 'setMode':
      patch = {
        playbackMode: command.mode,
        isPlaying: command.mode === 'ai' ? false : state.isPlaying,
        scrollOffsetPx: command.mode === 'fixed' ? scrollOffsetForAnchor(state, state.anchor) : state.scrollOffsetPx,
      };
      break;
    case 'setMicrophoneEnabled':
      patch = {
        microphoneEnabled: command.enabled,
        trackerStatus: command.enabled ? 'idle' : 'paused',
        speech: {
          ...state.speech,
          transcript: '',
          asrConfidence: null,
          matchConfidence: null,
          direction: null,
          message: command.enabled ? '正在启动本地识别' : '麦克风已暂停',
          inputLevel: 0,
        },
      };
      break;
    case 'setMicrophoneProcessing':
      patch = {
        microphoneProcessing: {
          ...state.microphoneProcessing,
          ...command.patch,
          inputGain: Math.max(0, Math.min(8, command.patch.inputGain ?? state.microphoneProcessing.inputGain)),
        },
      };
      break;
    case 'setSpeechEngine':
      patch = {
        speech: {
          ...state.speech,
          engine: command.engine,
          transcript: '',
          asrConfidence: null,
          matchConfidence: null,
          direction: null,
          inputLevel: 0,
          message: command.engine === 'funasr' ? '正在检查 FunASR 本地模型' : '正在启动系统端侧识别',
        },
        trackerStatus: state.playbackMode === 'ai' && state.microphoneEnabled ? 'idle' : state.trackerStatus,
      };
      break;
    case 'setSpeechInputDevice':
      patch = {
        speech: {
          ...state.speech,
          inputDeviceId: command.deviceId,
          message: command.deviceId ? '正在切换输入麦克风' : '已切换到系统默认麦克风',
          inputLevel: 0,
        },
      };
      break;
    case 'setFunAsrBackend':
      patch = { funasr: { ...state.funasr, backend: command.backend, resolvedBackend: null } };
      break;
    case 'setFunAsrModel':
      patch = { funasr: { ...state.funasr, model: command.model, lastLatencyMs: null } };
      break;
    case 'setFunAsrState':
      patch = { funasr: { ...state.funasr, ...command.patch } };
      break;
    case 'adjustSpeed':
      patch = { scrollSpeedPxPerSecond: Math.max(1, Math.min(2000, state.scrollSpeedPxPerSecond + command.delta)) };
      break;
    case 'setSpeed':
      patch = { scrollSpeedPxPerSecond: Math.max(1, Math.min(2000, command.speed)) };
      break;
    case 'scrollStep': {
      const maxScroll = Math.max(0, (state.layout?.documentHeight ?? 0) - state.typography.fontSize * state.typography.lineHeight);
      const nextOffset = Math.max(0, Math.min(maxScroll || 999999, state.scrollOffsetPx + command.deltaPx));
      patch = {
        scrollOffsetPx: nextOffset,
      };
      break;
    }
    case 'navigatePage': {
      const { anchor: nextAnchor, scrollOffsetPx: nextScroll } = navigatePage(state, command.direction);
      patch = {
        anchor: nextAnchor,
        scrollOffsetPx: nextScroll,
        isPlaying: false,
      };
      break;
    }
    case 'navigateParagraph': {
      const nextAnchor = navigateParagraph(state, command.direction);
      const targetScroll = state.layout?.paragraphScrollOffsets?.[nextAnchor.paragraphIndex]
        ?? Math.max(0, state.scrollOffsetPx + command.direction * 150);
      patch = {
        anchor: nextAnchor,
        scrollOffsetPx: targetScroll,
        isPlaying: false,
      };
      break;
    }
    case 'rewindStep':
      patch = {
        anchor: anchorAt(state.document, state.anchor.globalOffset - 80),
        scrollOffsetPx: Math.max(0, state.scrollOffsetPx - (state.layout?.viewportHeight ?? 720) * 0.5),
        isPlaying: false,
      };
      break;
    case 'seek': {
      const nextAnchor = anchorAt(state.document, command.anchor.globalOffset);
      patch = {
        anchor: nextAnchor,
        scrollOffsetPx: state.playbackMode === 'fixed' ? scrollOffsetForAnchor(state, nextAnchor) : state.scrollOffsetPx,
      };
      break;
    }
    case 'setMirror':
      patch = { mirrorMode: command.mode };
      break;
    case 'setTypography':
      patch = { typography: { ...state.typography, ...command.patch } };
      break;
    case 'setDisplay':
      patch = { selectedDisplayId: command.displayId };
      break;
    case 'setDisplayOpen':
      patch = { displayOpen: command.open };
      break;
    case 'setTracker':
      patch = {
        trackerStatus: command.status,
        speech: { ...state.speech, ...command.patch },
      };
      break;
    case 'reportLayout': {
      if (command.layout.documentRevision !== state.document.revision) return state;

      const equivalent = Boolean(
        state.layout
        && state.layout.documentRevision === command.layout.documentRevision
        && state.layout.viewportWidth === command.layout.viewportWidth
        && state.layout.viewportHeight === command.layout.viewportHeight
        && state.layout.documentHeight === command.layout.documentHeight
        && state.layout.textWidthPx === command.layout.textWidthPx
        && state.layout.pageCount === command.layout.pageCount
        && state.layout.pageScrollOffsets?.every((offset, index) => offset === command.layout.pageScrollOffsets?.[index])
        && state.layout.paragraphScrollOffsets?.every((offset, index) => offset === command.layout.paragraphScrollOffsets?.[index])
        && state.layout.pageAnchors.every((anchor, index) => (
          anchor.globalOffset === command.layout.pageAnchors[index]?.globalOffset
        ))
      );
      if (equivalent && !command.preserveFocusAnchor) return state;

      patch = { layout: command.layout };
      if (command.preserveFocusAnchor && state.playbackMode === 'fixed') {
        const preservedAnchor = anchorAt(state.document, command.preserveFocusAnchor.globalOffset);
        const lineCenterOffset = state.typography.fontSize * state.typography.lineHeight / 2;
        const anchorStageOffset = scrollOffsetForAnchor(state, preservedAnchor, command.layout);
        const maxScroll = Math.max(0, command.layout.documentHeight - state.typography.fontSize * state.typography.lineHeight);
        patch.scrollOffsetPx = Math.max(0, Math.min(maxScroll, anchorStageOffset - lineCenterOffset));
        patch.anchor = preservedAnchor;
      }
      break;
    }
    case 'setFocusAdjusting':
      patch = { focusAdjusting: command.adjusting };
      break;
    case 'tick': {
      if (!state.isPlaying || state.playbackMode !== 'fixed') return state;
      if (!state.layout) return state;
      const pixelsPerSecond = state.scrollSpeedPxPerSecond;
      const maxScroll = Math.max(0, state.layout.documentHeight - state.typography.fontSize * state.typography.lineHeight);
      const nextOffset = Math.min(maxScroll, state.scrollOffsetPx + pixelsPerSecond * command.elapsedMs / 1000);
      if (nextOffset === state.scrollOffsetPx) return state;
      const atEnd = maxScroll > 0 && nextOffset >= maxScroll;
      patch = {
        scrollOffsetPx: nextOffset,
        isPlaying: atEnd ? false : state.isPlaying,
      };
      break;
    }
  }

  return { ...state, ...patch, revision: state.revision + 1 };
}
