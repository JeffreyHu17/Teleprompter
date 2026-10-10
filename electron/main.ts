import { app, BrowserWindow, dialog, ipcMain, screen, session, shell, systemPreferences, type OpenDialogOptions } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { access, chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { get as httpsGet } from 'node:https';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { manualPositionCommand, speechFollowActive, transcriptCommands } from '../src/core/speechFollow.js';
import { BidirectionalScriptTracker } from '../src/core/scriptTracker.js';
import { anchorAt, initialSessionState, sessionReducer } from '../src/core/session.js';
import type { DisplayInfo, FunAsrBackend, FunAsrModelId, FunAsrModelState, ImportResult, SessionCommand, SessionState } from '../src/types/session.js';
import { allowAudioMediaCheck, allowAudioMediaRequest, requestMicrophoneAccess } from './mediaAccess.js';
import { createSystemSpeechCommand } from './systemSpeech.js';
import { importScriptViaDialog } from './services/fileImporter.js';
import { schedulePersistState as persistSessionState, restorePersistedState as loadPersistedState } from './services/persistenceService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const CONTROLLER_SESSION_PARTITION = 'persist:teleprompter-controller';
const rendererPath = join(__dirname, '../../dist/index.html');
const preloadPath = join(__dirname, 'preload.js');

let controllerWindow: BrowserWindow | null = null;
let displayWindow: BrowserWindow | null = null;
let state: SessionState = initialSessionState();
let lastTick = Date.now();
let ticker: NodeJS.Timeout | null = null;
let speechProcess: ChildProcess | null = null;
let speechStopRequested = false;
let speechStartGeneration = 0;
let speechStopFile: string | null = null;
let speechEventPoller: NodeJS.Timeout | null = null;
let systemSpeechRestartTimer: NodeJS.Timeout | null = null;
let persistTimer: NodeJS.Timeout | null = null;
let userPositionedDisplay = false;
let programmaticDisplayMove = false;
let funAsrInstallPromise: Promise<void> | null = null;
let funAsrQueue: Array<{ path: string; durationMs: number }> = [];
let funAsrProcessing = false;
let funAsrGeneration = 0;
let activeFunAsrProcess: ChildProcess | null = null;
let funAsrWorker: Worker | null = null;
let funAsrPendingChunks = 0;
let microphoneAccessPromise: Promise<boolean> | null = null;
let speechSessionGeneration = 0;
const scriptTracker = new BidirectionalScriptTracker();

interface NativeSpeechEvent {
  type: 'capability' | 'status' | 'transcript' | 'segment' | 'level' | 'warning' | 'error';
  status?: string;
  message?: string;
  locale?: string;
  onDevice?: boolean;
  text?: string;
  isFinal?: boolean;
  confidence?: number;
  level?: number;
  path?: string;
  durationMs?: number;
}

const FUNASR_VAD_SHA256 = '1270f2559c495f4e7b6e739541151027d360761a3fda43fc147034f5719f5479';
const FUNASR_RELEASE = 'runtime-llamacpp-v0.2.0';
const FUNASR_MACOS_BINARY_SHA256 = 'a3ebb5ddf1c03a09c274f43d7f3b0d9908953f197b483d0b969c03e32ca2b361';

interface FunAsrModelDefinition {
  id: FunAsrModelId;
  name: string;
  variant: string;
  description: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  version: string;
  mode: 'streaming' | 'segmented';
  artifacts?: Array<{
    filename: string;
    sha256: string;
    sizeBytes: number;
  }>;
}

interface FunAsrManifestModel {
  version: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  files?: Record<string, { sha256: string; sizeBytes: number }>;
}

interface FunAsrManifest {
  release: string;
  backend: string;
  models: Partial<Record<FunAsrModelId, FunAsrManifestModel>>;
}

const DEFAULT_FUNASR_MODELS: Record<FunAsrModelId, FunAsrModelDefinition> = {
  'paraformer-streaming-int8': {
    id: 'paraformer-streaming-int8',
    name: 'Paraformer Streaming',
    variant: 'INT8',
    description: '实时跟稿默认，约 480-600ms 增量更新',
    filename: 'paraformer-streaming-int8',
    sha256: '8e40c43232a1c5c66c82111efc5820d3accca11b',
    sizeBytes: 237_202_501,
    version: '8e40c432',
    mode: 'streaming',
    artifacts: [
      { filename: 'encoder.int8.onnx', sha256: '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a', sizeBytes: 165_462_184 },
      { filename: 'decoder.int8.onnx', sha256: 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f', sizeBytes: 71_664_561 },
      { filename: 'tokens.txt', sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6', sizeBytes: 75_756 },
    ],
  },
  'paraformer-streaming-fp32': {
    id: 'paraformer-streaming-fp32',
    name: 'Paraformer Streaming',
    variant: 'FP32',
    description: '未量化精度版，约 825 MiB，内存占用高',
    filename: 'paraformer-streaming-fp32',
    sha256: '8e40c43232a1c5c66c82111efc5820d3accca11b',
    sizeBytes: 864_888_677,
    version: '8e40c432',
    mode: 'streaming',
    artifacts: [
      { filename: 'encoder.onnx', sha256: '832c8e8d3f758f4ab0fcfc011eec91154ecd129b7305564a7b461b20064ebcc6', sizeBytes: 636_348_877 },
      { filename: 'decoder.onnx', sha256: 'e178f5a7dd4efbf5905a797807006d773b12116eb39fed3d16758e68f9f50921', sizeBytes: 228_464_044 },
      { filename: 'tokens.txt', sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6', sizeBytes: 75_756 },
    ],
  },
};

function loadConfiguredModels(): Record<FunAsrModelId, FunAsrModelDefinition> {
  const models = { ...DEFAULT_FUNASR_MODELS };
  try {
    const configPath = app.isPackaged
      ? join(process.resourcesPath, 'config', 'models.json')
      : join(__dirname, '../config/models.json');
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(content) as { models?: FunAsrModelDefinition[] };
      if (Array.isArray(parsed.models)) {
        for (const item of parsed.models) {
          if (item.id && (item.id === 'paraformer-streaming-int8' || item.id === 'paraformer-streaming-fp32')) {
            models[item.id] = { ...models[item.id], ...item };
          }
        }
      }
    }
  } catch (error) {
    console.warn('Unable to load external models.json config, using defaults', error);
  }
  return models;
}

const FUNASR_MODELS = loadConfiguredModels();

function huggingFaceUrls(repository: string, filename: string): string[] {
  const endpoints = [
    process.env.TELEPROMPTER_HF_ENDPOINT,
    'https://hf-mirror.com',
    'https://huggingface.co',
  ].filter((value): value is string => Boolean(value));
  return [...new Set(endpoints)].map((endpoint) => `${endpoint.replace(/\/$/, '')}/${repository}/resolve/main/${filename}`);
}

function modelsStorageRoot(engine = 'funasr'): string {
  return join(app.getPath('userData'), 'models', engine);
}

function funAsrRoot(): string {
  return modelsStorageRoot('funasr');
}

async function migrateLegacyModelStorage(): Promise<void> {
  try {
    const legacyPath = join(app.getPath('userData'), 'funasr');
    const newEnginePath = modelsStorageRoot('funasr');
    const legacyExists = await access(legacyPath).then(() => true).catch(() => false);
    const newExists = await access(newEnginePath).then(() => true).catch(() => false);
    if (legacyExists && !newExists) {
      await mkdir(join(app.getPath('userData'), 'models'), { recursive: true });
      await rename(legacyPath, newEnginePath);
    }
  } catch (error) {
    console.warn('Failed to migrate legacy model storage:', error);
  }
}

async function cleanupLegacySegmentedFunAsr(): Promise<void> {
  const root = funAsrRoot();
  const legacyPaths = [
    join(root, 'models', 'sensevoice-small-q8.gguf'),
    join(root, 'models', 'sensevoice-small-q8.gguf.download'),
    join(root, 'models', 'sensevoice-small-f16.gguf'),
    join(root, 'models', 'sensevoice-small-f16.gguf.download'),
    join(root, 'models', 'fsmn-vad.gguf'),
    join(root, 'runtime'),
  ];
  await Promise.all(legacyPaths.map((path) => rm(path, { recursive: true, force: true })));
  const manifest = await readFunAsrManifest();
  const models = manifest.models as Record<string, FunAsrManifestModel | undefined>;
  const hadLegacyManifest = Boolean(models['sensevoice-small-q8'] || models['sensevoice-small-f16']);
  delete models['sensevoice-small-q8'];
  delete models['sensevoice-small-f16'];
  if (hadLegacyManifest) await writeFunAsrManifest(manifest);
}

function funAsrModelPath(modelId = state.funasr.model): string {
  return join(funAsrRoot(), 'models', FUNASR_MODELS[modelId].filename);
}

function funAsrArtifactPath(modelId: FunAsrModelId, filename: string): string {
  return join(funAsrModelPath(modelId), filename);
}

function funAsrVadPath(): string {
  return join(funAsrRoot(), 'models', 'fsmn-vad.gguf');
}

function funAsrManifestPath(): string {
  return join(funAsrRoot(), 'manifest.json');
}

async function readFunAsrManifest(): Promise<FunAsrManifest> {
  try {
    const parsed = JSON.parse(await readFile(funAsrManifestPath(), 'utf8')) as Partial<FunAsrManifest> & { model?: FunAsrModelId };
    return {
      release: parsed.release ?? FUNASR_RELEASE,
      backend: parsed.backend ?? resolvedFunAsrBackend(),
      models: parsed.models ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return { release: FUNASR_RELEASE, backend: resolvedFunAsrBackend(), models: {} };
  }
}

async function writeFunAsrManifest(manifest: FunAsrManifest): Promise<void> {
  await mkdir(funAsrRoot(), { recursive: true });
  await writeFile(funAsrManifestPath(), JSON.stringify(manifest, null, 2), 'utf8');
}

function patchFunAsrModel(modelId: FunAsrModelId, patch: Partial<FunAsrModelState>): void {
  dispatch({
    type: 'setFunAsrState',
    patch: { models: state.funasr.models.map((model) => model.id === modelId ? { ...model, ...patch } : model) },
  });
}

function bundledFunAsrRuntimePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native', 'funasr', 'macos-arm64')
    : join(app.getAppPath(), 'native', 'funasr', 'macos-arm64');
}

function resolvedFunAsrBackend(requested = state.funasr.backend): Exclude<FunAsrBackend, 'auto'> {
  if (process.platform === 'darwin') return 'cpu';
  if (requested !== 'auto') return requested;
  if (process.platform === 'win32') {
    try {
      accessSync('C:\\Windows\\System32\\vulkan-1.dll');
      return 'vulkan';
    } catch {
      return 'cpu';
    }
  }
  return 'cpu';
}

function funAsrRuntimeAsset(backend: Exclude<FunAsrBackend, 'auto'>): { name: string; sha256: string } {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { name: 'funasr-llamacpp-macos-arm64.tar.gz', sha256: '416cbb289e31cb7575365d382155074e922fd061807a37b9ca0247dabd9bc6f9' };
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    if (backend === 'cuda') return { name: 'funasr-llamacpp-windows-x64-cuda.zip', sha256: '7f2f9ef4d7e0291b284a295ec74bbeca9ea635a7f5f42d0ad06eb780c0d6efc1' };
    if (backend === 'vulkan') return { name: 'funasr-llamacpp-windows-x64-vulkan.zip', sha256: '90b45240c6ccc9177c25490a11848de60a406e129391c8736b14521c0c28cdcb' };
    return { name: 'funasr-llamacpp-windows-x64.zip', sha256: '297c962346d7e30d7a7c2c860dfaab3ff07d01fddf15e6fc5212ca9545441a51' };
  }
  throw new Error(`当前 FunASR GGUF 版本不支持 ${process.platform}/${process.arch}`);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  await once(stream, 'end');
  return hash.digest('hex');
}

async function downloadVerified(urls: string[], destination: string, expectedHash: string, progress: (received: number, total: number) => void): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.download`;
  if (await access(partial).then(() => true).catch(() => false) && await sha256(partial) === expectedHash) {
    await rm(destination, { force: true });
    await rename(partial, destination);
    return;
  }
  let lastError: unknown;
  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await downloadHttps(url, partial, progress);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    if (!lastError) break;
  }
  if (lastError) throw lastError;
  const actualHash = await sha256(partial);
  if (actualHash !== expectedHash) {
    await rm(partial, { force: true });
    throw new Error(`SHA-256 校验失败：${actualHash}`);
  }
  await rm(destination, { force: true });
  await rename(partial, destination);
}

async function downloadHttps(url: string, destination: string, progress: (received: number, total: number) => void, redirects = 0): Promise<void> {
  if (redirects > 8) return Promise.reject(new Error('下载重定向次数过多'));
  const existing = await stat(destination).then((value) => value.size).catch(() => 0);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'User-Agent': 'Teleprompter-Studio/0.1' };
    if (existing > 0) headers.Range = `bytes=${existing}-`;
    const request = httpsGet(url, { headers }, (response) => {
      const location = response.headers.location;
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        void downloadHttps(new URL(location, url).toString(), destination, progress, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        response.resume();
        reject(new Error(`下载失败：HTTP ${response.statusCode ?? 'unknown'}`));
        return;
      }
      const resumed = response.statusCode === 206 && existing > 0;
      const offset = resumed ? existing : 0;
      const total = offset + Number(response.headers['content-length'] ?? 0);
      let received = offset;
      const output = createWriteStream(destination, { flags: resumed ? 'a' : 'w' });
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        progress(received, total);
      });
      response.once('error', (error) => output.destroy(error));
      output.once('error', reject);
      output.once('finish', resolve);
      response.pipe(output);
    });
    request.setTimeout(30_000, () => request.destroy(new Error('下载连接超时')));
    request.once('error', reject);
  });
}

function runProcess(command: string, args: string[], trackInference = false): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (trackInference) activeFunAsrProcess = child;
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      if (activeFunAsrProcess === child) activeFunAsrProcess = null;
      reject(error);
    });
    child.once('exit', (code) => {
      if (activeFunAsrProcess === child) activeFunAsrProcess = null;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} 退出码 ${code}`));
    });
  });
}

