import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (process.platform !== 'darwin') {
  throw new Error('macOS app must be built on macOS');
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? 'unknown'}`));
    });
  });
}

async function verifyLaunch(executable) {
  const child = spawn(executable, [], {
    cwd: root,
    env: { ...process.env, TELEPROMPTER_DISABLE_PERSISTENCE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-4_000);
  });

  const exited = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const earlyExit = await Promise.race([exited, delay(3_000).then(() => null)]);
  if (earlyExit) {
    const detail = 'error' in earlyExit
      ? earlyExit.error.message
      : `code=${earlyExit.code ?? 'null'}, signal=${earlyExit.signal ?? 'none'}`;
    throw new Error(`macOS app exited during launch smoke test (${detail})${diagnostics ? `\n${diagnostics}` : ''}`);
  }

  child.kill('SIGTERM');
  await Promise.race([
    exited,
    delay(3_000).then(() => {
      child.kill('SIGKILL');
    }),
  ]);
}

const app = join(root, 'release/mac-arm64/Teleprompter Studio.app');
const renderer = join(app, 'Contents/Frameworks/Teleprompter Studio Helper (Renderer).app');
const speechHelper = join(app, 'Contents/Resources/native/TeleprompterSpeech.app');

await run('npm', ['run', 'build:desktop']);
await run(
  join(root, 'node_modules/.bin/electron-builder'),
  ['--mac', 'dir', '--publish', 'never'],
  {
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  },
);

await run('codesign', [
  '--force', '--deep', '--sign', '-', '--options', 'runtime',
  '--entitlements', join(root, 'native/macos/entitlements.mac.inherit.plist'),
  renderer,
]);
await run('codesign', [
  '--force', '--deep', '--sign', '-', '--options', 'runtime',
  '--entitlements', join(root, 'native/macos/TeleprompterSpeech.entitlements'),
  speechHelper,
]);
await run('codesign', [
  '--force', '--deep', '--sign', '-', '--options', 'runtime',
  '--entitlements', join(root, 'native/macos/entitlements.mac.plist'),
  app,
]);
await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
await verifyLaunch(join(app, 'Contents/MacOS/Teleprompter Studio'));

process.stdout.write(`Built ${app}\n`);
