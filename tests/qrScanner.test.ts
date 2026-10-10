import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep these lifecycle tests dependency-free. The harness models hook commits and
// effect cleanup, while camera, canvas, animation frames, and decoder are fakes.
const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  states: [] as unknown[],
  effects: [] as Array<{ deps: unknown[] | undefined; cleanup?: () => void }>,
  pending: [] as Array<() => void>,
  refIndex: 0,
  stateIndex: 0,
  effectIndex: 0,
}));
const decode = vi.hoisted(() => vi.fn<(...args: unknown[]) => { data: string } | null>(() => null));

vi.mock('jsqr', () => ({ default: decode }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return hooks.refs[index] ??= { current: initial };
  },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => {
      hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value;
    }];
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hooks.effectIndex++;
    const previous = hooks.effects[index];
    if (previous && deps && previous.deps && deps.length === previous.deps.length
      && deps.every((value, dependency) => Object.is(value, previous.deps?.[dependency]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects[index] = { deps, cleanup: effect() || undefined };
    });
  },
}));

import { QrScanner } from '../src/web/remote/QrScanner';

type ScanHandler = (value: string) => boolean | Promise<boolean>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let stopTrack: ReturnType<typeof vi.fn>;
let stream: MediaStream;
let video: { srcObject: MediaStream | null; videoWidth: number; videoHeight: number; play: ReturnType<typeof vi.fn> };
let getUserMedia: ReturnType<typeof vi.fn>;
let createCanvas: ReturnType<typeof vi.fn>;
let drawImage: ReturnType<typeof vi.fn>;
let resizeWidth: ReturnType<typeof vi.fn<(next: number) => void>>;
let resizeHeight: ReturnType<typeof vi.fn<(next: number) => void>>;
let context: { drawImage: ReturnType<typeof vi.fn>; getImageData: ReturnType<typeof vi.fn> };

function render(onScan: ScanHandler = () => false, hint = 'Point at the pairing QR code') {
  hooks.refIndex = hooks.stateIndex = hooks.effectIndex = 0;
  QrScanner({ title: 'Scan', hint, onScan, onClose: () => undefined });
  hooks.refs[0].current = video;
  hooks.pending.splice(0).forEach((commit) => commit());
}

function unmount() {
  if (hooks.refs[0]) hooks.refs[0].current = null;
  hooks.effects.forEach((effect) => effect.cleanup?.());
  hooks.effects = [];
}

async function tick(now: number) {
  const queued = [...frames.values()];
  frames.clear();
  queued.forEach((callback) => callback(now));
  // The validation path intentionally catches synchronous and async callbacks.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitUntilScanning() {
  await vi.waitFor(() => expect(frames.size).toBe(1));
}

beforeEach(() => {
  hooks.refs = [];
  hooks.states = [];
  hooks.effects = [];
  hooks.pending = [];
  decode.mockReset().mockReturnValue(null);
  frames = new Map();
  frameId = 0;
  stopTrack = vi.fn();
  stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  video = { srcObject: null, videoWidth: 1280, videoHeight: 720, play: vi.fn().mockResolvedValue(undefined) };
  getUserMedia = vi.fn().mockResolvedValue(stream);
  drawImage = vi.fn();
  context = { drawImage, getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })) };
  let width = 300;
  let height = 150;
  resizeWidth = vi.fn((next: number) => { width = next; });
  resizeHeight = vi.fn((next: number) => { height = next; });
  const canvas = {
    get width() { return width; },
    set width(next: number) { resizeWidth(next); },
    get height() { return height; },
    set height(next: number) { resizeHeight(next); },
    getContext: () => context,
  };
  createCanvas = vi.fn(() => canvas);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('document', { createElement: createCanvas });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('QR scanner lifecycle', () => {
  it('does not request the camera when closed before the decoder finishes loading', async () => {
    render();
    unmount();
    await vi.dynamicImportSettled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(createCanvas).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('reuses the canvas backing size until video dimensions change and retains 10 Hz decoding', async () => {
    render();
    await waitUntilScanning();
    await tick(100);
    await tick(150);
    await tick(200);
    await tick(300);
    expect(decode).toHaveBeenCalledTimes(3);
    expect(resizeWidth.mock.calls).toEqual([[900]]);
    expect(resizeHeight.mock.calls).toEqual([[506]]);
    expect(decode).toHaveBeenLastCalledWith(expect.any(Uint8ClampedArray), 1, 1, { inversionAttempts: 'attemptBoth' });

    video.videoWidth = 640;
    video.videoHeight = 480;
    await tick(400);
    expect(resizeWidth.mock.calls).toEqual([[900], [640]]);
    expect(resizeHeight.mock.calls).toEqual([[506], [480]]);
  });

  it('uses the latest callback without reopening the camera and resumes after an invalid code', async () => {
    const firstScan = vi.fn(() => false);
    const nextScan = vi.fn(() => true);
    decode.mockReturnValue({ data: 'pairing payload' });
    render(firstScan);
    await waitUntilScanning();
    await tick(100);
    expect(firstScan).toHaveBeenCalledWith('pairing payload');
    expect(hooks.states[0]).toContain('二维码无效');
    expect(frames.size).toBe(1);

    render(nextScan, 'Updated hint');
    await tick(200);
    expect(nextScan).toHaveBeenCalledWith('pairing payload');
    expect(firstScan).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stopTrack).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    unmount();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it('stops a stream acquired after the scanner closes', async () => {
    const acquisition = deferred<MediaStream>();
    getUserMedia.mockReturnValue(acquisition.promise);
    render();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    unmount();
    acquisition.resolve(stream);
    await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(1));
    expect(video.play).not.toHaveBeenCalled();
    expect(createCanvas).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('does not allocate a canvas or schedule work when pending video playback finishes after close', async () => {
    const playback = deferred<void>();
    video.play.mockReturnValue(playback.promise);
    render();
    await vi.waitFor(() => expect(video.play).toHaveBeenCalledTimes(1));
    unmount();
    playback.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(createCanvas).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(hooks.states[0]).toBe('正在打开相机…');
  });

  it('releases the camera immediately when playback fails', async () => {
    video.play.mockRejectedValue(new Error('playback denied'));
    render();
    await vi.waitFor(() => expect(hooks.states[0]).toContain('playback denied'));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(frames.size).toBe(0);
  });

  it.each(['throw', 'reject'] as const)('resumes scanning when the validation callback %ss', async (failure) => {
    decode.mockReturnValue({ data: 'pairing payload' });
    render(() => {
      if (failure === 'throw') throw new Error('invalid payload');
      return Promise.reject(new Error('invalid payload'));
    });
    await waitUntilScanning();
    await tick(100);
    await vi.waitFor(() => expect(hooks.states[0]).toContain('二维码验证失败'));
    expect(frames.size).toBe(1);
  });

  it('does not resume scanning after closing during validation', async () => {
    const validation = deferred<boolean>();
    const onScan = vi.fn(() => validation.promise);
    decode.mockReturnValue({ data: 'pairing payload' });
    render(onScan);
    await waitUntilScanning();
    await tick(100);
    expect(onScan).toHaveBeenCalledTimes(1);
    unmount();
    validation.resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.size).toBe(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
