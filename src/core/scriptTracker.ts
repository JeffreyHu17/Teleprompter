import { pinyin } from 'pinyin-pro';
import type { ScriptDocument } from '../types/session.js';

export interface TrackerMatch {
  offset: number;
  confidence: number;
  direction: 'forward' | 'backward' | 'hold';
  query: string;
}

interface SpeechToken {
  exact: string;
  phonetic: string;
  phonetics: string[];
  sourceOffset: number;
  sourceEnd: number;
}

interface NormalizedScript {
  tokens: SpeechToken[];
}

interface PinyinItem {
  origin: string;
  pinyin: string;
  initial: string;
  final: string;
  isZh: boolean;
  polyphonic: string[];
}

function isTrackable(character: string): boolean {
  return /[\p{Script=Han}\p{L}\p{N}]/u.test(character);
}

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character) && !/\p{Script=Han}/u.test(character);
}

function normalizePinyin(value: string): string {
  return value
    .toLowerCase()
    .replace(/[üǖǘǚǜ]/g, 'v')
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '');
}

export function normalizeSpeechText(text: string): string {
  return [...text.normalize('NFKC').toLowerCase()].filter(isTrackable).join('');
}

function tokenize(text: string, baseOffset = 0): SpeechToken[] {
  const normalized = text.normalize('NFKC');
  // NFKC can expand ligatures or contract combining sequences. Speech matching
  // uses normalized tokens, but every returned anchor must index the source text.
  let sourceStarts: number[] | null = null;
  let sourceEnds: number[] | null = null;
  if (normalized !== text) {
    sourceStarts = [];
    sourceEnds = [];
    if (typeof Intl.Segmenter === 'function') {
      const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
      for (const { segment, index } of segments) {
        const length = segment.normalize('NFKC').length;
        for (let unit = 0; unit < length; unit += 1) {
          sourceStarts.push(index);
          sourceEnds.push(index + segment.length);
        }
      }
    } else {
      // Compatibility path for older WebViews. Only normalization-changing text
      // pays for prefix normalization; modern runtimes use linear segmentation.
      let prefix = '';
      let sourceEnd = 0;
      let normalizedPrefix = '';
      for (const character of text) {
        const sourceStart = sourceEnd;
        prefix += character;
        sourceEnd += character.length;
        const next = prefix.normalize('NFKC');
        let common = 0;
        while (common < normalizedPrefix.length && normalizedPrefix[common] === next[common]) common += 1;
        const changedStart = sourceStarts[common] ?? sourceStart;
        sourceStarts.length = sourceEnds.length = common;
        for (let unit = common; unit < next.length; unit += 1) {
          sourceStarts.push(changedStart);
          sourceEnds.push(sourceEnd);
        }
        if (/\p{Mark}/u.test(character) && sourceEnds.length) sourceEnds[sourceEnds.length - 1] = sourceEnd;
        normalizedPrefix = next;
      }
    }
  }
  const items = pinyin(normalized, { type: 'all', toneType: 'none', v: true }) as PinyinItem[];
  const tokens: SpeechToken[] = [];
  let utf16Offset = 0;
  let word = '';
  let wordStart = 0;
  let wordEnd = 0;

  const flushWord = () => {
    if (!word) return;
    const exact = word.toLowerCase();
    tokens.push({ exact, phonetic: `word:${exact}`, phonetics: [`word:${exact}`], sourceOffset: baseOffset + wordStart, sourceEnd: baseOffset + wordEnd });
    word = '';
  };

  for (const item of items) {
    const origin = item.origin;
    const start = sourceStarts?.[utf16Offset] ?? utf16Offset;
    utf16Offset += origin.length;
    const end = sourceEnds?.[utf16Offset - 1] ?? utf16Offset;
    if (item.isZh) {
      flushWord();
      const exact = origin.toLowerCase();
      const primary = `py:${normalizePinyin(item.pinyin)}`;
      const phonetics = [...new Set([primary, ...item.polyphonic.map((value) => `py:${normalizePinyin(value)}`)])];
      tokens.push({
        exact,
        phonetic: primary,
        phonetics,
        sourceOffset: baseOffset + start,
        sourceEnd: baseOffset + end,
      });
      continue;
    }
    if (/\p{Script=Han}/u.test(origin)) {
      // Rare Han characters outside the pinyin dictionary still match exactly.
      flushWord();
      const exact = origin.toLowerCase();
      tokens.push({ exact, phonetic: `char:${exact}`, phonetics: [`char:${exact}`], sourceOffset: baseOffset + start, sourceEnd: baseOffset + end });
    } else if (isWordCharacter(origin)) {
      if (!word) wordStart = start;
      word += origin;
      wordEnd = end;
    } else {
      flushWord();
    }
  }
  flushWord();
  return tokens;
}

