import { parentPort, workerData } from 'node:worker_threads';
import { OnlineRecognizer, type OnlineStream } from 'sherpa-onnx-node';

interface WorkerConfig {
  encoder: string;
  decoder: string;
  tokens: string;
  numThreads: number;
}

interface AudioMessage {
  type: 'audio';
  samples: ArrayBuffer;
  receivedAt: number;
}

const SAMPLE_RATE = 16_000;
const config = workerData as WorkerConfig;
const recognizer = new OnlineRecognizer({
  featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
  modelConfig: {
    paraformer: { encoder: config.encoder, decoder: config.decoder },
    tokens: config.tokens,
    numThreads: config.numThreads,
    provider: 'cpu',
    debug: 0,
  },
  decodingMethod: 'greedy_search',
  maxActivePaths: 4,
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 0.8,
  rule3MinUtteranceLength: 20,
});
const stream: OnlineStream = recognizer.createStream();
let lastText = '';

function decodeAvailable(): void {
  while (recognizer.isReady(stream)) recognizer.decode(stream);
}

function emitTranscript(isFinal: boolean, receivedAt: number): void {
  const text = recognizer.getResult(stream).text.trim();
  if (text && (text !== lastText || isFinal)) {
    lastText = text;
    parentPort?.postMessage({ type: 'transcript', text, isFinal, latencyMs: Date.now() - receivedAt });
  }
}

parentPort?.on('message', (message: AudioMessage) => {
  if (message.type !== 'audio') return;
  const samples = new Float32Array(message.samples);
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  decodeAvailable();
  const endpoint = recognizer.isEndpoint(stream);
  if (endpoint) {
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: new Float32Array(SAMPLE_RATE * 0.4) });
    decodeAvailable();
  }
  emitTranscript(endpoint, message.receivedAt);
  if (endpoint) {
    recognizer.reset(stream);
    lastText = '';
  }
  parentPort?.postMessage({ type: 'consumed' });
});

parentPort?.postMessage({ type: 'ready' });