async function findFunAsrBinary(): Promise<string> {
  if (process.env.TELEPROMPTER_FUNASR_MOCK) return process.env.TELEPROMPTER_FUNASR_MOCK;
  const runtime = join(funAsrRoot(), 'runtime');
  const files = await readdir(runtime, { recursive: true });
  const expected = process.platform === 'win32' ? 'llama-funasr-sensevoice.exe' : 'llama-funasr-sensevoice';
  const relative = files.find((file) => file.split(/[\\/]/).pop() === expected);
  if (!relative) throw new Error('FunASR runtime 中缺少 SenseVoice 可执行文件');
  return join(runtime, relative);
}

async function inspectModelFiles(definition: FunAsrModelDefinition): Promise<{ valid: boolean; present: boolean }> {
  if (definition.mode === 'streaming') {
    let present = false;
    for (const artifact of definition.artifacts ?? []) {
      const path = funAsrArtifactPath(definition.id, artifact.filename);
      const file = await stat(path).catch(() => null);
      if (!file) return { valid: false, present };
      present = true;
      if (file.size !== artifact.sizeBytes || await sha256(path) !== artifact.sha256) return { valid: false, present: true };
    }
    return { valid: true, present };
  }
  const path = funAsrModelPath(definition.id);
  const file = await stat(path).catch(() => null);
  if (!file) return { valid: false, present: false };
  return { valid: file.size === definition.sizeBytes && await sha256(path) === definition.sha256, present: true };
}