function normalizeDocument(document: ScriptDocument): NormalizedScript {
  return {
    tokens: document.paragraphs.flatMap((paragraph) => tokenize(paragraph.text, paragraph.startOffset)),
  };
}

function substitutionCost(left: SpeechToken, right: SpeechToken): number {
  if (left.exact === right.exact) return 0;
  if (left.phonetic === right.phonetic) return 0;
  if (left.phonetics.some((value) => right.phonetics.includes(value))) return 0.08;
  const leftPinyin = left.phonetic.startsWith('py:') ? left.phonetic.slice(3) : '';
  const rightPinyin = right.phonetic.startsWith('py:') ? right.phonetic.slice(3) : '';
  if (leftPinyin && rightPinyin) {
    const sameInitial = leftPinyin[0] === rightPinyin[0];
    const sameTail = leftPinyin.slice(-2) === rightPinyin.slice(-2);
    if (sameInitial && sameTail) return 0.55;
  }
  return 1;
}

function nearestTokenIndex(script: NormalizedScript, sourceOffset: number): number {
  let low = 0;
  let high = script.tokens.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (script.tokens[middle].sourceEnd <= sourceOffset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function queryLabel(tokens: SpeechToken[]): string {
  return tokens.map((token) => token.exact).join('');
}

/** Count Unicode letters/numbers; return original UTF-16 offsets. */
export function rewindRangeStart(text: string, offset: number, characters: number): number {
  let start = Math.max(0, Math.min(text.length, offset));
  let remaining = Number.isFinite(characters) ? Math.max(0, Math.floor(characters)) : 560;
  while (start > 0 && remaining > 0) {
    const end = start;
    const last = text.charCodeAt(--start);
    if (last >= 0xdc00 && last <= 0xdfff && start > 0) {
      const first = text.charCodeAt(start - 1);
      if (first >= 0xd800 && first <= 0xdbff) start -= 1;
    }
    if (isTrackable(text.slice(start, end))) remaining -= 1;
  }
  return start;
}

/** Find start offset of the current clause or sentence for clean rewind alignment */
export function findSentenceBoundaryStart(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const bound = Math.min(text.length, offset);
  for (let index = bound - 1; index >= 0; index -= 1) {
    const ch = text[index];
    if (/[。！？!?；;\n\r]/.test(ch)) {
      let start = index + 1;
      while (start < bound && /[\s，、,：:]/.test(text[start])) start += 1;
      return start;
    }
    if (/[，、,：:]/.test(ch)) {
      let start = index + 1;
      while (start < bound && /\s/.test(text[start])) start += 1;
      return start;
    }
  }
  return 0;
}

export class BidirectionalScriptTracker {
  private document: ScriptDocument | null = null;
  private fullText = '';
  private script: NormalizedScript = { tokens: [] };
  private backwardCandidate: { offset: number; confirmations: number; lastAt: number } | null = null;
  private protectedUntil = 0;
  private positionLocked = false;
  private lastObservation: { transcript: string; inputOffset: number; result: TrackerMatch | null; isFinal: boolean; rewindCharacters: number; receivedAt: number } | null = null;

  reset(document: ScriptDocument, now = Date.now(), protectMs = 0): void {
    this.ensureDocument(document);
    this.backwardCandidate = null;
    this.lastObservation = null;
    this.protectedUntil = now + protectMs;
    this.positionLocked = protectMs > 0;
  }

  match(document: ScriptDocument, transcript: string, currentOffset: number, isFinal = false, now = Date.now(), rewindCharacters = 560): TrackerMatch | null {
    this.ensureDocument(document);
    const previous = this.lastObservation;
    const sameObservationWindow = previous && now - previous.receivedAt <= (previous.isFinal ? 250 : 2500);
    if (previous && sameObservationWindow && (!previous.isFinal || isFinal)
      && previous.rewindCharacters === rewindCharacters && previous.transcript === transcript && previous.result
      && (currentOffset === previous.inputOffset || currentOffset === previous.result.offset)) {
      previous.isFinal = isFinal;
      previous.receivedAt = now;
      return currentOffset === previous.result.offset
        ? { ...previous.result, offset: currentOffset, direction: 'hold' }
        : previous.result;
    }
    // A recognizer can retract the end of an interim hypothesis while revising
    // it. That is not a reread. Keep the last applied position until the partial
    // grows or changes; a finalized utterance or reset permits a genuine reread.
    if (previous && sameObservationWindow && !previous.isFinal && previous.rewindCharacters === rewindCharacters && previous.result
      && currentOffset === previous.result.offset && transcript.length < previous.transcript.length) {
      const query = normalizeSpeechText(transcript);
      if (query && normalizeSpeechText(previous.transcript).startsWith(query)) {
        previous.isFinal = isFinal;
        previous.receivedAt = now;
        return { ...previous.result, offset: currentOffset, direction: 'hold' };
      }
    }
    const result = this.matchTranscript(transcript, currentOffset, isFinal, now, rewindCharacters);
    this.lastObservation = { transcript, inputOffset: currentOffset, result, isFinal, rewindCharacters, receivedAt: now };
    return result;
  }

  private matchTranscript(transcript: string, currentOffset: number, isFinal: boolean, now: number, rewindCharacters: number): TrackerMatch | null {
    const transcriptTokens = tokenize(transcript);
    const minimumTokens = this.positionLocked || currentOffset > 0 ? 1 : 4;
    if (transcriptTokens.length < minimumTokens || !this.script.tokens.length) return null;

    const currentIndex = nearestTokenIndex(this.script, currentOffset);
    const shortQuery = transcriptTokens.length < 4;
    const forwardLimit = shortQuery ? 48 : 600;
    const fullText = this.fullText;
    const rangeStart = rewindRangeStart(fullText, currentOffset, rewindCharacters);
    let configuredStart = nearestTokenIndex(this.script, rangeStart);
    if (this.script.tokens[configuredStart]?.sourceOffset < rangeStart) configuredStart += 1;
    // Respect configured rewind start boundary strictly; apply manual protection limit if protected
    const searchStart = Math.max(
      0,
      configuredStart >= this.script.tokens.length ? currentIndex : configuredStart,
      now < this.protectedUntil ? currentIndex - 32 : 0,
    );
    const searchEnd = Math.min(this.script.tokens.length, currentIndex + forwardLimit);
    const lengths = [...new Set([
      Math.min(28, transcriptTokens.length),
      20,
      14,
      9,
      6,
      4,
      ...(transcriptTokens.length < 4 && (this.positionLocked || currentOffset > 0) ? [3, 2, 1] : []),
    ])].filter((length) => length >= minimumTokens && length <= transcriptTokens.length);

    // Every candidate ends at `end`, so reversing both sequences lets one
    // dynamic-programming table score all query/candidate suffix lengths. Cache
    // token costs once per search window instead of recalculating pinyin matches
    // for each candidate. Float64 keeps the existing weighted-distance precision.
    const span = searchEnd - searchStart;
    const longestQuery = Math.max(...lengths);
    const maxCandidateLength = Math.min(longestQuery + Math.ceil(longestQuery * 0.2), longestQuery + 4);
    const costs = new Float64Array(longestQuery * span);
    for (let row = 0; row < longestQuery; row += 1) {
      const token = transcriptTokens[transcriptTokens.length - 1 - row];
      for (let index = 0; index < span; index += 1) {
        costs[row * span + index] = substitutionCost(token, this.script.tokens[searchStart + index]);
      }
    }
    const queries = new Map(lengths.map((length, rank) => [length, {
      rank,
      tokens: transcriptTokens.slice(-length),
      minimum: Math.max(1, length - Math.ceil(length * 0.2)),
      maximum: Math.min(length + Math.ceil(length * 0.2), length + 4),
    }]));
    let previous = new Float64Array(maxCandidateLength + 1);
    let current = new Float64Array(maxCandidateLength + 1);
    let best: { index: number; start: number; score: number; query: SpeechToken[]; order: number } | null = null;
    let secondScore = -Infinity;
    for (let end = searchStart + 1; end <= searchEnd; end += 1) {
      const width = Math.min(maxCandidateLength, end - searchStart);
      for (let column = 0; column <= width; column += 1) previous[column] = column;
      const sourceOffset = this.script.tokens[end - 1].sourceEnd;
      const distanceFromCurrent = Math.abs(sourceOffset - currentOffset);
      const isBackward = sourceOffset < currentOffset;
      const distantForwardPenalty = (!isBackward && distanceFromCurrent > 120) ? Math.min(0.15, (distanceFromCurrent - 120) / 1000) : 0;
      const proximityPenalty = Math.min(shortQuery ? 0.12 : 0.05, distanceFromCurrent / (shortQuery ? 1200 : 25_000));
      for (let length = 1; length <= longestQuery; length += 1) {
        current[0] = length;
        for (let column = 1; column <= width; column += 1) {
          current[column] = Math.min(
            current[column - 1] + 1,
            previous[column] + 1,
            previous[column - 1] + costs[(length - 1) * span + end - column - searchStart],
          );
        }
        const query = queries.get(length);
        if (query) {
          const lengthBonus = Math.min(0.08, length / 300);
          for (let candidateLength = query.minimum; candidateLength <= Math.min(width, query.maximum); candidateLength += 1) {
            const similarity = 1 - current[candidateLength] / Math.max(length, candidateLength);
            const directionPenalty = isBackward ? (similarity >= 0.85 && length >= 4 ? 0 : 0.015) : 0;
            const score = similarity + lengthBonus - directionPenalty - proximityPenalty - distantForwardPenalty;
            // Preserve the original longest-query/end/candidate tie ordering.
            const order = (query.rank * (span + 1) + end - searchStart) * (maxCandidateLength + 1) + candidateLength;
            if (!best || score > best.score || (score === best.score && order < best.order)) {
              if (best) secondScore = Math.max(secondScore, best.score);
              best = { index: end, start: end - candidateLength, score, query: query.tokens, order };
            } else {
              secondScore = Math.max(secondScore, score);
            }
          }
        }
        const swap = previous;
        previous = current;
        current = swap;
      }
    }
    if (!best) return null;

    const confidence = Math.max(0, Math.min(1, best.score));
    const ambiguity = best.score - secondScore;
    const targetOffset = this.script.tokens[Math.max(0, best.index - 1)].sourceEnd;
    const delta = targetOffset - currentOffset;
    const threshold = best.query.length >= 12 ? 0.68 : best.query.length >= 6 ? 0.75 : best.query.length >= 4 ? 0.78 : 0.88;
    if (confidence < threshold || (ambiguity < 0.01 && best.query.length < 4)) return null;
    if (delta === 0) return { offset: currentOffset, confidence, direction: 'hold', query: queryLabel(best.query) };

    if (delta < 0) {
      if (rewindCharacters <= 0 || now < this.protectedUntil) return null;
      // Allow rewind if back at least 2 chars (short reread) and length is at least 3 tokens
      if (delta > -2 || best.query.length < 3) return null;

      // Align rewind offset to sentence/clause start so speaker sees the entire beginning of the sentence
      const matchStartOffset = this.script.tokens[best.start].sourceOffset;
      const rewindSentenceStart = findSentenceBoundaryStart(fullText, matchStartOffset);
      const rewindOffset = Math.max(rangeStart, Math.min(targetOffset, rewindSentenceStart));

      // High-confidence or long query triggers immediate rewind even on streaming partials
      const immediateRewind = isFinal || (best.query.length >= 5 && confidence >= 0.80) || (best.query.length >= 4 && confidence >= 0.88);
      if (immediateRewind) {
        this.backwardCandidate = null;
        this.positionLocked = true;
        return { offset: rewindOffset, confidence, direction: 'backward', query: queryLabel(best.query) };
      }

      // Continuous stream tracking for progressive partials
      const sameCandidate = this.backwardCandidate
        && targetOffset >= this.backwardCandidate.offset - 4
        && targetOffset <= this.backwardCandidate.offset + 28
        && now - this.backwardCandidate.lastAt < 2500;
      this.backwardCandidate = {
        offset: targetOffset,
        confirmations: sameCandidate ? this.backwardCandidate!.confirmations + 1 : 1,
        lastAt: now,
      };
      if (this.backwardCandidate.confirmations < 2) return null;
      this.backwardCandidate = null;
      this.positionLocked = true;
      return { offset: rewindOffset, confidence, direction: 'backward', query: queryLabel(best.query) };
    }

    // Guard against distant forward jumps on weak queries
    if (delta > 100 && best.query.length < 5 && confidence < 0.88) {
      return null;
    }

    this.backwardCandidate = null;
    this.positionLocked = true;
    return { offset: targetOffset, confidence, direction: 'forward', query: queryLabel(best.query) };
  }

  private ensureDocument(document: ScriptDocument): void {
    if (this.document === document) return;
    this.document = document;
    this.fullText = document.paragraphs.map((paragraph) => paragraph.text).join('\n');
    this.script = normalizeDocument(document);
    this.lastObservation = null;
    this.backwardCandidate = null;
    this.positionLocked = false;
  }
}
