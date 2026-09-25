import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const debugDir = join(process.cwd(), 'debug/2026-08-13');
await mkdir(debugDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(process.env.TELEPROMPTER_MOBILE_URL ?? 'http://127.0.0.1:4173');
  await page.locator('.mobile-app').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.control-app').count(), 0);
  assert.equal(await page.locator('.mobile-stage .prompter-output').count(), 1);
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  await page.locator('.mobile-settings').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.mobile-segments button').count(), 4);
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '编辑稿件' }).click();
  const editor = page.getByRole('textbox', { name: '移动端提词稿' });
  await editor.fill('移动端第一段。\n\n移动端第二段。');
  await editor.blur();
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '下一段' }).click();
  assert.equal(await page.locator('.mobile-header span').textContent(), '2 / 2');
  await page.screenshot({ path: join(debugDir, 'android-mobile-ui.png'), fullPage: true });
} finally {
  await browser.close();
}