async function inspectFunAsrInstallation(): Promise<boolean> {
  dispatch({ type: 'setFunAsrState', patch: { installStatus: 'checking', message: '正在检查本地文件' } });
  if (process.env.TELEPROMPTER_FUNASR_MOCK) {
    dispatch({
      type: 'setFunAsrState',
      patch: {
        installStatus: 'ready',
        installProgress: 1,
        resolvedBackend: 'cpu',
        message: `${FUNASR_MODELS[state.funasr.model].name} ${FUNASR_MODELS[state.funasr.model].variant} 已就绪`,
        models: state.funasr.models.map((model) => model.id === state.funasr.model
          ? { ...model, status: 'installed', progress: 1, installedVersion: model.availableVersion }
          : model),
      },
    });
    return true;
  }
  const manifest = await readFunAsrManifest();
  const models: FunAsrModelState[] = [];
  for (const definition of Object.values(FUNASR_MODELS)) {
    const manifestEntry = manifest.models[definition.id];
    let status: FunAsrModelState['status'] = 'not-installed';
    let installedVersion: string | null = null;
    let message: string | null = null;
    const files = await inspectModelFiles(definition);
    if (files.present) {
      if (manifestEntry && manifestEntry.version !== definition.version) {
        status = 'update-available';
        installedVersion = manifestEntry.version;
        message = '发现新版本';
      } else if (!files.valid) {
        status = 'error';
        message = '模型文件不完整或校验失败，请重新下载';
      } else {
        installedVersion = definition.version;
        status = 'installed';
      }
    }
    models.push({
      id: definition.id,
      name: definition.name,
      variant: definition.variant,
      description: definition.description,
      sizeBytes: definition.sizeBytes,
      status,
      progress: status === 'installed' || status === 'update-available' ? 1 : 0,
      installedVersion,
      availableVersion: definition.version,
      message,
    });
  }
  dispatch({ type: 'setFunAsrState', patch: { models } });
  const selected = models.find((model) => model.id === state.funasr.model);
  try {
    if (!selected || (selected.status !== 'installed' && selected.status !== 'update-available')) throw new Error('当前模型未安装');
    const definition = FUNASR_MODELS[state.funasr.model];
    const backend = definition.mode === 'streaming' ? 'cpu' : resolvedFunAsrBackend();
    if (definition.mode === 'segmented') {
      const vadStat = await stat(funAsrVadPath());
      if (vadStat.size !== 1_720_512 || await sha256(funAsrVadPath()) !== FUNASR_VAD_SHA256) throw new Error('VAD 文件不正确');
      await findFunAsrBinary();
      if (manifest.release !== FUNASR_RELEASE || manifest.backend !== backend) throw new Error('运行时后端已变更');
    }
    dispatch({ type: 'setFunAsrState', patch: { installStatus: 'ready', installProgress: 1, resolvedBackend: backend, message: `${selected.name} ${selected.variant} 已就绪` } });
    return true;
  } catch {
    dispatch({ type: 'setFunAsrState', patch: { installStatus: 'not-installed', installProgress: 0, resolvedBackend: null, message: `需要安装 ${FUNASR_MODELS[state.funasr.model].name} ${FUNASR_MODELS[state.funasr.model].variant}` } });
    return false;
  }
}

async function extractRuntime(archive: string): Promise<void> {
  const runtime = join(funAsrRoot(), 'runtime');
  await rm(runtime, { recursive: true, force: true });
  await mkdir(runtime, { recursive: true });
  if (archive.endsWith('.zip')) {
    const escapedArchive = archive.replaceAll("'", "''");
    const escapedRuntime = runtime.replaceAll("'", "''");
    await runProcess('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedRuntime}' -Force`]);
  } else {
    await runProcess('/usr/bin/tar', ['-xzf', archive, '-C', runtime]);
  }
  const binary = await findFunAsrBinary();
  if (process.platform !== 'win32') await chmod(binary, 0o755);
}

async function installBundledMacFunAsrRuntime(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('内置 runtime 仅支持 macOS ARM64');
  const source = join(bundledFunAsrRuntimePath(), 'llama-funasr-sensevoice');
  if (await sha256(source) !== FUNASR_MACOS_BINARY_SHA256) throw new Error('内置 FunASR runtime 校验失败');
  const runtime = join(funAsrRoot(), 'runtime');
  const destination = join(runtime, 'llama-funasr-sensevoice');
  await rm(runtime, { recursive: true, force: true });
  await mkdir(runtime, { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
}

async function installFunAsr(modelId = state.funasr.model, force = false): Promise<void> {
  if (funAsrInstallPromise) return funAsrInstallPromise;
  funAsrInstallPromise = (async () => {
    const model = FUNASR_MODELS[modelId];
    const backend = model.mode === 'streaming' ? 'cpu' : resolvedFunAsrBackend();
    const root = funAsrRoot();
    const bundledRuntime = model.mode === 'segmented' && process.platform === 'darwin' && process.arch === 'arm64';
    const asset = model.mode === 'segmented' && !bundledRuntime ? funAsrRuntimeAsset(backend) : null;
    const archive = asset ? join(root, asset.name) : null;
    const downloads: Array<{ urls: string[]; path: string; sha256: string; weight: number; modelFile: boolean }> = model.mode === 'streaming'
      ? (model.artifacts ?? []).map((artifact) => ({
          urls: huggingFaceUrls('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', artifact.filename),
          path: funAsrArtifactPath(modelId, artifact.filename),
          sha256: artifact.sha256,
          weight: artifact.sizeBytes / model.sizeBytes,
          modelFile: true,
        }))
      : [
          ...(asset && archive ? [{ urls: [`https://github.com/modelscope/FunASR/releases/download/${FUNASR_RELEASE}/${asset.name}`], path: archive, sha256: asset.sha256, weight: 0.03, modelFile: false }] : []),
          { urls: huggingFaceUrls('FunAudioLLM/SenseVoiceSmall-GGUF', model.filename), path: funAsrModelPath(modelId), sha256: model.sha256, weight: bundledRuntime ? 0.99 : 0.96, modelFile: true },
          { urls: huggingFaceUrls('FunAudioLLM/fsmn-vad-GGUF', 'fsmn-vad.gguf'), path: funAsrVadPath(), sha256: FUNASR_VAD_SHA256, weight: 0.01, modelFile: false },
        ];
    let completed = 0;
    dispatch({ type: 'setFunAsrState', patch: { installStatus: 'installing', installProgress: 0, resolvedBackend: backend, message: model.mode === 'streaming' ? '正在准备流式 Paraformer' : bundledRuntime ? '正在校验内置 FunASR runtime' : '正在准备 FunASR runtime' } });
    patchFunAsrModel(modelId, { status: 'checking', progress: 0, message: '正在准备下载' });
    try {
      if (bundledRuntime) await installBundledMacFunAsrRuntime();
      dispatch({ type: 'setFunAsrState', patch: { installStatus: 'downloading', message: `正在下载 ${model.name} ${model.variant}` } });
      patchFunAsrModel(modelId, { status: 'downloading', progress: 0, message: '正在下载' });
      for (const item of downloads) {
        const exists = await access(item.path).then(() => true).catch(() => false);
        if (force && item.modelFile) {
          await rm(item.path, { force: true });
          await rm(`${item.path}.download`, { force: true });
        }
        if (!exists || force && item.modelFile || await sha256(item.path) !== item.sha256) {
          await downloadVerified(item.urls, item.path, item.sha256, (received, total) => {
            const fraction = total > 0 ? received / total : 0;
            const progress = Math.min(0.99, completed + item.weight * fraction);
            dispatch({ type: 'setFunAsrState', patch: { installProgress: progress } });
            if (item.modelFile) patchFunAsrModel(modelId, { status: 'downloading', progress, message: '正在下载' });
          });
        }
        completed += item.weight;
        dispatch({ type: 'setFunAsrState', patch: { installProgress: completed } });
      }
      if (archive) {
        dispatch({ type: 'setFunAsrState', patch: { installStatus: 'installing', message: '正在安装本地 runtime' } });
        await extractRuntime(archive);
      }
      const manifest = await readFunAsrManifest();
      manifest.release = FUNASR_RELEASE;
      manifest.backend = backend;
      manifest.models[modelId] = {
        version: model.version,
        sha256: model.sha256,
        sizeBytes: model.sizeBytes,
        filename: model.filename,
        files: Object.fromEntries((model.artifacts ?? []).map((artifact) => [artifact.filename, { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes }])),
      };
      await writeFunAsrManifest(manifest);
      if (archive) await rm(archive, { force: true });
      patchFunAsrModel(modelId, { status: 'installed', progress: 1, installedVersion: model.version, message: null });
      await inspectFunAsrInstallation();
      if (state.funasr.model === modelId) {
        if (state.playbackMode === 'ai' && state.microphoneEnabled && state.speech.engine === 'funasr') void startSpeechRecognition();
      }
    } catch (error) {
      patchFunAsrModel(modelId, { status: 'error', message: `下载失败：${error instanceof Error ? error.message : String(error)}` });
      dispatch({ type: 'setFunAsrState', patch: { installStatus: 'error', message: `安装失败：${error instanceof Error ? error.message : String(error)}` } });
      throw error;
    } finally {
      funAsrInstallPromise = null;
    }
  })();
  return funAsrInstallPromise;
}

