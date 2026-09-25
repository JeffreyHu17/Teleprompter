import { spawn } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(root, 'release', 'win-unpacked');

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

async function requireFile(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

async function requireAbsent(path, message) {
  try {
    await access(path);
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await requireFile(
  join(root, 'node_modules', 'sherpa-onnx-win-x64', 'sherpa-onnx.node'),
  '缺少 Windows x64 的 sherpa-onnx runtime，请先安装可选依赖 sherpa-onnx-win-x64',
);
await run(npm, ['run', 'build:desktop'], { TELEPROMPTER_BUILD_PLATFORM: 'win32' });
const builderArguments = ['exec', '--', 'electron-builder', '--win', 'dir', '--x64', '--publish', 'never'];
if (process.platform !== 'win32') builderArguments.push('--config.win.signAndEditExecutable=false');
await run(npm, builderArguments);

const outputFiles = await readdir(outputDirectory);
const executable = outputFiles.find((file) => file.toLowerCase().endsWith('.exe'));
if (!executable) throw new Error('Windows 构建缺少主程序 .exe');
const appAsar = join(outputDirectory, 'resources', 'app.asar');
await requireFile(appAsar, 'Windows 构建缺少 app.asar');
await requireFile(
  join(outputDirectory, 'resources', 'native', 'windows', 'TeleprompterSpeech.ps1'),
  'Windows 构建缺少系统语音识别 helper',
);
await requireFile(
  join(outputDirectory, 'resources', 'app.asar.unpacked', 'node_modules', 'sherpa-onnx-win-x64', 'sherpa-onnx.node'),
  'Windows 构建缺少 sherpa-onnx-win-x64 原生模块',
);
await requireAbsent(
  join(outputDirectory, 'resources', 'app.asar.unpacked', 'node_modules', 'sherpa-onnx-darwin-arm64'),
  'Windows 构建错误包含了 macOS sherpa-onnx 原生模块',
);
const archiveEntries = await listPackage(appAsar);
for (const forbiddenRoot of ['/debug', '/docs', '/feature', '/native', '/release', '/scripts', '/src', '/tests']) {
  if (archiveEntries.some((entry) => entry === forbiddenRoot || entry.startsWith(`${forbiddenRoot}/`))) {
    throw new Error(`Windows app.asar 错误包含项目目录 ${forbiddenRoot}`);
  }
}
for (const requiredEntry of ['/dist/index.html', '/dist-electron/electron/main.js', '/dist-electron/electron/systemSpeech.js']) {
  if (!archiveEntries.includes(requiredEntry)) throw new Error(`Windows app.asar 缺少 ${requiredEntry}`);
}

process.stdout.write(`Built and verified ${join(outputDirectory, executable)}\n`);
