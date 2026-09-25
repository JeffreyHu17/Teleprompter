import { strict as assert } from 'node:assert';
import { _electron as electron } from 'playwright';

const app = await electron.launch({
  args: [
    '.',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
  env: {
    ...process.env,
    TELEPROMPTER_DISABLE_PERSISTENCE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
});

try {
  const controller = await app.firstWindow();
  await controller.locator('.control-app').waitFor({ state: 'visible' });
  const capture = await controller.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    const tracks = stream.getAudioTracks();
    const result = {
      audioTracks: tracks.length,
      readyStates: tracks.map((track) => track.readyState),
    };
    stream.getTracks().forEach((track) => track.stop());
    return result;
  });
  assert.equal(capture.audioTracks, 1, 'controller renderer must receive one microphone track');
  assert.deepEqual(capture.readyStates, ['live']);
  await controller.getByRole('button', { name: '打开显示', exact: true }).click();
  await controller.waitForTimeout(300);
  const isolation = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const control = windows.find((window) => window.webContents.getURL().includes('view=control'));
    const display = windows.find((window) => window.webContents.getURL().includes('view=display'));
    return {
      hasControl: Boolean(control),
      hasDisplay: Boolean(display),
      distinctSessions: Boolean(control && display && control.webContents.session !== display.webContents.session),
    };
  });
  assert.deepEqual(isolation, { hasControl: true, hasDisplay: true, distinctSessions: true });
  process.stdout.write(`${JSON.stringify({ ...capture, ...isolation }, null, 2)}\n`);
} finally {
  await app.close();
}
