import { describe, expect, it } from 'vitest';
import { BidirectionalScriptTracker, normalizeSpeechText, rewindRangeStart } from '../src/core/scriptTracker';
import { anchorAt, createDocument } from '../src/core/session';

const TEXT = `欢迎使用智能提词器，我们现在开始测试自动跟随功能。

这是第二段内容，说话时画面应该稳定地向前移动，即使漏掉一两个字也没有关系。

这是第三段内容，如果读错了可以重新朗读上一句，系统应该自动跳回。

最后一段用于验证正常结束。`;

describe('bidirectional script tracker', () => {
  it('normalizes punctuation, case and spacing', () => {
    expect(normalizeSpeechText(' AI 跟随，Test 123！')).toBe('ai跟随test123');
  });

  it('follows normal forward reading', () => {
    const document = createDocument('test', TEXT);
    const tracker = new BidirectionalScriptTracker();
    const match = tracker.match(document, '这是第二段内容说话时画面应该稳定地向前移动', 0, false, 1000);
    expect(match?.direction).toBe('forward');
    expect(match?.offset).toBeGreaterThan(document.paragraphs[1].startOffset);
  });

  it('tolerates a small recognition substitution', () => {
    const document = createDocument('test', TEXT);
    const tracker = new BidirectionalScriptTracker();
    const match = tracker.match(document, '说话时画面应该稳定的向前移动即使漏掉两个字', document.paragraphs[1].startOffset, false, 1000);
    expect(match?.confidence).toBeGreaterThan(0.7);
    expect(match?.direction).toBe('forward');
  });

  it('matches different Chinese characters with the same pronunciation', () => {
    const document = createDocument('test', '现在开始测试。请不要停下来。');
    const tracker = new BidirectionalScriptTracker();
    const match = tracker.match(document, '现在开始侧视', 0, false, 1000);
    expect(match?.direction).toBe('forward');
    expect(match?.offset).toBeGreaterThanOrEqual(6);
  });

  it('advances by one Chinese syllable after the position is locked', () => {
    const document = createDocument('test', '欢迎使用智能提词器');
    const tracker = new BidirectionalScriptTracker();
    const initial = tracker.match(document, '欢迎使用', 0, false, 1000);
    expect(initial?.direction).toBe('forward');
    const next = tracker.match(document, '智', initial!.offset, false, 1500);
    expect(next?.direction).toBe('forward');
    expect(next?.offset).toBe(initial!.offset + 1);
  });

  it('treats English words as units instead of individual letters', () => {
    const document = createDocument('test', '欢迎使用 Teleprompter Studio 进行演示');
    const tracker = new BidirectionalScriptTracker();
    const locked = tracker.match(document, '欢迎使用', 0, false, 1000);
    const partialWord = tracker.match(document, 'Tele', locked!.offset, false, 1200);
    const fullWord = tracker.match(document, 'Teleprompter', locked!.offset, false, 1500);
    expect(partialWord).toBeNull();
    expect(fullWord?.direction).toBe('forward');
    expect(fullWord!.offset - locked!.offset).toBe(' Teleprompter'.length);
  });

  it('triggers immediate rewind on long high-confidence queries and confirms on short queries', () => {
    const document = createDocument('test', TEXT);
    const tracker = new BidirectionalScriptTracker();
    const current = document.paragraphs[3].startOffset;
    // Short 3-character query requires confirmation on partial
    const shortFirst = tracker.match(document, '这是第', current, false, 1000);
    const shortSecond = tracker.match(document, '这是第二', current, false, 1400);
    expect(shortFirst).toBeNull();
    expect(shortSecond?.direction).toBe('backward');
    expect(shortSecond?.offset).toBeLessThan(current);

    // High confidence query triggers immediate rewind
    const tracker2 = new BidirectionalScriptTracker();
    const immediate = tracker2.match(document, '这是第二段内容说话时画面应该稳定地向前移动', current, false, 1000);
    expect(immediate?.direction).toBe('backward');
    expect(immediate?.offset).toBeLessThan(current);
  });

  it('allows short-distance rewind of 3 to 10 characters and aligns to clause start', () => {
    const document = createDocument('test', '今天的天气非常晴朗，阳光明媚，微风拂面。');
    const tracker = new BidirectionalScriptTracker();
    const forward = tracker.match(document, '今天的天气非常晴朗阳光明媚微风拂面', 0, true, 1000);
    expect(forward?.direction).toBe('forward');
    const currentOffset = forward!.offset; // at end of sentence

    // Speaker rereads the previous short phrase "阳光明媚"
    const rewind = tracker.match(document, '阳光明媚', currentOffset, true, 1500);
    expect(rewind?.direction).toBe('backward');
    // "今天的天气非常晴朗，" is 10 chars; the clause starts at offset 10 ("阳")
    expect(rewind?.offset).toBe(10);
  });

  it('does not jump downstream to distant matching words when reading previous content', () => {
    // Both paragraphs share the word "功能测试"
    const docWithDuplicates = createDocument('test', `第一段进行基础功能测试。\n\n第二段是主要内容继续进行。\n\n第三段在很远的后文也提到了功能测试。`);
    const tracker = new BidirectionalScriptTracker();
    const pos2 = docWithDuplicates.paragraphs[1].startOffset + 8; // positioned in paragraph 2

    // Speaker rereads from paragraph 1: "第一段进行基础功能测试"
    const rewind = tracker.match(docWithDuplicates, '第一段进行基础功能测试', pos2, true, 1000);
    expect(rewind?.direction).toBe('backward');
    expect(rewind?.offset).toBeLessThan(pos2);
  });

  it('blocks backward jumps during manual protection', () => {
    const document = createDocument('test', TEXT);
    const tracker = new BidirectionalScriptTracker();
    const current = document.paragraphs[3].startOffset;
    tracker.reset(document, 1000, 2000);
    const match = tracker.match(document, '欢迎使用智能提词器我们现在开始测试', current, true, 1500);
    expect(match).toBeNull();
  });

  it('produces a valid anchor at the matched offset', () => {
    const document = createDocument('test', TEXT);
    const tracker = new BidirectionalScriptTracker();
    const match = tracker.match(document, '这是第三段内容如果读错了可以重新朗读上一句', 0, true, 1000);
    expect(match).not.toBeNull();
    expect(anchorAt(document, match!.offset).paragraphIndex).toBe(2);
  });
});

describe('configured rewind range', () => {
  it('counts characters without splitting supplementary Unicode or counting punctuation', () => {
    const text = '甲，𠀀 A!';
    expect(text.slice(rewindRangeStart(text, text.length, 2))).toBe('𠀀 A!');
    expect(rewindRangeStart(text, text.length, 0)).toBe(text.length);
  });
  it('excludes distant rereads but accepts them when the range grows', () => {
    const document = createDocument('test', TEXT);
    const current = document.paragraphs[3].startOffset;
    const query = '这是第二段内容说话时画面应该稳定地向前移动';
    expect(new BidirectionalScriptTracker().match(document, query, current, true, 1000, 10)?.direction).not.toBe('backward');
    expect(new BidirectionalScriptTracker().match(document, query, current, true, 1000, 560)?.direction).toBe('backward');
    expect(new BidirectionalScriptTracker().match(document, query, current, true, 1000, 0)?.direction).not.toBe('backward');
  });
});
