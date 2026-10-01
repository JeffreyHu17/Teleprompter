import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { transformWithOxc } from 'vite';

// Run against a known baseline: node scripts/benchmark-tracker.mjs <git-ref>
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ref = process.argv[2] ?? 'HEAD';
const baselineCommit = execFileSync('git', ['rev-parse', ref], { cwd: root, encoding: 'utf8' }).trim();
const temporary = await mkdtemp(join(root, '.tracker-benchmark-'));
const compile = async (name, source) => {
  const path = join(temporary, `${name}.mjs`);
  await writeFile(path, (await transformWithOxc(source, `${name}.ts`, { target: 'es2022' })).code);
  return import(pathToFileURL(path));
};
try {
  const { BidirectionalScriptTracker: Before } = await compile('before', execFileSync('git', ['show', `${ref}:src/core/scriptTracker.ts`], { cwd: root, encoding: 'utf8' }));
  const { BidirectionalScriptTracker: After } = await compile('after', await readFile(join(root, 'src/core/scriptTracker.ts'), 'utf8'));
  const { createDocument } = await compile('session', await readFile(join(root, 'src/core/session.ts'), 'utf8'));
  const paragraph = '今天我们开始测试自动跟随功能，画面应该稳定地向前移动，即使漏掉一两个字也没有关系。接下来我们回顾主要内容，确保长稿件中的定位准确。';
  const document = createDocument('long', Array.from({ length: 180 }, (_, index) => `${index} ${paragraph}`).join('\n\n'));
  const offset = document.paragraphs[100].startOffset + 30;
  const transcript = '画面应该稳定的向前移动即使漏掉两个字也没有关系接下来我们回顾主要内容';
  const run = (Tracker) => {
    const tracker = new Tracker();
    tracker.reset(document);
    const durations = [];
    let result;
    for (let index = 0; index < 9; index += 1) {
      const start = performance.now();
      result = tracker.match(document, transcript, offset, true, 1000 + index * 3000);
      durations.push(performance.now() - start);
    }
    const sorted = durations.slice(1).sort((a, b) => a - b);
    return { medianMs: (sorted[3] + sorted[4]) / 2, result, durations };
  };
  const before = run(Before);
  const after = run(After);
  assert.deepEqual(after.result, before.result, 'Benchmark fixture must preserve the baseline match');

  // Deterministic differential fixtures compare offsets, direction and confidence,
  // including substitutions, skipped syllables, repeated clauses and short partials.
  let seed = 7241;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const alphabet = [...'天地山水草木风雨春夏秋冬灯光人物东西南北测试功能自动语言'];
  for (let index = 0; index < 100; index += 1) {
    const text = Array.from({ length: 55 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    const doc = createDocument('differential', text);
    const start = Math.floor(random() * 35);
    let query = text.slice(start, start + 4 + Math.floor(random() * 18));
    if (index % 3 === 0) query = query.slice(0, 2) + '的' + query.slice(3);
    if (index % 5 === 0) query = query.slice(0, 3) + query.slice(4);
    const currentOffset = Math.floor(random() * 15);
    const expected = new Before().match(doc, query, currentOffset, true, 1000);
    const actual = new After().match(doc, query, currentOffset, true, 1000);
    assert.equal(actual?.offset, expected?.offset, `fixture ${index}: offset`);
    assert.equal(actual?.direction, expected?.direction, `fixture ${index}: direction`);
    assert.equal(actual?.query, expected?.query, `fixture ${index}: query`);
    if (actual && expected) assert.ok(Math.abs(actual.confidence - expected.confidence) < 1e-12, `fixture ${index}: confidence`);
  }
  console.log(JSON.stringify({ baseline: ref, baselineCommit, node: process.version, platform: process.platform, paragraphs: document.paragraphs.length, characters: document.totalCharacters, before, after, speedup: before.medianMs / after.medianMs, differentialFixtures: 100 }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