async function deleteFunAsrModel(modelId: FunAsrModelId): Promise<void> {
  if (modelId === state.funasr.model) throw new Error('当前正在使用该模型，请先切换到其他模型');
  if (funAsrInstallPromise) throw new Error('模型下载进行中，暂时不能删除');
  const model = FUNASR_MODELS[modelId];
  await rm(funAsrModelPath(modelId), { recursive: model.mode === 'streaming', force: true });
  if (model.mode === 'segmented') await rm(`${funAsrModelPath(modelId)}.download`, { force: true });
  const manifest = await readFunAsrManifest();
  delete manifest.models[modelId];
  await writeFunAsrManifest(manifest);
  patchFunAsrModel(modelId, { status: 'not-installed', progress: 0, installedVersion: null, message: null });
}

function cleanFunAsrTranscript(output: string): string {
  return output
    .replace(/<\|[^|]+\|>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^\[.*\]$/.test(line))
    .join('')
    .trim();
}

async function processFunAsrQueue(generation: number): Promise<void> {
  if (funAsrProcessing) return;
  funAsrProcessing = true;
  try {
    while (funAsrQueue.length && generation === funAsrGeneration) {
      const segment = funAsrQueue.shift();
      if (!segment) break;
      dispatch({ type: 'setFunAsrState', patch: { queuedSegments: funAsrQueue.length + 1, message: '正在本地识别' } });
      const startedAt = Date.now();
      try {
        const backend = state.funasr.resolvedBackend ?? resolvedFunAsrBackend();
        const binary = await findFunAsrBinary();
        const baseArgs = ['-m', funAsrModelPath(), '--vad', funAsrVadPath(), '-a', segment.path];
        let result = process.env.TELEPROMPTER_FUNASR_MOCK
          ? await runProcess(process.env.npm_node_execpath ?? 'node', [binary, ...baseArgs, '--backend', backend], true)
          : await runProcess(binary, [...baseArgs, '--backend', backend], true).catch(async (error) => {
              if (process.platform !== 'win32' || backend === 'cpu') throw error;
              dispatch({ type: 'setFunAsrState', patch: { resolvedBackend: 'cpu', message: `${backend.toUpperCase()} 推理失败，已回退 CPU` } });
              return runProcess(binary, [...baseArgs, '--backend', 'cpu'], true);
            });
        if (generation !== funAsrGeneration) break;
        const transcript = cleanFunAsrTranscript(result.stdout);
        dispatch({ type: 'setFunAsrState', patch: { lastLatencyMs: Date.now() - startedAt, queuedSegments: funAsrQueue.length, message: transcript ? '本地识别完成' : '未识别到有效语音' } });
        if (transcript) handleSpeechEvent({ type: 'transcript', status: 'listening', text: transcript, isFinal: true, onDevice: true, locale: state.speech.locale });
      } catch (error) {
        if (generation === funAsrGeneration) dispatch({ type: 'setFunAsrState', patch: { queuedSegments: funAsrQueue.length, message: `识别失败：${error instanceof Error ? error.message : String(error)}` } });
      } finally {
        await rm(segment.path, { force: true });
      }
    }
  } finally {
    funAsrProcessing = false;
    if (generation === funAsrGeneration) dispatch({ type: 'setFunAsrState', patch: { queuedSegments: funAsrQueue.length } });
    if (funAsrQueue.length) void processFunAsrQueue(funAsrGeneration);
  }
}

function enqueueFunAsrSegment(path: string, durationMs: number): void {
  funAsrQueue.push({ path, durationMs });
  dispatch({ type: 'setFunAsrState', patch: { queuedSegments: funAsrQueue.length, message: '音频片段已进入识别队列' } });
  void processFunAsrQueue(funAsrGeneration);
}

function streamingModelPaths(modelId = state.funasr.model): { encoder: string; decoder: string; tokens: string } {
  const definition = FUNASR_MODELS[modelId];
  if (definition.mode !== 'streaming') throw new Error('当前模型不是流式 Paraformer');
  const encoder = definition.artifacts?.find((artifact) => artifact.filename.startsWith('encoder.'))?.filename;
  const decoder = definition.artifacts?.find((artifact) => artifact.filename.startsWith('decoder.'))?.filename;
  const tokens = definition.artifacts?.find((artifact) => artifact.filename === 'tokens.txt')?.filename;
  if (!encoder || !decoder || !tokens) throw new Error('流式 Paraformer 模型定义不完整');
  return {
    encoder: funAsrArtifactPath(modelId, encoder),
    decoder: funAsrArtifactPath(modelId, decoder),
    tokens: funAsrArtifactPath(modelId, tokens),
  };
}

function stopFunAsrWorker(): void {
  const worker = funAsrWorker;
  funAsrWorker = null;
  funAsrPendingChunks = 0;
  if (worker) void worker.terminate();
}

