import { strict as assert } from 'node:assert';
import { _electron as electron } from 'playwright';

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, TELEPROMPTER_DISABLE_PERSISTENCE: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
});

try {
  const controller = await app.firstWindow();
  await controller.locator('.control-app').waitFor({ state: 'visible' });
  await controller.locator('.settings-group').filter({ hasText: 'AI 识别引擎' }).locator('summary').click();
  await controller.getByRole('button', { name: 'FunASR 本地', exact: true }).click();
  const ready = await controller.evaluate(async () => await window.teleprompter.inspectFunAsr());
  if (!ready) {
    await controller.evaluate(async () => await window.teleprompter.installFunAsr());
  }
  const state = await controller.evaluate(async () => await window.teleprompter.getState());
  assert.equal(state.funasr.installStatus, 'ready');
  assert.equal(state.funasr.installProgress, 1);
  assert.equal(state.funasr.resolvedBackend, 'cpu');
  assert.equal(state.funasr.models.length, 2);
  assert.equal(state.funasr.model, 'paraformer-streaming-int8');
  assert.equal(state.funasr.models.find((model) => model.id === 'paraformer-streaming-int8')?.status, 'installed');
  await assert.rejects(
    controller.evaluate(async () => window.teleprompter.deleteFunAsrModel('paraformer-streaming-int8')),
    /当前正在使用该模型/,
  );
  process.stdout.write(`${JSON.stringify(state.funasr, null, 2)}\n`);
} finally {
  await app.close();
}
