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
    const start = utf16Offset;
    utf16Offset += origin.length;
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
        sourceEnd: baseOffset + utf16Offset,
      });
      continue;
    }
    if (isWordCharacter(origin)) {
      if (!word) wordStart = start;
      word += origin;
      wordEnd = utf16Offset;
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

function editDistance(left: SpeechToken[], right: SpeechToken[]): number {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost(left[leftIndex - 1], right[rightIndex - 1]),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
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
  const prefix = Array.from(text.slice(0, start));
  for (let index = prefix.length - 1; index >= 0 && remaining > 0; index -= 1) {
    start -= prefix[index].length;
    if (isTrackable(prefix[index])) remaining -= 1;
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
  private documentRevision = -1;
  private script: NormalizedScript = { tokens: [] };
  private backwardCandidate: { offset: number; confirmations: number; lastAt: number } | null = null;
  private protectedUntil = 0;
  private positionLocked = false;

  reset(document: ScriptDocument, now = Date.now(), protectMs = 0): void {
    this.ensureDocument(document);
    this.backwardCandidate = null;
    this.protectedUntil = now + protectMs;
    this.positionLocked = protectMs > 0;
  }

  match(document: ScriptDocument, transcript: string, currentOffset: number, isFinal = false, now = Date.now(), rewindCharacters = 560): TrackerMatch | null {
    this.ensureDocument(document);
    const transcriptTokens = tokenize(transcript);
    const minimumTokens = this.positionLocked || currentOffset > 0 ? 1 : 4;
    if (transcriptTokens.length < minimumTokens || !this.script.tokens.length) return null;

    const currentIndex = nearestTokenIndex(this.script, currentOffset);
    const shortQuery = transcriptTokens.length < 4;
    const backwardLimit = shortQuery ? (now < this.protectedUntil ? 16 : 120) : now < this.protectedUntil ? 32 : 560;
    const forwardLimit = shortQuery ? 48 : 600;
    const fullText = document.paragraphs.map((paragraph) => paragraph.text).join('\n');
    const rangeStart = rewindRangeStart(fullText, currentOffset, rewindCharacters);
    const configuredStart = this.script.tokens.findIndex((token) => token.sourceOffset >= rangeStart);
    // Respect configured rewind start boundary strictly; apply manual protection limit if protected
    const searchStart = Math.max(
      0,
      configuredStart < 0 ? currentIndex : configuredStart,
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

    let best: { index: number; score: number; query: SpeechToken[] } | null = null;
    let secondScore = -Infinity;
    for (const length of lengths) {
      const query = transcriptTokens.slice(-length);
      const minCandidateLength = Math.max(1, length - Math.ceil(length * 0.2));
      const maxCandidateLength = Math.min(length + Math.ceil(length * 0.2), length + 4);
      for (let end = searchStart + minCandidateLength; end <= searchEnd; end += 1) {
        for (let candidateLength = minCandidateLength; candidateLength <= maxCandidateLength; candidateLength += 1) {
          const start = end - candidateLength;
          if (start < searchStart) continue;
          const candidate = this.script.tokens.slice(start, end);
          const distance = editDistance(query, candidate);
          const similarity = 1 - distance / Math.max(query.length, candidate.length);
          const sourceOffset = this.script.tokens[Math.max(0, end - 1)].sourceEnd;
          const distanceFromCurrent = Math.abs(sourceOffset - currentOffset);

          // Direction & proximity penalties:
          // If match is backward and highly similar, do not penalize it.
          // Penalize distant forward jumps heavily to avoid false jumps downstream.
          const isBackward = sourceOffset < currentOffset;
          const directionPenalty = isBackward ? (similarity >= 0.85 && query.length >= 4 ? 0 : 0.015) : 0;
          const distantForwardPenalty = (!isBackward && distanceFromCurrent > 120) ? Math.min(0.15, (distanceFromCurrent - 120) / 1000) : 0;
          const proximityPenalty = Math.min(shortQuery ? 0.12 : 0.05, distanceFromCurrent / (shortQuery ? 1200 : 25_000));
          const lengthBonus = Math.min(0.08, query.length / 300);
          const score = similarity + lengthBonus - directionPenalty - proximityPenalty - distantForwardPenalty;
          if (!best || score > best.score) {
            if (best) secondScore = Math.max(secondScore, best.score);
            best = { index: end, score, query };
          } else {
            secondScore = Math.max(secondScore, score);
          }
        }
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
      const matchStartOffset = this.script.tokens[Math.max(0, best.index - best.query.length)].sourceOffset;
      const rewindSentenceStart = findSentenceBoundaryStart(fullText, matchStartOffset);
      const rewindOffset = Math.min(targetOffset, rewindSentenceStart);

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
    if (this.documentRevision === document.revision) return;
    this.documentRevision = document.revision;
    this.script = normalizeDocument(document);
    this.backwardCandidate = null;
    this.positionLocked = false;
  }
}
