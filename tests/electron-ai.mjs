import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const debugDir = join(process.cwd(), 'debug/2026-08-20');
await mkdir(debugDir, { recursive: true });
const mockSpeech = join(process.cwd(), 'tests/fixtures/mock-speech.mjs');
const mockFunAsr = join(process.cwd(), 'tests/fixtures/mock-funasr.mjs');
const app = await electron.launch({
  args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  env: { ...process.env, TELEPROMPTER_SPEECH_MOCK: mockSpeech, TELEPROMPTER_FUNASR_MOCK: mockFunAsr, TELEPROMPTER_FUNASR_STREAMING_MOCK: '这是第三段内容如果读错了可以重新朗读上一句系统应该自动跳回', TELEPROMPTER_TEST_LATE_SPEECH: '1', TELEPROMPTER_DISABLE_PERSISTENCE: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
});

async function waitForState(page, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let current;
  while (Date.now() < deadline) {
    current = await page.evaluate(async () => await window.teleprompter.getState());
    if (predicate(current)) return current;
    await page.waitForTimeout(50);
  }
  throw new Error(`state timeout: ${JSON.stringify(current)}`);
}

try {
  const controller = await app.firstWindow();
  await controller.locator('.control-app').waitFor({ state: 'visible' });
  const errors = [];
  controller.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  controller.on('pageerror', (error) => errors.push(error.message));

  const script = `欢迎使用智能提词器，我们现在开始测试自动跟随功能。

这是第二段内容，说话时画面应该稳定地向前移动，即使漏掉一两个字也没有关系。

这是第三段内容，如果读错了可以重新朗读上一句，系统应该自动跳回。

最后一段用于验证正常结束。`;
  const editor = controller.getByRole('textbox', { name: '提词稿编辑器' });
  await editor.fill(script);
  await editor.blur();
  await controller.getByRole('button', { name: '打开显示', exact: true }).click();
  await controller.waitForTimeout(400);
  const display = app.windows().find((window) => window !== controller);
  assert.ok(display);
  await display.locator('.prompter-output').waitFor({ state: 'visible' });

  await controller.locator('.settings-group').filter({ hasText: 'AI 识别引擎' }).locator('summary').click();
  await controller.getByRole('button', { name: 'AI 跟随', exact: true }).click();
  await controller.getByLabel('本地语音跟踪状态').waitFor({ state: 'visible' });
  const forward = await waitForState(controller, (current) => (
    current.anchor.paragraphIndex === 2 && current.trackerStatus === 'listening'
  ));
  assert.equal(forward.playbackMode, 'ai');
  assert.equal(forward.trackerStatus, 'listening');
  assert.equal(forward.speech.onDevice, true);
  assert.equal(forward.speech.direction, 'forward');
  assert.equal(forward.speech.inputLevel, 0.64);
  assert.equal(await controller.getByRole('meter', { name: '麦克风响度' }).getAttribute('aria-valuenow'), '64');
  assert.equal(await display.locator('.focus-band').count(), 1, 'AI mode must show the focus band');
  const focusBandHeight = await display.locator('.focus-band').evaluate((element) => Number.parseFloat(getComputedStyle(element).height));
  assert.ok(
    Math.abs(focusBandHeight - forward.typography.fontSize * forward.typography.lineHeight) < 0.05,
    `focus band height mismatch: ${focusBandHeight}`,
  );
  assert.equal(await display.locator('.current-character').count(), 1, 'AI mode must show the current speech position');

  const rewound = await waitForState(controller, (current) => (
    current.anchor.paragraphIndex === 1 && current.speech.direction === 'backward'
  ));
  assert.equal(rewound.speech.direction, 'backward');
  assert.ok((rewound.speech.matchConfidence ?? 0) > 0.7);
  assert.equal(await display.locator('.prompter-stage p.is-current').textContent(), await controller.getByTestId('program-monitor').locator('.prompter-stage p.is-current').textContent());
  await controller.screenshot({ path: join(debugDir, 'electron-ai-tracking.png') });

  await controller.getByRole('button', { name: '暂停麦克风', exact: true }).click();
  const paused = await waitForState(controller, (current) => current.trackerStatus === 'paused');
  assert.equal(paused.microphoneEnabled, false);
  assert.equal(paused.speech.message, '麦克风已暂停');
  assert.equal(paused.speech.inputLevel, 0);
  assert.equal(await controller.getByRole('meter', { name: '麦克风响度' }).getAttribute('aria-valuenow'), '0');
  assert.equal(await controller.getByRole('button', { name: '继续麦克风', exact: true }).count(), 1);

  await controller.getByRole('button', { name: '继续麦克风', exact: true }).click();
  const resumed = await waitForState(controller, (current) => current.trackerStatus === 'listening');
  assert.equal(resumed.microphoneEnabled, true);

  await controller.getByRole('button', { name: 'FunASR 本地', exact: true }).click();
  const funAsr = await waitForState(controller, (current) => (
    current.speech.engine === 'funasr'
    && current.funasr.installStatus === 'ready'
    && current.funasr.lastLatencyMs !== null
    && current.anchor.paragraphIndex === 2
  ));
  assert.equal(funAsr.funasr.resolvedBackend, 'cpu');
  assert.equal(funAsr.speech.transcript, '这是第三段内容如果读错了可以重新朗读上一句系统应该自动跳回');
  await controller.waitForTimeout(800);
  const afterLateSystemEvent = await controller.evaluate(async () => await window.teleprompter.getState());
  assert.equal(afterLateSystemEvent.speech.engine, 'funasr');
  assert.equal(afterLateSystemEvent.speech.transcript, funAsr.speech.transcript, '旧系统识别会话的延迟结果不得覆盖当前 FunASR 会话');
  assert.equal(await controller.getByRole('progressbar', { name: 'FunASR 安装进度' }).getAttribute('aria-valuenow'), '100');
  assert.equal(await controller.getByRole('option', { name: 'CUDA（Windows NVIDIA）' }).evaluate((element) => element.disabled), true);
  assert.equal(await controller.getByRole('option', { name: 'Vulkan（Windows GPU）' }).evaluate((element) => element.disabled), true);
  await controller.getByRole('button', { name: '管理模型', exact: true }).click();
  const modelManager = controller.getByRole('dialog', { name: '模型管理' });
  await modelManager.waitFor({ state: 'visible' });
  assert.equal(await modelManager.locator('.model-row').count(), 2);
  assert.equal(await modelManager.getByText('当前', { exact: true }).count(), 1);
  assert.equal(await modelManager.getByText('已安装', { exact: true }).count(), 1);
  assert.equal(await modelManager.getByRole('button', { name: '下载', exact: true }).count(), 1);
  assert.equal(await modelManager.getByRole('button', { name: /删除 Paraformer Streaming INT8/ }).count(), 0);
  await controller.screenshot({ path: join(debugDir, 'electron-funasr-model-manager.png') });
  await modelManager.getByRole('button', { name: '关闭模型管理' }).click();
  await controller.screenshot({ path: join(debugDir, 'electron-funasr.png') });

  await controller.getByRole('button', { name: '定速', exact: true }).click();
  const fixed = await waitForState(controller, (current) => current.trackerStatus === 'ready');
  assert.equal(fixed.playbackMode, 'fixed');
  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({
    forwardParagraph: forward.anchor.paragraphIndex,
    rewindParagraph: rewound.anchor.paragraphIndex,
    matchConfidence: rewound.speech.matchConfidence,
    onDevice: rewound.speech.onDevice,
    focusBandHeight,
    microphonePaused: paused.trackerStatus,
    microphoneResumed: resumed.trackerStatus,
    microphoneLevel: forward.speech.inputLevel,
    funAsrBackend: funAsr.funasr.resolvedBackend,
    funAsrLatencyMs: funAsr.funasr.lastLatencyMs,
  }, null, 2)}\n`);
} finally {
  await app.close();
}
