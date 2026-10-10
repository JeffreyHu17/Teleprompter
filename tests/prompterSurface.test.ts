import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { anchorAt, createDocument, initialSessionState } from '../src/core/session';

// Pure render regression: model memo/ref hooks, but do not claim DOM layout or
// actual browser frame timing. Browser/device acceptance is documented separately.
const hooks = vi.hoisted(() => ({
  memo: [] as Array<{ deps: unknown[]; value: unknown }>, refs: [] as Array<{ current: unknown }>, memoIndex: 0, refIndex: 0,
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (compute: () => unknown, deps: unknown[]) => {
    const index = hooks.memoIndex++;
    const old = hooks.memo[index];
    if (old && deps.length === old.deps.length && deps.every((value, i) => Object.is(value, old.deps[i]))) return old.value;
    const value = compute(); hooks.memo[index] = { deps, value }; return value;
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
  useState: (initial: unknown) => [initial, () => undefined],
  useLayoutEffect: () => undefined,
}));

import { PrompterSurface } from '../src/components/PrompterSurface';

type Element = ReactElement<{ className?: string; style?: Record<string, unknown>; children?: ReactNode }>;
function find(node: ReactNode, className: string): Element | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) return node.map((child) => find(child, className)).find(Boolean);
  const element = node as Element;
  if (element.props?.className?.split(' ').includes(className)) return element;
  return find(element.props?.children, className);
}
function render(state: ReturnType<typeof initialSessionState>, viewMirrorHorizontal = false) {
  hooks.memoIndex = hooks.refIndex = 0;
  return PrompterSurface({ state, viewportWidth: 1280, viewportHeight: 720, viewMirrorHorizontal });
}
beforeEach(() => { hooks.memo = []; hooks.refs = []; });

describe('prompter render work', () => {
  it('reuses the complete paragraph subtree for 600 scroll frames', () => {
    const state = { ...initialSessionState(), document: createDocument('long', Array(500).fill('欢迎使用提词器。').join('\n\n')) };
    const first = find(render(state), 'prompter-stage')!;
    expect(first.props.children).toHaveLength(500);
    for (let i = 1; i <= 600; i++) {
      const stage = find(render({ ...state, isPlaying: true, scrollOffsetPx: i }), 'prompter-stage')!;
      expect(stage.props.children).toBe(first.props.children);
      expect(stage.props.style?.['--stage-y']).not.toBe(first.props.style?.['--stage-y']);
    }
  });

  it('updates AI highlights and invalidates text on document changes', () => {
    const state = { ...initialSessionState(), playbackMode: 'ai' as const };
    const first = find(render(state), 'prompter-stage')!;
    const advanced = find(render({ ...state, anchor: anchorAt(state.document, 4) }), 'prompter-stage')!;
    expect(advanced.props.children).not.toBe(first.props.children);
    const replaced = find(render({ ...state, document: createDocument('new', '新的稿件内容') }), 'prompter-stage')!;
    expect(replaced.props.children).toHaveLength(1);
    expect(replaced.props.children).not.toBe(advanced.props.children);
  });

  it('preserves all mirror modes and controller preview inversion', () => {
    for (const [mirrorMode, transform] of [['none', 'scale(1, 1)'], ['horizontal', 'scale(-1, 1)'], ['vertical', 'scale(1, -1)'], ['both', 'scale(-1, -1)']] as const) {
      const state = { ...initialSessionState(), mirrorMode };
      expect(find(render(state), 'prompter-mirror-layer')!.props.style?.transform).toBe(transform);
    }
    expect(find(render({ ...initialSessionState(), mirrorMode: 'horizontal' }, true), 'prompter-mirror-layer')!.props.style?.transform).toBe('scale(1, 1)');
  });
});
