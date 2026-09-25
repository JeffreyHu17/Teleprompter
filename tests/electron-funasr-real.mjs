import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const scriptText = '这是本地语音识别测试提词器应该根据朗读内容自动跟随';
const expectedTranscript = `${scriptText}。`;
const executablePath = process.env.TELEPROMPTER_PACKAGED_EXECUTABLE;
const app = await electron.launch({
  args: executablePath ? [] : ['.'],
  ...(executablePath ? { executablePath } : {}),
  env: {
    ...process.env,
    TELEPROMPTER_SPEECH_MOCK: join(process.cwd(), 'tests/fixtures/mock-speech.mjs'),
    TELEPROMPTER_FUNASR_SEGMENT: join(process.cwd(), 'tests/fixtures/funasr-smoke.wav'),
    TELEPROMPTER_DISABLE_PERSISTENCE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
});

try {
  const controller = await app.firstWindow();
  await controller.locator('.control-app').waitFor({ state: 'visible' });
  await controller.getByRole('textbox', { name: '提词稿编辑器' }).fill(`${expectedTranscript}\n\n第二段用于确认稿件匹配不会越界。`);
  await controller.getByRole('textbox', { name: '提词稿编辑器' }).blur();
  await controller.locator('.settings-group').filter({ hasText: 'AI 识别引擎' }).locator('summary').click();
  await controller.getByRole('button', { name: 'FunASR 本地', exact: true }).click();
  await controller.getByRole('button', { name: 'AI 跟随', exact: true }).click();

  const deadline = Date.now() + 15_000;
  const observed = [];
  let state;
  while (Date.now() < deadline) {
    state = await controller.evaluate(async () => window.teleprompter.getState());
    observed.push({
      engine: state.speech.engine,
      status: state.trackerStatus,
      transcript: state.speech.transcript,
      installStatus: state.funasr.installStatus,
      latencyMs: state.funasr.lastLatencyMs,
      message: state.speech.message,
    });
    if (state.speech.transcript === expectedTranscript && state.funasr.lastLatencyMs !== null) break;
    await controller.waitForTimeout(50);
  }
  if (!state || state.speech.transcript !== expectedTranscript) throw new Error(`FunASR state timeout: ${JSON.stringify(observed.slice(-20))}`);
  assert.equal(state.funasr.installStatus, 'ready');
  assert.equal(state.funasr.resolvedBackend, 'cpu');
  assert.equal(state.speech.transcript, expectedTranscript);
  assert.equal(state.anchor.paragraphIndex, 0);
  process.stdout.write(`${JSON.stringify({
    transcript: state.speech.transcript,
    backend: state.funasr.resolvedBackend,
    latencyMs: state.funasr.lastLatencyMs,
    matchConfidence: state.speech.matchConfidence,
    charOffset: state.anchor.charOffset,
  }, null, 2)}\n`);
  assert.ok(state.anchor.charOffset > 20);
  assert.ok(state.funasr.lastLatencyMs < 5_000);
} finally {
  await app.close();
}
