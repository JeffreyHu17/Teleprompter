import { strict as assert } from 'node:assert';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sherpaOnnx from 'sherpa-onnx-node';

const modelDir = process.env.TELEPROMPTER_PARAFORMER_DIR
  ?? join(homedir(), 'Library/Application Support/teleprompter-studio/funasr/models/paraformer-streaming-int8');
const wavePath = process.env.TELEPROMPTER_PARAFORMER_WAV
  ?? join(process.cwd(), 'debug/2026-08-14/paraformer-official-0.wav');

const recognizer = new sherpaOnnx.OnlineRecognizer({
  featConfig: { sampleRate: 16_000, featureDim: 80 },
  modelConfig: {
    paraformer: {
      encoder: join(modelDir, 'encoder.int8.onnx'),
      decoder: join(modelDir, 'decoder.int8.onnx'),
    },
    tokens: join(modelDir, 'tokens.txt'),
    numThreads: 2,
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
const wave = sherpaOnnx.readWave(wavePath);
const stream = recognizer.createStream();
const chunkSamples = Math.round(wave.sampleRate * 0.1);
const partials = [];
const startedAt = Date.now();

for (let offset = 0; offset < wave.samples.length; offset += chunkSamples) {
  stream.acceptWaveform({
    sampleRate: wave.sampleRate,
    samples: wave.samples.slice(offset, Math.min(wave.samples.length, offset + chunkSamples)),
  });
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const text = recognizer.getResult(stream).text.trim();
  if (text && partials.at(-1)?.text !== text) partials.push({ text, audioMs: Math.round(offset / wave.sampleRate * 1000) });
}
stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: new Float32Array(Math.round(wave.sampleRate * 0.4)) });
while (recognizer.isReady(stream)) recognizer.decode(stream);
const finalText = recognizer.getResult(stream).text.trim();
const elapsedMs = Date.now() - startedAt;

assert.ok(partials.length >= 2, `expected incremental partials, got ${JSON.stringify(partials)}`);
assert.ok(partials[0].audioMs < wave.samples.length / wave.sampleRate * 1000, 'first partial arrived only after all audio');
assert.ok(finalText.length > 0, 'final transcript is empty');
process.stdout.write(`${JSON.stringify({ partials, finalText, elapsedMs, audioMs: Math.round(wave.samples.length / wave.sampleRate * 1000) }, null, 2)}\n`);
