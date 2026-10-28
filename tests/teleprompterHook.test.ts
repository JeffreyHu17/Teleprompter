import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialSessionState } from '../src/core/session';

const model = vi.hoisted(() => ({ effects: [] as Array<() => unknown>, state: null as any, created: 0 }));
vi.mock('react', () => ({ useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }),
  useCallback: (fn: unknown) => fn, useEffect: (fn: () => unknown) => model.effects.push(fn) }));
vi.mock('../src/desktop/browserSession', () => ({ getBrowserState: () => model.state, dispatchBrowserCommand: vi.fn(), subscribeBrowserState: vi.fn() }));
vi.mock('../src/desktop/desktopStreamingSpeechCapture', () => ({ DesktopStreamingSpeechCapture: class {
  constructor() { model.created++; }
  start = async () => undefined;
  stop = async () => undefined;
  updateProcessing = async () => undefined;
} }));
import { useTeleprompter } from '../src/desktop/useTeleprompter';

let subscribers: Array<(event: unknown) => void>;
beforeEach(() => {
  subscribers = []; model.effects = []; model.created = 0; model.state = initialSessionState();
  vi.stubGlobal('navigator', { userAgent: 'Electron Mac OS X', mediaDevices: { enumerateDevices: async () => [], addEventListener() {}, removeEventListener() {} } });
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720, teleprompter: {
    getState: async () => model.state, listDisplays: async () => [], subscribeState: () => () => {}, subscribeDisplays: () => () => {},
    subscribeSpeechCapture: (callback: (event: unknown) => void) => { subscribers.push(callback); return () => {}; },
  } });
});
afterEach(() => vi.unstubAllGlobals());
it('only the explicitly designated controller subscribes to microphone capture', async () => {
  useTeleprompter(); // display
  useTeleprompter({ captureSpeech: true }); // controller
  model.effects.forEach((effect) => effect());
  await Promise.resolve();
  expect(subscribers).toHaveLength(1);
  subscribers[0]({ enabled: true, mode: 'streaming', deviceId: null, processing: model.state.microphoneProcessing });
  expect(model.created).toBe(1);
});