async function startFunAsrWorker(): Promise<void> {
  if (funAsrWorker) return;
  const streamingMock = process.env.TELEPROMPTER_FUNASR_STREAMING_MOCK;
  const worker = new Worker(new URL(streamingMock ? './funasrWorkerMock.js' : './funasrWorker.js', import.meta.url), {
    workerData: {
      ...streamingModelPaths(),
      numThreads: Math.max(2, Math.min(4, availableParallelism() - 1)),
      transcript: streamingMock,
    },
  });
  funAsrWorker = worker;
  funAsrPendingChunks = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('流式 Paraformer 加载超时'));
    }, 30_000);
    worker.on('message', (message: { type: string; text?: string; isFinal?: boolean; latencyMs?: number }) => {
      if (worker !== funAsrWorker) return;
      if (message.type === 'ready') {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
        return;
      }
      if (message.type === 'consumed') {
        funAsrPendingChunks = Math.max(0, funAsrPendingChunks - 1);
        if (funAsrPendingChunks === 0 && state.funasr.queuedSegments !== 0) {
          dispatch({ type: 'setFunAsrState', patch: { queuedSegments: 0 } });
        }
        return;
      }
      if (message.type === 'transcript' && message.text) {
        dispatch({
          type: 'setFunAsrState',
          patch: {
            lastLatencyMs: message.latencyMs ?? null,
            queuedSegments: funAsrPendingChunks,
            message: message.isFinal ? '流式识别段落结束' : '流式识别中',
          },
        });
        handleSpeechEvent({
          type: 'transcript',
          status: 'listening',
          text: message.text,
          isFinal: message.isFinal ?? false,
          onDevice: true,
          locale: state.speech.locale,
        });
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
      if (worker === funAsrWorker) {
        funAsrWorker = null;
        broadcast('speech:capture', { enabled: false, mode: 'streaming', deviceId: state.speech.inputDeviceId, processing: state.microphoneProcessing });
        dispatch({ type: 'setTracker', status: 'lost', patch: { message: `流式 Paraformer 失败：${error instanceof Error ? error.message : String(error)}`, inputLevel: 0 } });
      }
    });
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      if (!settled && code !== 0) {
        settled = true;
        reject(new Error(`流式 Paraformer Worker 退出（${code}）`));
      }
      if (worker === funAsrWorker) {
        funAsrWorker = null;
        if (code !== 0 && state.playbackMode === 'ai' && state.microphoneEnabled) {
          broadcast('speech:capture', { enabled: false, mode: 'streaming', deviceId: state.speech.inputDeviceId, processing: state.microphoneProcessing });
          dispatch({ type: 'setTracker', status: 'lost', patch: { message: `流式 Paraformer Worker 退出（${code}）`, inputLevel: 0 } });
        }
      }
    });
  });
}

function submitStreamingSpeechChunk(samples: ArrayBuffer): void {
  if (state.playbackMode !== 'ai' || state.speech.engine !== 'funasr' || !state.microphoneEnabled) return;
  if (FUNASR_MODELS[state.funasr.model].mode !== 'streaming' || !funAsrWorker) return;
  if (!(samples instanceof ArrayBuffer) || samples.byteLength === 0 || samples.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0 || samples.byteLength > 16_000 * 4) {
    dispatch({ type: 'setTracker', status: 'lost', patch: { message: '流式音频块格式不正确' } });
    return;
  }
  funAsrPendingChunks += 1;
  if (funAsrPendingChunks === 8 || funAsrPendingChunks === 24) {
    dispatch({ type: 'setFunAsrState', patch: { queuedSegments: funAsrPendingChunks, message: funAsrPendingChunks >= 24 ? '识别速度低于实时音频' : '正在缓冲流式音频' } });
  }
  funAsrWorker.postMessage({ type: 'audio', samples, receivedAt: Date.now() }, [samples]);
}

