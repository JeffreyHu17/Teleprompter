import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const debugDir = join(process.cwd(), 'debug/2026-08-20');
await mkdir(debugDir, { recursive: true });

async function pressControllerKey(page, shortcut) {
  if (process.env.TELEPROMPTER_LOCKED_SESSION !== '1') {
    await page.keyboard.press(shortcut);
    return;
  }
  const parts = shortcut.split('+');
  const key = parts.at(-1);
  const keyMap = { Space: [' ', 'Space'], Enter: ['Enter', 'Enter'] };
  const [eventKey, code] = keyMap[key] ?? [key, key];
  await page.evaluate(({ eventKey, code, shiftKey }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: eventKey, code, shiftKey, bubbles: true }));
  }, { eventKey, code, shiftKey: parts.includes('Shift') });
}

const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    TELEPROMPTER_DISABLE_PERSISTENCE: '1',
  },
});

try {
  const controller = await app.firstWindow();
  const rendererErrors = [];
  const watchRenderer = (page, name) => {
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(`${name} console: ${message.text()}`);
    });
    page.on('pageerror', (error) => rendererErrors.push(`${name} page: ${error.message}`));
  };
  watchRenderer(controller, 'controller');
  await controller.waitForLoadState('domcontentloaded');
  assert.equal(await controller.title(), 'Teleprompter Studio');
  await controller.locator('.control-app').waitFor({ state: 'visible' });
  assert.ok((await controller.locator('body').innerText()).trim().length > 0, 'controller renderer is blank');

  const initialRevision = await controller.evaluate(async () => (await window.teleprompter.getState()).revision);
  await controller.waitForTimeout(1000);
  const idleRevision = await controller.evaluate(async () => (await window.teleprompter.getState()).revision);
  assert.ok(idleRevision - initialRevision <= 1, `idle revision storm: ${initialRevision} -> ${idleRevision}`);

  const controllerInitiallyFocused = await app.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=control'))?.isFocused() ?? false
  ));

  await controller.getByRole('button', { name: '打开显示', exact: true }).click();
  await controller.waitForTimeout(500);
  const windows = app.windows();
  assert.equal(windows.length, 2, `expected 2 windows, got ${windows.length}`);
  const display = windows.find((window) => window !== controller);
  assert.ok(display, 'display window was not created');
  watchRenderer(display, 'display');
  await display.waitForLoadState('domcontentloaded');

  await controller.waitForTimeout(300);
  const focusState = await app.evaluate(({ BrowserWindow }) => ({
    controllerFocused: BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=control'))?.isFocused(),
    focusedTitle: BrowserWindow.getFocusedWindow()?.getTitle() ?? null,
  }));
  if (process.env.TELEPROMPTER_LOCKED_SESSION !== '1' && controllerInitiallyFocused) {
    assert.equal(focusState.controllerFocused, true, `opening the display must preserve controller focus; focused=${focusState.focusedTitle}`);
  }

  const windowPlacement = await app.evaluate(({ BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows();
    const control = windows.find((window) => window.webContents.getURL().includes('view=control'));
    const output = windows.find((window) => window.webContents.getURL().includes('view=display'));
    if (!control || !output) return null;
    const controlDisplay = screen.getDisplayMatching(control.getBounds());
    const outputDisplay = screen.getDisplayMatching(output.getBounds());
    return {
      displayCount: screen.getAllDisplays().length,
      controlDisplayId: controlDisplay.id,
      outputDisplayId: outputDisplay.id,
      isFullScreen: output.isFullScreen(),
    };
  });
  assert.ok(windowPlacement, 'could not resolve controller and display placement');
  assert.equal(windowPlacement.isFullScreen, false, 'output must start windowed on every display');
  const outputUsesNativeControls = await app.evaluate(({ BrowserWindow }) => {
    const output = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=display'));
    return output ? output.isMinimizable() && output.isMaximizable() && output.isClosable() : false;
  });
  assert.equal(outputUsesNativeControls, true, 'output must expose native window controls');

  const controlDisplayId = String(windowPlacement.controlDisplayId);
  await controller.locator('.settings-group').filter({ hasText: '显示输出' }).getByLabel('目标显示器').selectOption(controlDisplayId);
  await controller.waitForTimeout(400);
  const mainScreenWindow = await app.evaluate(({ BrowserWindow }) => {
    const output = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=display'));
    if (!output) return null;
    return { fullscreen: output.isFullScreen(), movable: output.isMovable(), bounds: output.getBounds() };
  });
  assert.ok(mainScreenWindow);
  assert.equal(mainScreenWindow.fullscreen, false, 'output on the controller display must be windowed');
  assert.equal(mainScreenWindow.movable, true, 'windowed output must be movable');
  const movedBounds = await app.evaluate(({ BrowserWindow }) => {
    const output = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=display'));
    if (!output) return null;
    const current = output.getBounds();
    output.setPosition(current.x + 30, current.y + 24);
    return output.getBounds();
  });
  assert.ok(movedBounds);
  await controller.waitForTimeout(200);
  const retainedBounds = await app.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=display'))?.getBounds()
  ));
  assert.deepEqual(retainedBounds, movedBounds, 'windowed output position must be retained after moving');
  await controller.locator('.settings-group').filter({ hasText: '显示输出' }).getByLabel('目标显示器').selectOption('');
  await controller.waitForTimeout(400);

  const transform = await display.locator('.prompter-mirror-layer').evaluate((element) => getComputedStyle(element).transform);
  assert.equal(transform, 'matrix(-1, 0, 0, 1, 0, 0)');
  const monitor = controller.getByTestId('program-monitor');
  const previewSurface = monitor.locator('.preview-surface');
  const windowGuides = previewSurface.getByLabel('提词窗口边界');
  assert.equal(await windowGuides.locator('span').count(), 2, 'control preview must show two output-window guides');
  assert.equal(await previewSurface.locator('.prompter-stage p').count(), await display.locator('.prompter-stage p').count());
  assert.equal(
    await previewSurface.locator('.prompter-mirror-layer').evaluate((element) => getComputedStyle(element).transform),
    transform,
  );
  const outputViewport = await display.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const previewViewport = await previewSurface.evaluate((element) => ({
    width: Number.parseFloat(getComputedStyle(element).width),
    height: Number.parseFloat(getComputedStyle(element).height),
  }));
  assert.deepEqual(previewViewport, outputViewport, 'monitor virtual viewport must match the live output viewport');

  const typographySettings = controller.locator('.settings-group').filter({ hasText: '字体排版' });
  await typographySettings.locator('summary').click();
  await typographySettings.locator('select').selectOption({ label: '梦源黑体' });
  const dreamFontLoaded = await controller.evaluate(async () => {
    await document.fonts.load('600 56px "Dream Han Sans CN"', '梦源字体加载测试');
    return document.fonts.check('600 56px "Dream Han Sans CN"', '梦源字体加载测试');
  });
  assert.equal(dreamFontLoaded, true, 'bundled Dream Han Sans font must load in production');
  assert.ok((await display.locator('.prompter-stage').evaluate((element) => getComputedStyle(element).fontFamily)).includes('Dream Han Sans CN'));

  const resizedViewport = await app.evaluate(async ({ BrowserWindow }) => {
    const output = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=display'));
    if (!output) return null;
    const [width, height] = output.getSize();
    output.setSize(Math.max(720, width - 200), height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return output.webContents.executeJavaScript('({ width: window.innerWidth, textWidth: document.querySelector(".prompter-stage")?.offsetWidth })');
  });
  assert.ok(resizedViewport, 'output resize did not produce viewport measurements');
  await controller.waitForFunction((width) => window.teleprompter.getState().then((current) => current.layout?.viewportWidth === width), resizedViewport.width);
  const guideMeasurements = await windowGuides.evaluate((element) => ({
    viewportWidth: Number(element.getAttribute('data-viewport-width')),
    left: Number.parseFloat(getComputedStyle(element).left),
    right: Number.parseFloat(getComputedStyle(element).right),
    width: Number.parseFloat(getComputedStyle(element).width),
  }));
  assert.equal(guideMeasurements.viewportWidth, resizedViewport.width, 'guides must use the live output viewport width');
  assert.equal(guideMeasurements.left, 0, 'left guide must stay on the output window edge');
  assert.equal(guideMeasurements.right, 0, 'right guide must stay on the output window edge');
  assert.equal(guideMeasurements.width, resizedViewport.width, 'guides must span the live output window');

  await controller.getByRole('spinbutton', { name: '左右间距数值' }).fill('240');
  await controller.waitForFunction(async () => (await window.teleprompter.getState()).typography.sidePadding === 240);
  await controller.waitForTimeout(250);
  const guidesAfterPadding = await windowGuides.evaluate((element) => ({
    viewportWidth: Number(element.getAttribute('data-viewport-width')),
    left: Number.parseFloat(getComputedStyle(element).left),
    right: Number.parseFloat(getComputedStyle(element).right),
    width: Number.parseFloat(getComputedStyle(element).width),
  }));
  assert.deepEqual(guidesAfterPadding, guideMeasurements, 'text padding must not move output-window guides');

  await controller.screenshot({ path: join(debugDir, 'electron-control.png') });
  await display.screenshot({ path: join(debugDir, 'electron-display.png') });
  await controller.locator('.app-header').click();

  const beforePlay = await controller.evaluate(async () => (await window.teleprompter.getState()).isPlaying);
  const offsetBeforePlay = await controller.evaluate(async () => (await window.teleprompter.getState()).anchor.globalOffset);
  const scrollBeforePlay = await controller.evaluate(async () => (await window.teleprompter.getState()).scrollOffsetPx);
  assert.equal(await display.locator('.focus-band').count(), 0, 'fixed mode must not show the AI focus band');
  assert.equal(await display.locator('.current-character').count(), 0, 'fixed mode must not highlight characters');
  assert.equal(await display.locator('.text-width-guides').count(), 0, 'window guides must never appear in the output window');
  await pressControllerKey(controller, 'Space');
  await controller.waitForTimeout(600);
  const afterPlay = await controller.evaluate(async () => (await window.teleprompter.getState()).isPlaying);
  const offsetAfterPlay = await controller.evaluate(async () => (await window.teleprompter.getState()).anchor.globalOffset);
  const scrollAfterPlay = await controller.evaluate(async () => (await window.teleprompter.getState()).scrollOffsetPx);
  assert.equal(beforePlay, false);
  assert.equal(afterPlay, true);
  assert.equal(offsetAfterPlay, offsetBeforePlay, 'fixed scrolling must not advance by characters');
  assert.ok(scrollAfterPlay > scrollBeforePlay, `fixed scrolling did not advance: ${scrollBeforePlay} -> ${scrollAfterPlay}`);

  await pressControllerKey(controller, 'ArrowUp');
  await controller.waitForTimeout(100);
  const speed = await controller.evaluate(async () => (await window.teleprompter.getState()).scrollSpeedPxPerSecond);
  assert.equal(speed, 40);
  await pressControllerKey(controller, 'ArrowDown');
  await controller.waitForTimeout(100);
  assert.equal(await controller.evaluate(async () => (await window.teleprompter.getState()).scrollSpeedPxPerSecond), 30);

  const increaseSpeed = controller.getByRole('button', { name: '提高滚动速度', exact: true });
  await increaseSpeed.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse' });
  await controller.waitForTimeout(600);
  await increaseSpeed.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse' });
  const heldSpeed = await controller.evaluate(async () => (await window.teleprompter.getState()).scrollSpeedPxPerSecond);
  assert.ok(heldSpeed >= 90, `holding speed control did not repeat: ${heldSpeed}`);
  await controller.getByRole('spinbutton', { name: '滚动速度' }).fill('30');
  await controller.locator('.pane-heading').filter({ hasText: '稿件编辑' }).click();

  await pressControllerKey(controller, 'Space');
  await controller.waitForTimeout(100);
  const paragraphBefore = await controller.evaluate(async () => (await window.teleprompter.getState()).anchor.paragraphIndex);
  await pressControllerKey(controller, 'Shift+ArrowRight');
  await controller.waitForTimeout(100);
  const paragraphAfter = await controller.evaluate(async () => (await window.teleprompter.getState()).anchor.paragraphIndex);
  assert.equal(paragraphAfter, paragraphBefore + 1);
  await pressControllerKey(controller, 'ArrowRight');
  await controller.waitForTimeout(100);
  const pageForwardOffset = await controller.evaluate(async () => (await window.teleprompter.getState()).anchor.globalOffset);
  assert.ok(pageForwardOffset >= 0);
  await pressControllerKey(controller, 'ArrowLeft');
  await controller.waitForTimeout(100);
  const pageBackwardOffset = await controller.evaluate(async () => (await window.teleprompter.getState()).anchor.globalOffset);
  assert.ok(pageBackwardOffset <= pageForwardOffset);

  const mirrorControls = controller.locator('.settings-group').filter({ hasText: '镜像' });
  await mirrorControls.getByRole('button', { name: '正常', exact: true }).click();
  await display.waitForTimeout(100);
  assert.equal(await display.locator('.prompter-mirror-layer').evaluate((element) => getComputedStyle(element).transform), 'matrix(1, 0, 0, 1, 0, 0)');
  await mirrorControls.getByRole('button', { name: '水平', exact: true }).click();
  await display.waitForTimeout(100);
  assert.equal(await display.locator('.prompter-mirror-layer').evaluate((element) => getComputedStyle(element).transform), 'matrix(-1, 0, 0, 1, 0, 0)');

  for (const mode of ['垂直', '双轴']) {
    await mirrorControls.getByRole('button', { name: mode, exact: true }).click();
    await display.waitForTimeout(100);
    const visibleParagraphs = await display.locator('.prompter-stage p').evaluateAll((elements) => elements.filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < window.innerHeight && bounds.right > 0 && bounds.left < window.innerWidth;
    }).length);
    assert.ok(visibleParagraphs > 0, `${mode} mirror must keep text visible`);
  }
  await mirrorControls.getByRole('button', { name: '水平', exact: true }).click();

  const previewMirrorButton = controller.getByRole('button', { name: '镜像查看', exact: true });
  const displayTransformBeforePreviewMirror = await display.locator('.prompter-mirror-layer').evaluate((element) => getComputedStyle(element).transform);
  await previewMirrorButton.click();
  await controller.waitForTimeout(100);
  assert.equal(await previewMirrorButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await previewSurface.locator('.prompter-mirror-layer').evaluate((element) => getComputedStyle(element).transform), 'matrix(1, 0, 0, 1, 0, 0)');
  assert.equal(
    await display.locator('.prompter-mirror-layer').evaluate((element) => getComputedStyle(element).transform),
    displayTransformBeforePreviewMirror,
    'preview-only mirroring must not change output content',
  );
  await previewMirrorButton.click();

  const layoutBeforeTypographyChange = await controller.evaluate(async () => (await window.teleprompter.getState()).layout);
  assert.ok(layoutBeforeTypographyChange, 'layout must be available before typography changes');
  const fontSizeControl = controller.getByRole('spinbutton', { name: '字号数值' });
  await fontSizeControl.fill('72');
  await controller.waitForFunction(async (previousHeight) => {
    const layout = (await window.teleprompter.getState()).layout;
    return Boolean(layout && layout.documentHeight !== previousHeight);
  }, layoutBeforeTypographyChange.documentHeight);
  assert.equal(await display.locator('.prompter-stage').evaluate((element) => getComputedStyle(element).fontSize), '72px');

  const settingsSections = controller.locator('.settings-pane details.settings-section');
  assert.equal(await settingsSections.count(), 5, 'all settings must be grouped into five collapsible sections');
  const microphoneSettings = controller.locator('.settings-group').filter({ hasText: '麦克风' });
  await microphoneSettings.locator('summary').click();
  await microphoneSettings.getByRole('checkbox', { name: '系统语音处理' }).waitFor({ state: 'visible' });
  assert.equal(await microphoneSettings.getByLabel('输入麦克风').isDisabled(), true, 'system speech must clearly use the system default microphone');

  await controller.evaluate(async () => {
    const current = await window.teleprompter.getState();
    const paragraph = current.document.paragraphs.at(-1);
    if (!paragraph) throw new Error('missing paragraph');
    window.teleprompter.command({
      type: 'seek',
      anchor: {
        paragraphId: paragraph.id,
        paragraphIndex: current.document.paragraphs.length - 1,
        charOffset: Math.max(0, 120 - paragraph.startOffset),
        globalOffset: 120,
      },
    });
  });
  await controller.locator('.pane-heading').filter({ hasText: '显示预览' }).click();
  await controller.evaluate(() => window.teleprompter.command({ type: 'setPlaying', playing: false }));
  await pressControllerKey(controller, 'Enter');
  await controller.waitForTimeout(100);
  const enterState = await controller.evaluate(async () => await window.teleprompter.getState());
  assert.equal(enterState.anchor.globalOffset, 120, 'Enter must not rewind the script');
  assert.equal(enterState.isPlaying, true, 'Enter must toggle playback without delay');
  await pressControllerKey(controller, 'Enter');
  await controller.waitForTimeout(250);
  const stoppedByEnter = await controller.evaluate(async () => await window.teleprompter.getState());
  assert.equal(stoppedByEnter.anchor.globalOffset, 120, 'repeated Enter must never rewind the script');
  assert.equal(stoppedByEnter.isPlaying, false, 'a second Enter must pause playback');
  const previewStageY = await previewSurface.locator('.prompter-stage').evaluate((element) => getComputedStyle(element).translate);
  const displayStageY = await display.locator('.prompter-stage').evaluate((element) => getComputedStyle(element).translate);
  assert.equal(previewStageY, displayStageY, 'monitor scroll position must match the live output');
  await controller.screenshot({ path: join(debugDir, 'electron-control-synced-preview.png') });

  const editor = controller.getByRole('textbox', { name: '提词稿编辑器' });
  await editor.fill('新的第一段。\n\n新的第二段会同步到控制预览和播放窗口。');
  await editor.blur();
  await controller.waitForFunction(async () => (await window.teleprompter.getState()).document.name === '示例稿件'
    && (await window.teleprompter.getState()).document.paragraphs.length === 2);
  await display.waitForTimeout(150);
  assert.equal(await display.locator('.prompter-stage p').count(), 2);
  assert.equal(await previewSurface.locator('.prompter-stage p').count(), 2);
  assert.equal(await display.locator('.prompter-stage p').nth(1).textContent(), '新的第二段会同步到控制预览和播放窗口。');
  assert.equal(await previewSurface.locator('.prompter-stage p').nth(1).textContent(), '新的第二段会同步到控制预览和播放窗口。');
  assert.equal(await controller.evaluate(async () => (await window.teleprompter.getState()).typography.fontSize), 72, 'editing the script must preserve typography');

  const previewWidthBeforeCollapse = await controller.locator('.preview-pane').evaluate((element) => element.getBoundingClientRect().width);
  await controller.getByRole('button', { name: '折叠稿件编辑', exact: true }).click();
  await controller.getByRole('button', { name: '折叠显示设置', exact: true }).click();
  const previewWidthAfterCollapse = await controller.locator('.preview-pane').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(previewWidthAfterCollapse > previewWidthBeforeCollapse, 'collapsing side panes must maximize preview width');
  const collapsedRails = controller.locator('.collapsed-pane-rail');
  assert.equal(await collapsedRails.count(), 2, 'collapsed panes must leave two expansion rails');
  assert.equal(await controller.locator('.preview-pane .collapsed-pane-rail').count(), 0, 'expansion rails must stay outside the preview');
  const railWidths = await collapsedRails.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  assert.ok(railWidths.every((width) => width >= 44 && width <= 48), `collapsed rail widths must remain stable: ${railWidths.join(', ')}`);
  await controller.screenshot({ path: join(debugDir, 'electron-collapsed-side-rails.png') });
  const previewHeightBeforeParagraphCollapse = await monitor.evaluate((element) => element.getBoundingClientRect().height);
  await controller.getByRole('button', { name: '折叠段落跳转', exact: true }).click();
  const previewHeightAfterParagraphCollapse = await monitor.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(previewHeightAfterParagraphCollapse > previewHeightBeforeParagraphCollapse, 'collapsing paragraphs must maximize preview height');
  await controller.getByRole('button', { name: '展开稿件编辑', exact: true }).click();
  await controller.getByRole('button', { name: '展开显示设置', exact: true }).click();
  await controller.getByRole('button', { name: '展开段落跳转', exact: true }).click();

  const revisionBeforeIdle = await controller.evaluate(async () => (await window.teleprompter.getState()).revision);
  await controller.waitForTimeout(1500);
  const revisionAfterIdle = await controller.evaluate(async () => (await window.teleprompter.getState()).revision);
  assert.ok(revisionAfterIdle - revisionBeforeIdle <= 1, `layout IPC loop detected: ${revisionBeforeIdle} -> ${revisionAfterIdle}`);
  assert.deepEqual(rendererErrors, [], rendererErrors.join('\n'));

  await controller.getByRole('button', { name: '关闭显示', exact: true }).click();
  await controller.waitForTimeout(300);
  assert.equal(app.windows().length, 1, 'closing display must leave controller running');
  assert.equal(await controller.evaluate(async () => (await window.teleprompter.getState()).displayOpen), false);

  process.stdout.write(JSON.stringify({
    windows: windows.length,
    windowPlacement,
    mirrorTransform: transform,
    scrollSpeedPxPerSecond: speed,
    fixedCharacterAdvance: offsetAfterPlay - offsetBeforePlay,
    fixedPixelAdvance: scrollAfterPlay - scrollBeforePlay,
    paragraph: paragraphAfter,
    pageRoundTrip: [pageForwardOffset, pageBackwardOffset],
    enterOffset: enterState.anchor.globalOffset,
    collapsiblePreview: true,
    syncedDocumentParagraphs: 2,
    idleRevisionDelta: revisionAfterIdle - revisionBeforeIdle,
  }, null, 2));
  process.stdout.write('\n');
} finally {
  await app.close();
}
