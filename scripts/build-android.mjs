import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const androidDirectory = join(root, 'native', 'android');

const candidates = {
  javaHome: [
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  ],
  androidHome: [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    '/opt/homebrew/share/android-commandlinetools',
    `${process.env.HOME}/Library/Android/sdk`,
  ],
  gradle: [
    process.env.GRADLE_BIN,
    '/opt/homebrew/opt/gradle@8/bin/gradle',
    '/usr/local/opt/gradle@8/bin/gradle',
    join(androidDirectory, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
  ],
};

const firstExisting = async (values) => {
  for (const value of values.filter(Boolean)) {
    if (!value.includes('/') && !value.includes('\\')) return value;
    if (await access(value).then(() => true).catch(() => false)) return value;
  }
  return null;
};

const javaHome = await firstExisting(candidates.javaHome);
const androidHome = await firstExisting(candidates.androidHome);
const gradle = await firstExisting(candidates.gradle);
if (!javaHome) throw new Error('Android 构建需要 JDK 21，请设置 JAVA_HOME');
if (!androidHome) throw new Error('Android 构建需要 Android SDK，请设置 ANDROID_HOME');
if (!gradle) throw new Error('Android 构建需要 Gradle 8 或可用的 Gradle wrapper');

const child = spawn(gradle, ['assembleDebug'], {
  cwd: androidDirectory,
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome },
  stdio: 'inherit',
});
child.once('error', (error) => { throw error; });
child.once('exit', (code) => process.exit(code ?? 1));