function displayList(): DisplayInfo[] {
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: display.label || `显示器 ${index + 1}`,
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
    primary: display.id === screen.getPrimaryDisplay().id,
  }));
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of [controllerWindow, displayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function broadcastState(): void {
  broadcast('session:state', state);
}

function dispatch(command: SessionCommand): void {
  const next = sessionReducer(state, command);
  if (next === state) return;
  state = next;
  broadcastState();

  if (!['tick', 'reportLayout', 'setTracker', 'setDisplayOpen', 'setPlaying', 'togglePlay', 'seek', 'scrollStep', 'setFocusAdjusting'].includes(command.type)) {
    schedulePersistState();
  }

  if (command.type === 'setDisplay' && displayWindow) placeDisplayWindow();
}

function schedulePersistState(): void {
  persistSessionState(() => state);
}

async function restorePersistedState(): Promise<void> {
  const restored = await loadPersistedState();
  if (restored) state = restored;
}

async function submitRendererSpeechSegment(contents: Uint8Array, durationMs: number): Promise<void> {
  if (process.platform !== 'win32') throw new Error('渲染进程音频分段仅用于 Windows');
  if (state.playbackMode !== 'ai' || state.speech.engine !== 'funasr' || !state.microphoneEnabled) return;
  if (contents.byteLength < 44 || contents.byteLength > 16_000 * 2 * 12 + 44) throw new Error('Windows 音频分段大小不合法');
  const segmentDirectory = join(app.getPath('temp'), `teleprompter-windows-${process.pid}`);
  await mkdir(segmentDirectory, { recursive: true });
  const path = join(segmentDirectory, `segment-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
  await writeFile(path, contents);
  enqueueFunAsrSegment(path, Math.max(0, Math.min(12_000, durationMs)));
}

function stopSpeechRecognition(paused = false): void {
  if (systemSpeechRestartTimer) clearTimeout(systemSpeechRestartTimer);
  systemSpeechRestartTimer = null;
  speechSessionGeneration += 1;
  funAsrGeneration += 1;
  stopFunAsrWorker();
  if (activeFunAsrProcess && !activeFunAsrProcess.killed) activeFunAsrProcess.kill('SIGTERM');
  activeFunAsrProcess = null;
  const abandonedSegments = funAsrQueue;
  funAsrQueue = [];
  if (process.platform === 'win32' || process.platform === 'darwin') broadcast('speech:capture', { enabled: false, mode: 'streaming', deviceId: state.speech.inputDeviceId, processing: state.microphoneProcessing });
  for (const segment of abandonedSegments) void rm(segment.path, { force: true });
  speechStartGeneration += 1;
  speechStopRequested = true;
  if (speechStopFile) void writeFile(speechStopFile, 'stop', 'utf8');
  else if (speechProcess && !speechProcess.killed) speechProcess.kill('SIGTERM');
  speechProcess = null;
  speechStopFile = null;
  if (speechEventPoller) clearInterval(speechEventPoller);
  speechEventPoller = null;
  scriptTracker.reset(state.document);
  const nextStatus = paused ? 'paused' : 'ready';
  const nextMessage = paused ? '麦克风已暂停' : null;
  if (state.trackerStatus !== nextStatus || state.speech.message !== nextMessage) {
    dispatch({
      type: 'setTracker',
      status: nextStatus,
      patch: { transcript: '', asrConfidence: null, matchConfidence: null, direction: null, message: nextMessage, inputLevel: 0 },
    });
  }
  if (state.funasr.queuedSegments) dispatch({ type: 'setFunAsrState', patch: { queuedSegments: 0 } });
}

function handleSpeechEvent(event: NativeSpeechEvent): void {
  if (!speechFollowActive(state)) return;
  if (event.type === 'segment') {
    if (state.speech.engine === 'funasr' && event.path) enqueueFunAsrSegment(event.path, event.durationMs ?? 0);
    return;
  }
  if (event.type === 'level') {
    dispatch({
      type: 'setTracker',
      status: state.trackerStatus,
      patch: { inputLevel: Math.max(0, Math.min(1, event.level ?? 0)) },
    });
    return;
  }

  if (event.type === 'transcript') {
    for (const next of transcriptCommands(state, event, scriptTracker)) dispatch(next);
    return;
  }

  if (event.type === 'error') {
    dispatch({ type: 'setTracker', status: 'lost', patch: { message: event.message ?? '本地语音识别启动失败' } });
    return;
  }
  const listening = event.status === 'listening';
  dispatch({
    type: 'setTracker',
    status: listening ? 'listening' : event.type === 'warning' ? 'lost' : 'idle',
    patch: {
      message: event.message ?? (event.status === 'requesting' ? '正在请求语音识别权限' : null),
      onDevice: event.onDevice ?? true,
      locale: event.locale ?? state.speech.locale,
    },
  });
}

async function startSpeechRecognition(): Promise<void> {
  const sessionGeneration = ++speechSessionGeneration;
  const requestedEngine = state.speech.engine;
  if (process.platform === 'darwin') {
    const microphoneGranted = await ensureMicrophoneAccess();
    if (!microphoneGranted) return;
    if (sessionGeneration !== speechSessionGeneration || state.playbackMode !== 'ai' || !state.microphoneEnabled || state.speech.engine !== requestedEngine) return;
  }
  const selectedModel = FUNASR_MODELS[state.funasr.model];
  if (requestedEngine === 'funasr' && selectedModel.mode === 'streaming') {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      dispatch({ type: 'setTracker', status: 'lost', patch: { message: '当前平台未接入流式 Paraformer' } });
      return;
    }
    const installed = state.funasr.installStatus === 'ready' || await inspectFunAsrInstallation();
    if (sessionGeneration !== speechSessionGeneration || state.speech.engine !== requestedEngine) return;
    if (!installed) {
      dispatch({ type: 'setTracker', status: 'idle', patch: { message: '请先安装 Paraformer Streaming INT8', inputLevel: 0 } });
      return;
    }
    const generation = ++funAsrGeneration;
    speechStopRequested = false;
    scriptTracker.reset(state.document);
    dispatch({
      type: 'setTracker',
      status: 'idle',
      patch: { transcript: '', message: '正在加载流式 Paraformer', matchConfidence: null, direction: null, inputLevel: 0, onDevice: true },
    });
    try {
      await startFunAsrWorker();
    } catch (error) {
      stopFunAsrWorker();
      dispatch({ type: 'setTracker', status: 'lost', patch: { message: `流式 Paraformer 启动失败：${error instanceof Error ? error.message : String(error)}`, inputLevel: 0 } });
      return;
    }
    if (sessionGeneration !== speechSessionGeneration || generation !== funAsrGeneration || state.playbackMode !== 'ai' || !state.microphoneEnabled || state.speech.engine !== requestedEngine) {
      stopFunAsrWorker();
      return;
    }
    dispatch({ type: 'setTracker', status: 'listening', patch: { message: 'FunASR 流式本地识别中', inputLevel: 0 } });
    broadcast('speech:capture', { enabled: true, mode: 'streaming', deviceId: state.speech.inputDeviceId, processing: state.microphoneProcessing });
    return;
  }
  if (process.platform === 'win32' && requestedEngine === 'funasr') {
    const installed = state.funasr.installStatus === 'ready' || await inspectFunAsrInstallation();
    if (sessionGeneration !== speechSessionGeneration || state.speech.engine !== requestedEngine) return;
    if (!installed) {
      dispatch({ type: 'setTracker', status: 'idle', patch: { message: '请先安装 FunASR 本地模型', inputLevel: 0 } });
      return;
    }
    funAsrGeneration += 1;
    speechStopRequested = false;
    scriptTracker.reset(state.document);
    dispatch({ type: 'setTracker', status: 'listening', patch: { transcript: '', message: 'Windows FunASR 本地采集中', matchConfidence: null, direction: null, inputLevel: 0, onDevice: true } });
    broadcast('speech:capture', { enabled: true, mode: 'segmented', deviceId: state.speech.inputDeviceId, processing: state.microphoneProcessing });
    return;
  }
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    dispatch({ type: 'setTracker', status: 'lost', patch: { message: '当前平台未接入本地识别' } });
    return;
  }
  if (requestedEngine !== 'system') {
    dispatch({ type: 'setTracker', status: 'lost', patch: { message: '当前 FunASR 模型不支持该采集模式' } });
    return;
  }
  if (speechProcess) return;
  const generation = ++speechStartGeneration;
  speechStopRequested = false;
  scriptTracker.reset(state.document);
  dispatch({
    type: 'setTracker',
    status: 'idle',
    patch: {
      transcript: '',
      message: process.platform === 'win32'
        ? '正在启动 Windows 系统本地识别'
        : '正在请求语音识别与麦克风权限',
      matchConfidence: null,
      direction: null,
      inputLevel: 0,
    },
  });

  const speechSessionDirectory = join(app.getPath('temp'), `teleprompter-speech-${process.pid}-${Date.now()}`);
  const eventFile = join(speechSessionDirectory, 'events.jsonl');
  const stopFile = join(speechSessionDirectory, 'stop');
  await mkdir(speechSessionDirectory, { recursive: true });
  await writeFile(eventFile, '', 'utf8');
  await rm(stopFile, { force: true });
  if (sessionGeneration !== speechSessionGeneration || generation !== speechStartGeneration || state.playbackMode !== 'ai' || !state.microphoneEnabled || state.speech.engine !== requestedEngine) return;
  const speechCommand = createSystemSpeechCommand({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    locale: state.speech.locale,
    eventFile,
    stopFile,
    voiceProcessing: state.microphoneProcessing.noiseSuppression
      || state.microphoneProcessing.autoGainControl
      || state.microphoneProcessing.echoCancellation,
    inputGain: state.microphoneProcessing.inputGain,
    mockScript: process.env.TELEPROMPTER_SPEECH_MOCK,
    nodeExecutable: process.env.npm_node_execpath,
  });
  const child = spawn(speechCommand.command, speechCommand.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: speechCommand.windowsHide,
  });
  speechProcess = child;
  speechStopFile = speechCommand.usesEventFile ? stopFile : null;
  if (!child.stdout || !child.stderr) {
    child.kill();
    speechProcess = null;
    dispatch({ type: 'setTracker', status: 'lost', patch: { message: '本地识别进程没有可用的输出管道' } });
    return;
  }
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (sessionGeneration !== speechSessionGeneration || state.speech.engine !== requestedEngine) return;
    try {
      handleSpeechEvent(JSON.parse(line) as NativeSpeechEvent);
    } catch (error) {
      dispatch({ type: 'setTracker', status: 'lost', patch: { message: `无法解析本地识别结果：${String(error)}` } });
    }
  });
  if (speechCommand.usesEventFile) {
    let consumedLength = 0;
    let pendingText = '';
    let reading = false;
    speechEventPoller = setInterval(() => {
      if (reading) return;
      reading = true;
      void readFile(eventFile, 'utf8').then((contents) => {
        if (sessionGeneration !== speechSessionGeneration || state.speech.engine !== requestedEngine) return;
        const appended = contents.slice(consumedLength);
        consumedLength = contents.length;
        pendingText += appended;
        const eventLines = pendingText.split('\n');
        pendingText = eventLines.pop() ?? '';
        for (const line of eventLines) {
          if (!line.trim()) continue;
          try {
            handleSpeechEvent(JSON.parse(line) as NativeSpeechEvent);
          } catch (error) {
            dispatch({ type: 'setTracker', status: 'lost', patch: { message: `无法解析本地识别结果：${String(error)}` } });
          }
        }
      }).catch((error) => {
        if (sessionGeneration !== speechSessionGeneration || state.speech.engine !== requestedEngine) return;
        dispatch({ type: 'setTracker', status: 'lost', patch: { message: `无法读取本地识别结果：${String(error)}` } });
      }).finally(() => { reading = false; });
    }, 50);
  }
  child.stderr.on('data', (data: Buffer) => {
    if (sessionGeneration !== speechSessionGeneration || state.speech.engine !== requestedEngine) return;
    const message = data.toString().trim();
    if (message) dispatch({ type: 'setTracker', status: 'lost', patch: { message } });
  });
  child.once('error', (error) => {
    const wasCurrentProcess = speechProcess === child;
    if (wasCurrentProcess) speechProcess = null;
    if (sessionGeneration !== speechSessionGeneration || state.speech.engine !== requestedEngine || !wasCurrentProcess) return;
    dispatch({ type: 'setTracker', status: 'lost', patch: { message: `无法启动本地识别：${error.message}` } });
  });
  child.once('exit', (code) => {
    const wasCurrentProcess = speechProcess === child;
    if (wasCurrentProcess) {
      speechProcess = null;
      speechStopFile = null;
      if (speechEventPoller) clearInterval(speechEventPoller);
      speechEventPoller = null;
    }
    if (sessionGeneration === speechSessionGeneration && state.speech.engine === requestedEngine && wasCurrentProcess && !speechStopRequested && state.playbackMode === 'ai' && code !== 0 && state.trackerStatus !== 'lost') {
      dispatch({ type: 'setTracker', status: 'lost', patch: { message: `本地识别进程已退出（${code ?? 'signal'}）` } });
    }
  });
}

async function ensureMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  if (microphoneAccessPromise) return microphoneAccessPromise;

  microphoneAccessPromise = (async () => {
    const initialStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (initialStatus === 'not-determined' || initialStatus === 'unknown') {
      dispatch({
        type: 'setTracker',
        status: 'idle',
        patch: { message: '正在请求麦克风权限', inputLevel: 0 },
      });
    }

    try {
      const result = await requestMicrophoneAccess(systemPreferences);
      if (result.granted) return true;
      const message = result.status === 'restricted'
        ? '麦克风访问受系统策略限制'
        : '麦克风权限未开启，请在系统设置中允许后重新启动应用';
      dispatch({ type: 'setTracker', status: 'lost', patch: { message, inputLevel: 0 } });
      return false;
    } catch (error) {
      dispatch({
        type: 'setTracker',
        status: 'lost',
        patch: { message: `请求麦克风权限失败：${error instanceof Error ? error.message : String(error)}`, inputLevel: 0 },
      });
      return false;
    }
  })().finally(() => {
    microphoneAccessPromise = null;
  });
  return microphoneAccessPromise;
}

function handleSessionCommand(command: SessionCommand & { currentScrollOffsetPx?: number }): void {
  if (typeof command.currentScrollOffsetPx === 'number') {
    state.scrollOffsetPx = command.currentScrollOffsetPx;
  }
  dispatch(command);
  if (manualPositionCommand(command)) scriptTracker.reset(state.document, Date.now(), 2000);
  if (command.type === 'setDocument') scriptTracker.reset(state.document, Date.now(), 1200);
  if (command.type === 'setMode') {
    if (command.mode === 'ai' && state.microphoneEnabled) void startSpeechRecognition();
    else stopSpeechRecognition();
  }
  if (command.type === 'setSpeechEngine') {
    stopSpeechRecognition();
    if (state.playbackMode === 'ai' && state.microphoneEnabled) void startSpeechRecognition();
  }
  if (command.type === 'setSpeechInputDevice' && state.speech.engine === 'funasr') {
    stopSpeechRecognition();
    if (state.playbackMode === 'ai' && state.microphoneEnabled) void startSpeechRecognition();
  }
  if (command.type === 'setMicrophoneProcessing' && state.playbackMode === 'ai' && state.microphoneEnabled && state.speech.engine === 'funasr') {
    const mode = FUNASR_MODELS[state.funasr.model].mode;
    if (mode === 'streaming' || process.platform === 'win32') {
      broadcast('speech:capture', { enabled: true, mode, deviceId: state.speech.inputDeviceId, processing: state.microphoneProcessing });
    }
  }
  if (command.type === 'setMicrophoneProcessing' && state.playbackMode === 'ai' && state.microphoneEnabled && state.speech.engine === 'system' && process.platform === 'darwin') {
    if (systemSpeechRestartTimer) clearTimeout(systemSpeechRestartTimer);
    systemSpeechRestartTimer = setTimeout(() => {
      systemSpeechRestartTimer = null;
      if (state.playbackMode !== 'ai' || !state.microphoneEnabled || state.speech.engine !== 'system') return;
      stopSpeechRecognition();
      void startSpeechRecognition();
    }, 240);
  }
  if (command.type === 'setFunAsrBackend') {
    if (command.backend !== 'auto' && !state.funasr.availableBackends.includes(command.backend)) {
      dispatch({ type: 'setFunAsrState', patch: { backend: 'auto', resolvedBackend: null, message: '当前平台不支持所选后端，已切回自动' } });
    }
    stopSpeechRecognition();
    dispatch({ type: 'setFunAsrState', patch: { installStatus: 'checking', installProgress: 0, message: '后端已变更，正在检查 runtime' } });
    void inspectFunAsrInstallation().then((installed) => {
      if (installed && state.playbackMode === 'ai' && state.microphoneEnabled && state.speech.engine === 'funasr') void startSpeechRecognition();
    });
  }
  if (command.type === 'setFunAsrModel') {
    stopSpeechRecognition();
    void inspectFunAsrInstallation().then((installed) => {
      if (installed && state.playbackMode === 'ai' && state.microphoneEnabled && state.speech.engine === 'funasr') void startSpeechRecognition();
    });
  }
  if (command.type === 'setMicrophoneEnabled' && state.playbackMode === 'ai') {
    if (command.enabled) void startSpeechRecognition();
    else stopSpeechRecognition(true);
  }
}

function loadRenderer(window: BrowserWindow, view: 'control' | 'display'): void {
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}?view=${view}`);
  } else {
    void window.loadFile(rendererPath, { query: { view } });
  }
}

