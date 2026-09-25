declare module 'sherpa-onnx-node' {
  export interface OnlineStream {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  }

  export interface OnlineRecognizerResult {
    text: string;
  }

  export class OnlineRecognizer {
    constructor(config: Record<string, unknown>);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    isEndpoint(stream: OnlineStream): boolean;
    getResult(stream: OnlineStream): OnlineRecognizerResult;
    reset(stream: OnlineStream): void;
  }
}
