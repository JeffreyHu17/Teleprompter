import { parentPort, workerData } from 'node:worker_threads';

const transcript = String((workerData as { transcript?: string }).transcript ?? '这是第三段内容如果读错了可以重新朗读上一句系统应该自动跳回');
let emitted = false;

parentPort?.on('message', (message: { type?: string }) => {
  if (message.type !== 'audio') return;
  if (!emitted) {
    emitted = true;
    parentPort?.postMessage({ type: 'transcript', text: transcript, isFinal: false, latencyMs: 1 });
  }
  parentPort?.postMessage({ type: 'consumed' });
});

parentPort?.postMessage({ type: 'ready' });