function selectedDisplay() {
  const displays = screen.getAllDisplays();
  const controllerDisplay = controllerWindow
    ? screen.getDisplayMatching(controllerWindow.getBounds())
    : screen.getPrimaryDisplay();
  return displays.find((display) => String(display.id) === state.selectedDisplayId)
    ?? displays.find((display) => display.id !== controllerDisplay.id)
    ?? controllerDisplay;
}

function restoreControllerFocus(): void {
  if (!controllerWindow || controllerWindow.isDestroyed()) return;
  if (process.platform === 'darwin') app.focus({ steal: true });
  controllerWindow.show();
  controllerWindow.focus();
  controllerWindow.webContents.focus();
  setTimeout(() => {
    if (!controllerWindow || controllerWindow.isDestroyed()) return;
    if (process.platform === 'darwin') app.focus({ steal: true });
    controllerWindow.focus();
    controllerWindow.webContents.focus();
  }, 100);
}

function placeDisplayWindow(): void {
  if (!displayWindow) return;
  const target = selectedDisplay();
  const controllerDisplay = controllerWindow
    ? screen.getDisplayMatching(controllerWindow.getBounds())
    : screen.getPrimaryDisplay();
  displayWindow.setFullScreen(false);
  displayWindow.setAlwaysOnTop(false);
  if (userPositionedDisplay && screen.getDisplayMatching(displayWindow.getBounds()).id === target.id) {
    displayWindow.showInactive();
    restoreControllerFocus();
    return;
  }
  const workArea = target.workArea;
  const width = Math.min(1600, Math.max(720, Math.round(workArea.width * 0.84)));
  const height = Math.min(Math.round(workArea.height * 0.84), Math.round(width * 9 / 16));
  programmaticDisplayMove = true;
  displayWindow.setBounds({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  });
  programmaticDisplayMove = false;
  displayWindow.showInactive();
  restoreControllerFocus();
}

function createControllerWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'Teleprompter Studio',
    backgroundColor: '#111311',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: CONTROLLER_SESSION_PARTITION,
    },
  });
  loadRenderer(window, 'control');
  window.on('closed', () => {
    controllerWindow = null;
    if (displayWindow) displayWindow.close();
  });
  return window;
}

function createDisplayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    frame: true,
    title: 'Teleprompter Display',
    backgroundColor: state.typography.background,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadRenderer(window, 'display');
  window.on('move', () => {
    if (!programmaticDisplayMove && !window.isFullScreen()) userPositionedDisplay = true;
  });
  window.webContents.once('did-finish-load', () => {
    window.showInactive();
    restoreControllerFocus();
  });
  window.on('closed', () => {
    displayWindow = null;
    if (state.displayOpen) dispatch({ type: 'setDisplayOpen', open: false });
  });
  return window;
}

function toggleDisplayWindow(open?: boolean): void {
  const shouldOpen = open ?? !displayWindow;
  if (!shouldOpen) {
    displayWindow?.close();
    return;
  }
  if (!displayWindow) displayWindow = createDisplayWindow();
  placeDisplayWindow();
  if (!state.displayOpen) dispatch({ type: 'setDisplayOpen', open: true });
}

async function importScript(): Promise<ImportResult | null> {
  return importScriptViaDialog(controllerWindow);
}

function startTicker(): void {
  // Smooth scrolling is driven by renderer requestAnimationFrame at native display refresh rates (60/120fps)
}

function registerIpc(): void {
  ipcMain.handle('session:get', () => state);
  ipcMain.handle('display:list', () => displayList());
  ipcMain.handle('script:import', () => importScript());
  ipcMain.on('session:command', (_event, command: SessionCommand) => handleSessionCommand(command));
  ipcMain.on('display:toggle', (_event, open?: boolean) => toggleDisplayWindow(open));
  ipcMain.handle('speech:open-settings', (_event, engine: 'system' | 'funasr') => shell.openExternal(
    process.platform === 'win32'
      ? 'ms-settings:privacy-microphone'
      : engine === 'funasr'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
  ));
  ipcMain.handle('funasr:install', (_event, modelId?: FunAsrModelId, force?: boolean) => installFunAsr(modelId ?? state.funasr.model, force ?? false));
  ipcMain.handle('funasr:inspect', () => inspectFunAsrInstallation());
  ipcMain.handle('funasr:delete-model', (_event, modelId: FunAsrModelId) => deleteFunAsrModel(modelId));
  ipcMain.handle('funasr:open-models', () => shell.openPath(funAsrRoot()));
  ipcMain.handle('speech:submit-segment', (_event, wav: Uint8Array, durationMs: number) => submitRendererSpeechSegment(wav, durationMs));
  ipcMain.on('speech:submit-chunk', (_event, samples: ArrayBuffer) => submitStreamingSpeechChunk(samples));
  ipcMain.on('speech:input-level', (_event, level: number) => {
    if ((process.platform !== 'win32' && process.platform !== 'darwin') || state.trackerStatus !== 'listening' || state.speech.engine !== 'funasr') return;
    handleSpeechEvent({ type: 'level', level });
  });
  ipcMain.on('speech:capture-ready', (_event, _deviceId: string | null, usedFallback: boolean) => {
    if ((process.platform !== 'win32' && process.platform !== 'darwin') || state.trackerStatus !== 'listening' || state.speech.engine !== 'funasr') return;
    if (usedFallback && state.speech.inputDeviceId) {
      dispatch({ type: 'setSpeechInputDevice', deviceId: null });
    }
    dispatch({
      type: 'setTracker',
      status: 'listening',
      patch: { message: usedFallback ? '所选麦克风不可用，已切换到系统默认麦克风' : state.speech.inputDeviceId ? '指定麦克风采集中' : '系统默认麦克风采集中' },
    });
  });
  ipcMain.on('speech:capture-error', (_event, message: string) => {
    if ((process.platform !== 'win32' && process.platform !== 'darwin') || state.speech.engine !== 'funasr') return;
    stopFunAsrWorker();
    broadcast('speech:capture', { enabled: false, mode: 'streaming', deviceId: state.speech.inputDeviceId, processing: state.microphoneProcessing });
    dispatch({ type: 'setTracker', status: 'lost', patch: { message, inputLevel: 0 } });
  });
  ipcMain.on('speech:capture-warning', (_event, message: string) => {
    if ((process.platform !== 'win32' && process.platform !== 'darwin') || state.speech.engine !== 'funasr') return;
    dispatch({ type: 'setTracker', status: state.trackerStatus, patch: { message } });
  });
}

app.whenReady().then(async () => {
  await migrateLegacyModelStorage();
  await restorePersistedState();
  await cleanupLegacySegmentedFunAsr();
  const availableBackends: SessionState['funasr']['availableBackends'] = process.platform === 'win32' ? ['cuda', 'vulkan', 'cpu'] : ['cpu'];
  dispatch({
    type: 'setFunAsrState',
    patch: {
      availableBackends,
      backend: state.funasr.backend !== 'auto' && !availableBackends.includes(state.funasr.backend) ? 'auto' : state.funasr.backend,
    },
  });
  if (state.speech.engine === 'funasr') await inspectFunAsrInstallation();
  registerIpc();
  if (process.platform === 'win32' || process.platform === 'darwin') {
    const controllerSession = session.fromPartition(CONTROLLER_SESSION_PARTITION);
    controllerSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => (
      allowAudioMediaCheck(true, permission, details.mediaType)
    ));
    controllerSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes ?? [] : [];
      callback(allowAudioMediaRequest(true, permission, mediaTypes));
    });
  }
  controllerWindow = createControllerWindow();
  startTicker();

  screen.on('display-added', () => broadcast('display:list', displayList()));
  screen.on('display-removed', () => {
    broadcast('display:list', displayList());
    if (displayWindow) placeDisplayWindow();
  });
  screen.on('display-metrics-changed', () => {
    broadcast('display:list', displayList());
    if (displayWindow) placeDisplayWindow();
  });

  app.on('activate', () => {
    if (!controllerWindow) controllerWindow = createControllerWindow();
  });
});

app.on('window-all-closed', () => {
  stopSpeechRecognition();
  if (ticker) clearInterval(ticker);
  if (process.platform !== 'darwin') app.quit();
});
