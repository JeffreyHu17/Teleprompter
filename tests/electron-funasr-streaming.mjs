import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import sherpaOnnx from 'sherpa-onnx-node';

const wavePath = join(process.cwd(), 'debug/2026-08-14/paraformer-official-0.wav');
const expectedText = '昨天是 monday today day is 礼拜二 the day after tomorrow 是星期三';
const app = await electron.launch({
  args: [
    '.',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
  env: {
    ...process.env,
    TELEPROMPTER_DISABLE_PERSISTENCE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
});
const wave = sherpaOnnx.readWave(wavePath);

async function waitForState(page, predicate, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let current;
  while (Date.now() < deadline) {
    current = await page.evaluate(async () => window.teleprompter.getState());
    if (predicate(current)) return current;
    await page.waitForTimeout(100);
  }
  throw new Error(`state timeout: ${JSON.stringify({ trackerStatus: current?.trackerStatus, speech: current?.speech, funasr: current?.funasr, anchor: current?.anchor })}`);
}

try {
  const controller = await app.firstWindow();
  await controller.locator('.control-app').waitFor({ state: 'visible' });
  await controller.evaluate(({ samples, sampleRate }) => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext({ sampleRate });
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const buffer = context.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(Float32Array.from(samples), 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        source.start(context.currentTime + 0.1);
        window.__teleprompterTestAudio = { context, source, destination };
        return destination.stream;
      },
    });
  }, { samples: Array.from(wave.samples), sampleRate: wave.sampleRate });
  const installed = await controller.evaluate(async () => window.teleprompter.inspectFunAsr());
  assert.equal(installed, true, 'Paraformer Streaming must be installed before the E2E test');
  await controller.getByRole('textbox', { name: '提词稿编辑器' }).fill(`${expectedText}\n\n第二段用于确认跟稿位置。`);
  await controller.getByRole('textbox', { name: '提词稿编辑器' }).blur();
  await controller.locator('.settings-group').filter({ hasText: 'AI 识别引擎' }).locator('summary').click();
  await controller.getByRole('button', { name: 'FunASR 本地', exact: true }).click();
  await controller.locator('.settings-group').filter({ hasText: '麦克风' }).locator('summary').click();
  assert.equal(await controller.getByLabel('输入麦克风').count(), 1, 'FunASR settings must expose a microphone selector');
  assert.equal(await controller.getByLabel('输入麦克风').locator('option').first().textContent(), '系统默认麦克风');
  await controller.getByRole('button', { name: 'AI 跟随', exact: true }).click();

  const transcripts = new Set();
  const deadline = Date.now() + 25_000;
  let recognized;
  let lastState;
  while (Date.now() < deadline) {
    const current = await controller.evaluate(async () => window.teleprompter.getState());
    lastState = current;
    if (current.speech.transcript) transcripts.add(current.speech.transcript);
    if (current.anchor.globalOffset >= 10 && current.funasr.lastLatencyMs !== null) {
      recognized = current;
      break;
    }
    await controller.waitForTimeout(100);
  }
  assert.ok(recognized, `Electron streaming ASR did not advance the script anchor: ${JSON.stringify({ transcripts: [...transcripts], trackerStatus: lastState?.trackerStatus, speech: lastState?.speech, funasr: lastState?.funasr, anchor: lastState?.anchor })}`);
  assert.ok(transcripts.size >= 2, `expected multiple partial transcripts, got ${JSON.stringify([...transcripts])}`);
  assert.equal(recognized.speech.onDevice, true);
  assert.equal(recognized.funasr.resolvedBackend, 'cpu');
  assert.ok(recognized.funasr.lastLatencyMs < 1_500);

  await controller.getByLabel('降噪').uncheck();
  await controller.getByLabel('手动增益数值').fill('1.5');
  const adjusted = await waitForState(controller, (state) => (
    state.microphoneProcessing.noiseSuppression === false
    && state.microphoneProcessing.inputGain === 1.5
  ));
  assert.equal(adjusted.trackerStatus, 'listening', 'microphone processing changes must not restart or stop ASR');
  await controller.screenshot({ path: join(process.cwd(), 'debug/2026-08-20/electron-microphone-adjustment.png') });

  await controller.evaluate(() => window.teleprompter.command({ type: 'setMicrophoneEnabled', enabled: false }));
  const paused = await waitForState(controller, (state) => state.trackerStatus === 'paused');
  assert.equal(paused.speech.inputLevel, 0);
  process.stdout.write(`${JSON.stringify({
    partialCount: transcripts.size,
    lastTranscript: recognized.speech.transcript,
    anchorOffset: recognized.anchor.globalOffset,
    workerLatencyMs: recognized.funasr.lastLatencyMs,
    noiseSuppression: adjusted.microphoneProcessing.noiseSuppression,
    inputGain: adjusted.microphoneProcessing.inputGain,
    paused: paused.trackerStatus,
  }, null, 2)}\n`);
} finally {
  await app.close();
}
