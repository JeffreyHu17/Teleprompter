import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const targetPlatform = process.env.TELEPROMPTER_BUILD_PLATFORM ?? process.platform;
if (targetPlatform !== 'darwin') process.exit(0);
if (process.platform !== 'darwin') throw new Error('macOS native helper must be built on macOS');
const root = process.cwd();
const nativeArch = process.env.TELEPROMPTER_NATIVE_ARCH ?? (process.arch === 'arm64' ? 'arm64' : 'x86_64');
const deploymentTarget = process.env.TELEPROMPTER_MACOS_DEPLOYMENT_TARGET ?? '12.0';
const sourceDir = join(root, 'native/macos');
const appDir = join(sourceDir, 'build/TeleprompterSpeech.app');
const contentsDir = join(appDir, 'Contents');
const macosDir = join(contentsDir, 'MacOS');
const executable = join(macosDir, 'TeleprompterSpeech');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await rm(appDir, { recursive: true, force: true });
await mkdir(macosDir, { recursive: true });
await cp(join(sourceDir, 'Info.plist'), join(contentsDir, 'Info.plist'));
await run('xcrun', [
  'swiftc',
  '-swift-version', '5',
  '-target', `${nativeArch}-apple-macosx${deploymentTarget}`,
  '-O',
  '-framework', 'Foundation',
  '-framework', 'AppKit',
  '-framework', 'AVFoundation',
  '-framework', 'Speech',
  '-Xlinker', '-sectcreate',
  '-Xlinker', '__TEXT',
  '-Xlinker', '__info_plist',
  '-Xlinker', join(sourceDir, 'Info.plist'),
  join(sourceDir, 'TeleprompterSpeech.swift'),
  '-o', executable,
]);
await run('codesign', ['--force', '--sign', '-', '--entitlements', join(sourceDir, 'TeleprompterSpeech.entitlements'), appDir]);
process.stdout.write(`Built ${appDir}\n`);
