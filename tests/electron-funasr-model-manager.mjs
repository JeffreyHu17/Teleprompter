import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    TELEPROMPTER_FUNASR_MOCK: join(process.cwd(), 'tests/fixtures/mock-funasr.mjs'),
    TELEPROMPTER_DISABLE_PERSISTENCE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
});

try {
  const controller = await app.firstWindow();
  await controller.locator('.control-app').waitFor({ state: 'visible' });
  await controller.locator('.settings-group').filter({ hasText: 'AI 识别引擎' }).locator('summary').click();
  await controller.getByRole('button', { name: 'FunASR 本地', exact: true }).click();
  await controller.getByRole('button', { name: '管理模型', exact: true }).click();
  const manager = controller.getByRole('dialog', { name: '模型管理' });
  await manager.waitFor({ state: 'visible' });
  assert.equal(await manager.locator('.model-row').count(), 2);
  assert.deepEqual(
    (await manager.locator('.model-row h3').allTextContents()).map((text) =>
      text.replace(/\s+/g, ' ').trim(),
    ),
    ['Paraformer Streaming INT8', 'Paraformer Streaming FP32'],
  );
  assert.equal(await manager.getByText('SenseVoiceSmall', { exact: true }).count(), 0);
  assert.equal(await manager.getByRole('button', { name: '下载', exact: true }).count(), 1);
  process.stdout.write(`${JSON.stringify({ models: 2, segmentedModels: 0 }, null, 2)}\n`);
} finally {
  await app.close();
}
