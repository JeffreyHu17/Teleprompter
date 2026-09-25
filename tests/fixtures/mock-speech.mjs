import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const engine = process.argv[2] ?? 'system';
const preserveLateSystemEvent = engine === 'system' && process.env.TELEPROMPTER_TEST_LATE_SPEECH === '1';

emit({ type: 'status', status: 'listening', locale: 'zh-CN', onDevice: true });
setTimeout(() => emit({ type: 'level', level: 0.64, locale: 'zh-CN', onDevice: true }), 80);
if (engine === 'funasr') {
  const segment = join(tmpdir(), `teleprompter-funasr-mock-${process.pid}.wav`);
  if (process.env.TELEPROMPTER_FUNASR_SEGMENT) copyFileSync(process.env.TELEPROMPTER_FUNASR_SEGMENT, segment);
  else writeFileSync(segment, 'mock wave');
  setTimeout(() => emit({ type: 'segment', status: 'queued', path: segment, durationMs: 1300, locale: 'zh-CN', onDevice: true }), 180);
} else {
setTimeout(() => emit({
  type: 'transcript',
  status: 'listening',
  text: '这是第三段内容如果读错了可以重新朗读上一句系统应该自动跳回',
  isFinal: false,
  confidence: 0.94,
  locale: 'zh-CN',
  onDevice: true,
}), 300);
setTimeout(() => emit({
  type: 'transcript',
  status: 'listening',
  text: '这是第二段内容说话时画面应该稳定地向前移动',
  isFinal: false,
  confidence: 0.91,
  locale: 'zh-CN',
  onDevice: true,
}), 900);
setTimeout(() => emit({
  type: 'transcript',
  status: 'listening',
  text: '这是第二段内容说话时画面应该稳定地向前移动',
  isFinal: true,
  confidence: 0.93,
  locale: 'zh-CN',
  onDevice: true,
}), 1250);
if (preserveLateSystemEvent) {
  setTimeout(() => emit({
    type: 'transcript',
    status: 'listening',
    text: '旧引擎延迟结果不应出现',
    isFinal: true,
    confidence: 0.99,
    locale: 'zh-CN',
    onDevice: true,
  }), 1700);
  setTimeout(() => process.exit(0), 2600);
}
}

process.on('SIGTERM', () => {
  if (!preserveLateSystemEvent) process.exit(0);
});
setInterval(() => {}, 1000);
