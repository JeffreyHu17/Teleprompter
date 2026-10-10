import { describe, expect, it, vi } from 'vitest';
import { initialSessionState, sessionReducer } from '../src/core/session';
import { manualPositionCommand, speechFollowActive, transcriptCommands } from '../src/core/speechFollow';

const listening = () => sessionReducer(initialSessionState(), { type: 'setMode', mode: 'ai' });

describe('speech transcript consumer lifecycle', () => {
  it('discards late transcript after microphone pause', () => {
    const state = sessionReducer(listening(), { type: 'setMicrophoneEnabled', enabled: false });
    const match = vi.fn();
    expect(transcriptCommands(state, { text: '迟到的识别结果' }, { match })).toEqual([]);
    expect(match).not.toHaveBeenCalled();
    expect(speechFollowActive(state)).toBe(false);
  });
  it('discards late transcript after switching to fixed mode', () => {
    const state = sessionReducer(listening(), { type: 'setMode', mode: 'fixed' });
    const match = vi.fn();
    expect(transcriptCommands(state, { text: '迟到的识别结果' }, { match })).toEqual([]);
    expect(match).not.toHaveBeenCalled();
  });
  it('does not couple AI listening to the fixed-speed play flag', () => {
    const state = listening();
    expect(state.isPlaying).toBe(false);
    expect(speechFollowActive(state)).toBe(true);
  });
  it('does not compute or move on empty recognition results', () => {
    const match = vi.fn();
    expect(transcriptCommands(listening(), { text: '  ' }, { match })).toEqual([]);
    expect(match).not.toHaveBeenCalled();
  });
  it('forwards the exact recognition time and configured rewind range', () => {
    const state = listening();
    const match = vi.fn().mockReturnValue({ offset: 8, direction: 'forward', confidence: .93 });
    const commands = transcriptCommands(state, { text: ' 测试识别 ', isFinal: true, confidence: .8 }, { match }, 1234);
    expect(match).toHaveBeenCalledWith(state.document, '测试识别', state.anchor.globalOffset, true, 1234, state.tracking.rewindCharacters);
    expect(commands.map(x => x.type)).toEqual(['setTracker', 'seek']);
  });
  it('records reread before seeking and does not fabricate events for hold', () => {
    const state = listening();
    const match = vi.fn().mockReturnValue({ offset: 2, direction: 'backward', confidence: .9 });
    const commands = transcriptCommands(state, { text: '回读这句话' }, { match }, 2000);
    expect(commands.map(x => x.type)).toEqual(['setTracker', 'recordReread', 'seek']);
    expect(commands[1]).toMatchObject({ event: { observedAt: 2000, documentRevision: state.document.revision, timeBasis: 'recognition-observation' } });
    match.mockReturnValue({ offset: 2, direction: 'hold', confidence: .9 });
    expect(transcriptCommands(state, { text: '回读这句话' }, { match }).map(x => x.type)).toEqual(['setTracker']);
  });
  it('treats wheel/touch/keyboard scroll and navigation as manual positioning', () => {
    for (const type of ['scrollStep', 'seek', 'navigatePage', 'navigateParagraph', 'rewindStep'] as const) expect(manualPositionCommand({ type })).toBe(true);
    for (const type of ['tick', 'reportLayout', 'setTracker', 'setSpeed'] as const) expect(manualPositionCommand({ type })).toBe(false);
  });
});
