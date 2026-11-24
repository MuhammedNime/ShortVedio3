import assert from 'node:assert/strict';
import {
  EXPORT_QUALITY_TIERS,
  computeScaledDimensions,
  formatExportErrorMessage,
  getPreferredMediaRecorderMimeTypes,
  probeExportCapabilities,
  resetExportCapabilitiesCache,
  resolveExportDimensionPlans,
} from '../src/canvas/exportCapabilities';
import {
  estimateRemainingMs,
  exportSessionManager,
  formatDurationCompact,
} from '../src/canvas/exportSession';
import { __exporterInternals, exportQuizVideo } from '../src/canvas/videoExporter';
import {
  ensureMatchingFileName,
  normalizeExportMime,
  saveOrDownloadBlob,
  shareBlobNatively,
} from '../src/utils/nativeDownload';
import { soundEngine } from '../src/audio/soundEngine';
import {
  AudioSettings,
  DEFAULT_AUDIO,
  DEFAULT_TEMPLATE,
  DEFAULT_TIMING,
  QuestionSlide,
  TemplateSettings,
  TimingSettings,
} from '../src/types/quiz';

// ============================================================================
// Lightweight Web APIs Simulation Harness for Node / TSX
// ============================================================================

interface MockMetrics {
  videoFramesCreated: number;
  videoFramesClosed: number;
  audioDataCreated: number;
  audioDataClosed: number;
  videoEncodersCreated: number;
  videoEncodersClosed: number;
  audioEncodersCreated: number;
  audioEncodersClosed: number;
  backpressureHits: number;
  postCloseCalls: number;
  flushBeforeFinalizeOrder: string[];
  mediaRecordersCreated: number;
  mediaRecorderStoppedTracks: number;
  mediaRecorderTotalTracks: number;
  oscillatorsStarted: number;
  oscillatorsStopped: number;
  canvasesCreated: number;
  canvasesZeroed: number;
  domNodesAdded: number;
  domNodesRemoved: number;
}

function createFreshMetrics(): MockMetrics {
  return {
    videoFramesCreated: 0,
    videoFramesClosed: 0,
    audioDataCreated: 0,
    audioDataClosed: 0,
    videoEncodersCreated: 0,
    videoEncodersClosed: 0,
    audioEncodersCreated: 0,
    audioEncodersClosed: 0,
    backpressureHits: 0,
    postCloseCalls: 0,
    flushBeforeFinalizeOrder: [],
    mediaRecordersCreated: 0,
    mediaRecorderStoppedTracks: 0,
    mediaRecorderTotalTracks: 0,
    oscillatorsStarted: 0,
    oscillatorsStopped: 0,
    canvasesCreated: 0,
    canvasesZeroed: 0,
    domNodesAdded: 0,
    domNodesRemoved: 0,
  };
}

class MockCanvasCtx2D {
  public font = '24px sans-serif';
  public fillStyle: string | object = '#000000';
  public strokeStyle: string | object = '#000000';
  public lineWidth = 1;
  public lineCap: CanvasLineCap = 'butt';
  public lineJoin: CanvasLineJoin = 'miter';
  public textAlign: CanvasTextAlign = 'start';
  public textBaseline: CanvasTextBaseline = 'alphabetic';
  public globalAlpha = 1;
  public shadowColor = 'transparent';
  public shadowBlur = 0;
  public shadowOffsetX = 0;
  public shadowOffsetY = 0;
  public imageSmoothingEnabled = true;
  public imageSmoothingQuality: ImageSmoothingQuality = 'high';
  public direction: CanvasDirection = 'rtl';

  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  arcTo() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  rect() {}
  roundRect() {}
  fill() {}
  stroke() {}
  clip() {}
  fillRect() {}
  strokeRect() {}
  clearRect() {}
  fillText() {}
  strokeText() {}
  translate() {}
  rotate() {}
  scale() {}
  setTransform() {}
  resetTransform() {}
  setLineDash() {}
  drawImage() {}
  measureText(text: string) {
    return {
      width: Math.max(10, (text || '').length * 14),
      actualBoundingBoxAscent: 18,
      actualBoundingBoxDescent: 6,
    };
  }
  createLinearGradient() {
    return { addColorStop() {} };
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
}

function makeSampleBuffer(sampleRate: number, durationSec: number, channels = 2): AudioBuffer {
  const length = Math.max(1, Math.ceil(sampleRate * durationSec));
  const data: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const arr = new Float32Array(length);
    for (let i = 0; i < Math.min(length, 256); i++) {
      arr[i] = Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 0.1;
    }
    data.push(arr);
  }
  return {
    sampleRate,
    length,
    duration: durationSec,
    numberOfChannels: channels,
    getChannelData: (c: number) => data[Math.min(c, data.length - 1)],
    copyFromChannel: (dest: Float32Array, c: number, offset = 0) => {
      dest.set(data[Math.min(c, data.length - 1)].subarray(offset, offset + dest.length));
    },
    copyToChannel: (src: Float32Array, c: number, offset = 0) => {
      data[Math.min(c, data.length - 1)].set(src, offset);
    },
  } as unknown as AudioBuffer;
}

interface EnvOptions {
  failWebCodecsOnConfigure?: boolean;
  failWebCodecs1080pOnly?: boolean;
  simulateBackpressureEveryNFrames?: number;
  webCodecsDelayMs?: number;
  audioSampleRate?: number;
  supportedContainers?: { mp4: boolean; webm: boolean };
  audioContextState?: 'running' | 'suspended';
  mediaRecorderThrowWithBitrate?: boolean;
  mediaRecorderMimes?: string[];
}

function installMockEnvironment(metrics: MockMetrics, opts: EnvOptions = {}) {
  const g = globalThis as Record<string, unknown>;
  const supportedContainers = opts.supportedContainers ?? { mp4: true, webm: true };
  const sampleRate = opts.audioSampleRate ?? 48000;

  const domChildren = new Set<unknown>();
  const body = {
    appendChild(node: { parentNode?: unknown }) {
      metrics.domNodesAdded += 1;
      node.parentNode = body;
      domChildren.add(node);
      return node;
    },
    removeChild(node: { parentNode?: unknown }) {
      if (domChildren.has(node)) {
        metrics.domNodesRemoved += 1;
        domChildren.delete(node);
        node.parentNode = null;
      }
      return node;
    },
  };

  class MockCanvas {
    private _w = 300;
    private _h = 150;
    public parentNode: unknown = null;
    public style: Record<string, string> = {};
    public isConnected = false;

    constructor() {
      metrics.canvasesCreated += 1;
    }

    get width() {
      return this._w;
    }
    set width(v: number) {
      this._w = v;
      if (v === 0 && this._h === 0) {
        metrics.canvasesZeroed += 1;
      }
    }
    get height() {
      return this._h;
    }
    set height(v: number) {
      this._h = v;
      if (this._w === 0 && v === 0) {
        metrics.canvasesZeroed += 1;
      }
    }
    getContext() {
      return new MockCanvasCtx2D();
    }
    captureStream() {
      metrics.mediaRecorderTotalTracks += 1;
      const track = {
        kind: 'video',
        readyState: 'live',
        stop() {
          if (this.readyState !== 'ended') {
            this.readyState = 'ended';
            metrics.mediaRecorderStoppedTracks += 1;
          }
        },
      };
      return {
        getVideoTracks: () => [track],
        getAudioTracks: () => [],
        getTracks: () => [track],
      };
    }
    remove() {
      body.removeChild(this);
    }
  }

  const fakeWin = g;
  fakeWin.setTimeout = globalThis.setTimeout.bind(globalThis);
  fakeWin.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  fakeWin.setInterval = globalThis.setInterval.bind(globalThis);
  fakeWin.clearInterval = globalThis.clearInterval.bind(globalThis);
  fakeWin.requestAnimationFrame = (cb: FrameRequestCallback) =>
    globalThis.setTimeout(() => cb(performance.now()), 4) as unknown as number;
  fakeWin.cancelAnimationFrame = (id: number) => globalThis.clearTimeout(id);

  class MockAudioContext {
    public state: 'running' | 'suspended' | 'closed' = opts.audioContextState ?? 'running';
    public sampleRate = sampleRate;
    private startWall = performance.now();
    public destination = { kind: 'destination' };

    get currentTime() {
      if (this.state !== 'running') return 0;
      return (performance.now() - this.startWall) / 1000;
    }
    async resume() {
      this.state = 'running';
    }
    createMediaStreamDestination() {
      metrics.mediaRecorderTotalTracks += 1;
      const track = {
        kind: 'audio',
        readyState: 'live',
        stop() {
          if (this.readyState !== 'ended') {
            this.readyState = 'ended';
            metrics.mediaRecorderStoppedTracks += 1;
          }
        },
      };
      return {
        disconnect() {},
        stream: {
          getAudioTracks: () => [track],
          getTracks: () => [track],
        },
      };
    }
    createOscillator() {
      let stopped = false;
      return {
        type: 'sine',
        frequency: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
        start() {
          metrics.oscillatorsStarted += 1;
        },
        stop() {
          if (!stopped) {
            stopped = true;
            metrics.oscillatorsStopped += 1;
          }
        },
      };
    }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
          cancelScheduledValues() {},
        },
        connect() {},
        disconnect() {},
      };
    }
    createBuffer(channels: number, length: number, sr: number) {
      return makeSampleBuffer(sr, length / sr, channels);
    }
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        onended: null,
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    }
    createBiquadFilter() {
      return {
        type: 'bandpass',
        Q: { setValueAtTime() {} },
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
  }

  class MockOfflineAudioContext extends MockAudioContext {
    private len: number;
    constructor(_ch: number, length: number, sr: number) {
      super();
      this.len = length;
      this.sampleRate = sr;
    }
    createDynamicsCompressor() {
      return {
        threshold: { setValueAtTime() {} },
        knee: { setValueAtTime() {} },
        ratio: { setValueAtTime() {} },
        attack: { setValueAtTime() {} },
        release: { setValueAtTime() {} },
        connect() {},
      };
    }
    async startRendering() {
      return makeSampleBuffer(this.sampleRate, this.len / this.sampleRate, 2);
    }
  }

  class MockVideoFrame {
    public timestamp: number;
    public duration: number;
    public closed = false;
    constructor(_source: unknown, init: { timestamp: number; duration?: number }) {
      this.timestamp = init.timestamp;
      this.duration = init.duration ?? 33333;
      metrics.videoFramesCreated += 1;
    }
    close() {
      if (!this.closed) {
        this.closed = true;
        metrics.videoFramesClosed += 1;
      }
    }
  }

  class MockAudioData {
    public timestamp: number;
    public numberOfFrames: number;
    public sampleRate: number;
    public closed = false;
    constructor(init: {
      timestamp: number;
      numberOfFrames: number;
      sampleRate: number;
    }) {
      this.timestamp = init.timestamp;
      this.numberOfFrames = init.numberOfFrames;
      this.sampleRate = init.sampleRate;
      metrics.audioDataCreated += 1;
    }
    close() {
      if (!this.closed) {
        this.closed = true;
        metrics.audioDataClosed += 1;
      }
    }
  }

  class MockEncodedVideoChunk {
    public type: 'key' | 'delta';
    public timestamp: number;
    public duration: number;
    private bytes: Uint8Array;
    constructor(init: {
      type: 'key' | 'delta';
      timestamp: number;
      duration: number;
      data: Uint8Array;
    }) {
      this.type = init.type;
      this.timestamp = init.timestamp;
      this.duration = init.duration;
      this.bytes = init.data;
    }
    get byteLength() {
      return this.bytes.byteLength;
    }
    copyTo(dest: BufferSource) {
      const target =
        dest instanceof ArrayBuffer
          ? new Uint8Array(dest)
          : new Uint8Array(dest.buffer, dest.byteOffset, dest.byteLength);
      target.set(this.bytes);
    }
  }

  class MockEncodedAudioChunk {
    public type: 'key' | 'delta';
    public timestamp: number;
    public duration: number;
    private bytes: Uint8Array;
    constructor(init: {
      type: 'key' | 'delta';
      timestamp: number;
      duration: number;
      data: Uint8Array;
    }) {
      this.type = init.type;
      this.timestamp = init.timestamp;
      this.duration = init.duration;
      this.bytes = init.data;
    }
    get byteLength() {
      return this.bytes.byteLength;
    }
    copyTo(dest: BufferSource) {
      const target =
        dest instanceof ArrayBuffer
          ? new Uint8Array(dest)
          : new Uint8Array(dest.buffer, dest.byteOffset, dest.byteLength);
      target.set(this.bytes);
    }
  }

  class MockVideoEncoder {
    public state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
    public encodeQueueSize = 0;
    private cfg: VideoEncoderConfig | null = null;
    private init: {
      output: (chunk: MockEncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
      error: (err: Error) => void;
    };
    private pendingPromises: Promise<void>[] = [];
    private frameCounter = 0;

    static async isConfigSupported(cfg: VideoEncoderConfig) {
      const isAvc = cfg.codec.startsWith('avc1');
      const isWebm = cfg.codec.startsWith('vp8') || cfg.codec.startsWith('vp09');
      const supported =
        (isAvc && supportedContainers.mp4) || (isWebm && supportedContainers.webm);
      return { supported, config: cfg };
    }

    constructor(init: {
      output: (chunk: MockEncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
      error: (err: Error) => void;
    }) {
      this.init = init;
      metrics.videoEncodersCreated += 1;
    }

    configure(cfg: VideoEncoderConfig) {
      if (this.state === 'closed') {
        metrics.postCloseCalls += 1;
        throw new Error('Cannot configure closed VideoEncoder');
      }
      if (opts.failWebCodecsOnConfigure) {
        throw new Error('NotSupportedError: simulated hardware encoder reject');
      }
      if (opts.failWebCodecs1080pOnly && cfg.width >= 1080 && cfg.height >= 1920) {
        throw new Error('NotSupportedError: 1080p reject');
      }
      this.cfg = cfg;
      this.state = 'configured';
    }

    encode(frame: MockVideoFrame, encodeOpts?: { keyFrame?: boolean }) {
      if (this.state !== 'configured') {
        metrics.postCloseCalls += 1;
        throw new Error('VideoEncoder used after close or unconfigured');
      }
      this.frameCounter += 1;
      const isFirst = this.frameCounter === 1;
      const isKey = Boolean(encodeOpts?.keyFrame || isFirst);
      const ts = frame.timestamp;
      const dur = frame.duration;
      const delay = opts.webCodecsDelayMs ?? 0;

      const emitChunk = () => {
        if (this.state !== 'configured') return;
        const payload = isKey
          ? new Uint8Array([0x00, 0x00, 0x00, 0x05, 0x65, 0x88, 0x84, 0x21, 0xa0])
          : new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x41, 0x9a, 0x22, 0x11]);
        const chunk = new MockEncodedVideoChunk({
          type: isKey ? 'key' : 'delta',
          timestamp: ts,
          duration: dur,
          data: payload,
        });
        const codecStr = this.cfg?.codec ?? 'avc1.42E01F';
        const meta: EncodedVideoChunkMetadata | undefined = isFirst
          ? {
              decoderConfig: {
                codec: codecStr,
                codedWidth: this.cfg?.width ?? 720,
                codedHeight: this.cfg?.height ?? 1280,
                description: codecStr.startsWith('avc1')
                  ? new Uint8Array([
                      1, 0x42, 0xe0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xe0, 0x1f, 1, 0, 4,
                      0x68, 0xce, 0x3c, 0x80,
                    ])
                  : undefined,
              },
            }
          : undefined;
        this.init.output(chunk, meta);
      };

      const triggerBp =
        Boolean(opts.simulateBackpressureEveryNFrames) &&
        this.frameCounter % (opts.simulateBackpressureEveryNFrames || 999999) === 0;

      if (triggerBp || delay > 0) {
        this.encodeQueueSize += triggerBp ? 6 : 1;
        if (this.encodeQueueSize > 3) {
          metrics.backpressureHits += 1;
        }
        const p = new Promise<void>((resolve) => {
          globalThis.setTimeout(() => {
            this.encodeQueueSize = Math.max(0, this.encodeQueueSize - (triggerBp ? 6 : 1));
            emitChunk();
            resolve();
          }, Math.max(10, delay));
        });
        this.pendingPromises.push(p);
      } else {
        emitChunk();
      }
    }

    async flush() {
      if (this.state === 'closed') {
        metrics.postCloseCalls += 1;
        throw new Error('flush called on closed VideoEncoder');
      }
      await Promise.all(this.pendingPromises);
      this.pendingPromises.length = 0;
      metrics.flushBeforeFinalizeOrder.push('videoFlush');
    }

    close() {
      if (this.state !== 'closed') {
        this.state = 'closed';
        metrics.videoEncodersClosed += 1;
      }
    }
  }

  class MockAudioEncoder {
    public state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
    public encodeQueueSize = 0;
    private cfg: AudioEncoderConfig | null = null;
    private init: {
      output: (chunk: MockEncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void;
      error: (err: Error) => void;
    };
    private chunkCounter = 0;

    static async isConfigSupported(cfg: AudioEncoderConfig) {
      const isAac = cfg.codec.startsWith('mp4a');
      const isOpus = cfg.codec === 'opus';
      const validOpusRate = [48000, 24000, 16000, 12000, 8000].includes(cfg.sampleRate);
      const supported =
        (isAac && supportedContainers.mp4) ||
        (isOpus && supportedContainers.webm && validOpusRate);
      return { supported, config: cfg };
    }

    constructor(init: {
      output: (chunk: MockEncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void;
      error: (err: Error) => void;
    }) {
      this.init = init;
      metrics.audioEncodersCreated += 1;
    }

    configure(cfg: AudioEncoderConfig) {
      if (this.state === 'closed') {
        metrics.postCloseCalls += 1;
        throw new Error('Cannot configure closed AudioEncoder');
      }
      this.cfg = cfg;
      this.state = 'configured';
    }

    encode(data: MockAudioData) {
      if (this.state !== 'configured') {
        metrics.postCloseCalls += 1;
        throw new Error('AudioEncoder used after close');
      }
      this.chunkCounter += 1;
      const isFirst = this.chunkCounter === 1;
      const chunk = new MockEncodedAudioChunk({
        type: 'key',
        timestamp: data.timestamp,
        duration: Math.round((data.numberOfFrames / data.sampleRate) * 1_000_000),
        data: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]),
      });
      const meta: EncodedAudioChunkMetadata | undefined = isFirst
        ? {
            decoderConfig: {
              codec: this.cfg?.codec ?? 'mp4a.40.2',
              sampleRate: this.cfg?.sampleRate ?? 48000,
              numberOfChannels: this.cfg?.numberOfChannels ?? 2,
              description:
                this.cfg?.codec === 'opus'
                  ? new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64])
                  : new Uint8Array([0x11, 0x90]),
            },
          }
        : undefined;
      this.init.output(chunk, meta);
    }

    async flush() {
      if (this.state === 'closed') {
        metrics.postCloseCalls += 1;
        throw new Error('flush called on closed AudioEncoder');
      }
      metrics.flushBeforeFinalizeOrder.push('audioFlush');
    }

    close() {
      if (this.state !== 'closed') {
        this.state = 'closed';
        metrics.audioEncodersClosed += 1;
      }
    }
  }

  class MockMediaStream {
    private tracks: MediaStreamTrack[];
    constructor(tracks: MediaStreamTrack[]) {
      this.tracks = tracks;
    }
    getTracks() {
      return this.tracks;
    }
    getVideoTracks() {
      return this.tracks.filter((t) => t.kind === 'video');
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === 'audio');
    }
  }

  class MockMediaRecorder {
    public state: 'inactive' | 'recording' | 'paused' = 'inactive';
    public mimeType: string;
    public ondataavailable: ((ev: { data: Blob }) => void) | null = null;
    public onstart: (() => void) | null = null;
    public onstop: (() => void) | null = null;
    public onerror: ((ev: unknown) => void) | null = null;
    private intervalId: ReturnType<typeof setInterval> | null = null;

    static isTypeSupported(mime: string) {
      const mimes = opts.mediaRecorderMimes ?? [
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      ];
      return mimes.includes(mime);
    }

    constructor(_stream: unknown, mrOpts?: MediaRecorderOptions) {
      if (opts.mediaRecorderThrowWithBitrate && mrOpts?.videoBitsPerSecond) {
        throw new Error('Bitrate hint rejected');
      }
      metrics.mediaRecordersCreated += 1;
      this.mimeType = mrOpts?.mimeType || 'video/webm';
    }

    start() {
      this.state = 'recording';
      globalThis.setTimeout(() => {
        this.onstart?.();
      }, 5);
      this.intervalId = globalThis.setInterval(() => {
        if (this.state === 'recording') {
          this.ondataavailable?.({
            data: new Blob([new Uint8Array(1024).fill(0x55)], { type: this.mimeType }),
          });
        }
      }, 150);
    }

    requestData() {
      if (this.state === 'recording') {
        this.ondataavailable?.({
          data: new Blob([new Uint8Array(768).fill(0x77)], { type: this.mimeType }),
        });
      }
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      if (this.intervalId) {
        globalThis.clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this.ondataavailable?.({
        data: new Blob([new Uint8Array(1024).fill(0x99)], { type: this.mimeType }),
      });
      globalThis.setTimeout(() => {
        this.onstop?.();
      }, 5);
    }
  }

  g.window = fakeWin;
  g.document = {
    body,
    fonts: { ready: Promise.resolve(), load: async () => [] },
    createElement(tag: string) {
      if (tag === 'canvas') return new MockCanvas();
      if (tag === 'a') {
        return {
          href: '',
          download: '',
          click() {},
          remove() {},
        };
      }
      return {};
    },
  };
  Object.defineProperty(g, 'navigator', {
    configurable: true,
    value: {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      hardwareConcurrency: 8,
    },
  });
  g.AudioContext = MockAudioContext;
  g.OfflineAudioContext = MockOfflineAudioContext;
  g.VideoFrame = MockVideoFrame;
  g.AudioData = MockAudioData;
  g.EncodedVideoChunk = MockEncodedVideoChunk;
  g.EncodedAudioChunk = MockEncodedAudioChunk;
  g.VideoEncoder = MockVideoEncoder;
  g.AudioEncoder = MockAudioEncoder;
  g.MediaStream = MockMediaStream;
  g.MediaRecorder = MockMediaRecorder;

  resetExportCapabilitiesCache();
}

function buildQuizSlides(count: number): QuestionSlide[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `slide-${idx + 1}`,
    badgeText: `سؤال ${idx + 1}`,
    question: `ما هي عاصمة الدولة رقم ${idx + 1} في المسابقة السريعة؟`,
    options: ['الرياض', 'القاهرة', 'عمّان', 'الرباط'] as [string, string, string, string],
    correctIndex: (idx % 4) as 0 | 1 | 2 | 3,
    explanationText: 'إجابة تعليمية واضحة ومباشرة.',
  }));
}

function buildTiming(thinkingDuration: number, revealDuration = 2, stagger = 0.25): TimingSettings {
  return {
    ...DEFAULT_TIMING,
    questionReadDelay: 0.4,
    optionStaggerDelay: stagger,
    thinkingDuration,
    suspenseDuration: 0.8,
    revealHoldDuration: revealDuration,
    transitionGap: 0.2,
  };
}

function buildTemplate(aspectRatio: '9:16' | '16:9' = '9:16'): TemplateSettings {
  return {
    ...DEFAULT_TEMPLATE,
    aspectRatio,
    showIntroHook: false,
    backgroundType: 'color',
    solidBgColor: '#0f172a',
  };
}

async function readBlobHead(blob: Blob, bytes = 12): Promise<Uint8Array> {
  const buf = await blob.slice(0, bytes).arrayBuffer();
  return new Uint8Array(buf);
}

// ============================================================================
// Run All 14 Scenarios
// ============================================================================

async function runAllTests() {
  console.log('▶ Starting Shorts Quiz Studio Phase 1 Export Hardening Verification...');

  // --------------------------------------------------------------------------
  // Test 0: Pure Capability Helpers, Dimensions, MIME, Error Formatting
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m);
    const d720p = computeScaledDimensions(1080, 1920, '720p');
    assert.deepEqual(d720p, { width: 720, height: 1280 });
    const d720Land = computeScaledDimensions(1920, 1080, '720p');
    assert.deepEqual(d720Land, { width: 1280, height: 720 });
    const d1080p = computeScaledDimensions(1080, 1920, '1080p');
    assert.deepEqual(d1080p, { width: 1080, height: 1920 });

    assert.equal(EXPORT_QUALITY_TIERS.economy.preferredResolution, '720p');
    assert.equal(EXPORT_QUALITY_TIERS.balanced.preferredResolution, '1080p');
    assert.equal(EXPORT_QUALITY_TIERS.max.preferredResolution, '1080p');

    const plansMax = resolveExportDimensionPlans(1080, 1920, 'auto', 'max', {
      isMobile: true,
      supports1080pWebCodecs: true,
    });
    assert.equal(plansMax[0].label, '1080p');
    assert.equal(plansMax[1].label, '720p');

    const plansEcon = resolveExportDimensionPlans(1080, 1920, 'auto', 'economy', {
      isMobile: true,
      supports1080pWebCodecs: true,
    });
    assert.equal(plansEcon.length, 1);
    assert.equal(plansEcon[0].label, '720p');

    const caps = await probeExportCapabilities(true);
    assert.equal(caps.isAndroid, true);
    assert.equal(caps.supportsMp4WebCodecs, true);
    assert.equal(caps.supportsWebmWebCodecs, true);
    assert.equal(caps.supports1080pWebCodecs, true);

    assert.match(formatExportErrorMessage(new Error('Out of memory OOM')), /ذاكرة الجهاز/);
    assert.match(formatExportErrorMessage(new Error('AbortError: cancelled')), /إلغاء/);

    // Timer/ETA helpers
    assert.equal(estimateRemainingMs(5000, 0.5, 'rendering'), 5000);
    assert.equal(estimateRemainingMs(100, 0.02, 'rendering'), null);
    assert.equal(formatDurationCompact(65_000), '1:05 د');
    console.log('✓ Test 0: Capability Probing, Quality Tiers & Helpers');
  }

  // --------------------------------------------------------------------------
  // Test 1 & 4 & 8: 15s Video (MP4, 1080p, With Audio, Valid ftyp Header)
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m);
    const slides = buildQuizSlides(3); // ~15.45s
    const timing = buildTiming(2, 1.5, 0.2);
    const template = buildTemplate('9:16');
    const audio: AudioSettings = { ...DEFAULT_AUDIO };
    const ac = new AbortController();

    const res = await exportQuizVideo(slides, template, timing, audio, () => {}, ac.signal, {
      formatPreference: 'mp4',
      resolutionPreference: '1080p',
      qualityTier: 'balanced',
      includeAudio: true,
    });

    assert.equal(res.extension, 'mp4');
    assert.equal(res.mimeType, 'video/mp4');
    assert.equal(res.engine, 'webcodecs');
    assert.equal(res.width, 1080);
    assert.equal(res.height, 1920);
    assert.equal(res.hasAudio, true);
    assert.equal(res.usedFallback, false);
    assert.ok(res.blob.size > 1000, 'MP4 blob should be non-empty');

    const head = await readBlobHead(res.blob, 12);
    const boxType = String.fromCharCode(head[4], head[5], head[6], head[7]);
    assert.equal(boxType, 'ftyp', 'MP4 output must begin with ISO BMFF ftyp box');

    assert.equal(m.videoFramesCreated, m.videoFramesClosed, 'Every VideoFrame must be closed');
    assert.equal(m.audioDataCreated, m.audioDataClosed, 'Every AudioData must be closed');
    assert.equal(m.videoEncodersCreated, m.videoEncodersClosed, 'VideoEncoder must be closed');
    assert.equal(m.audioEncodersCreated, m.audioEncodersClosed, 'AudioEncoder must be closed');
    assert.equal(m.postCloseCalls, 0, 'Never call encoders after closing');
    assert.ok(m.flushBeforeFinalizeOrder.includes('videoFlush'));
    assert.ok(m.flushBeforeFinalizeOrder.includes('audioFlush'));
    console.log(
      `✓ Test 1 & 4 & 8: 15s MP4 1080p w/ Audio (${res.blob.size} bytes, ${m.videoFramesCreated} frames, 0 leaks)`
    );
  }

  // --------------------------------------------------------------------------
  // Test 2 & 5: 60s (1 minute) WebM Export + 44.1kHz -> 48kHz Opus Resampling + Backpressure
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m, {
      audioSampleRate: 44100, // Force Opus resampling path!
      simulateBackpressureEveryNFrames: 250,
    });
    const slides = buildQuizSlides(6); // ~60s
    const timing = buildTiming(7, 1.5, 0.2);
    const template = buildTemplate('9:16');
    const audio: AudioSettings = { ...DEFAULT_AUDIO };
    const ac = new AbortController();

    const res = await exportQuizVideo(slides, template, timing, audio, () => {}, ac.signal, {
      formatPreference: 'webm',
      resolutionPreference: '720p',
      qualityTier: 'economy',
      includeAudio: true,
    });

    assert.equal(res.extension, 'webm');
    assert.equal(res.mimeType, 'video/webm');
    assert.equal(res.engine, 'webcodecs');
    assert.equal(res.width, 720);
    assert.equal(res.height, 1280);
    assert.equal(res.hasAudio, true);

    const head = await readBlobHead(res.blob, 4);
    assert.deepEqual(Array.from(head), [0x1a, 0x45, 0xdf, 0xa3], 'WebM must start with EBML header');
    assert.ok(m.backpressureHits > 0, 'Backpressure monitor must trigger on high encodeQueueSize');
    assert.equal(m.videoFramesCreated, m.videoFramesClosed);
    assert.equal(m.audioDataCreated, m.audioDataClosed);
    assert.equal(m.postCloseCalls, 0);
    console.log(
      `✓ Test 2 & 5 & 6: 60s WebM 720p w/ Opus Resampling + Backpressure (${res.blob.size} bytes, bp hits=${m.backpressureHits})`
    );
  }

  // --------------------------------------------------------------------------
  // Test 3: 300s (5 minutes) Export Stability & Memory Hygiene (9000 frames @ 30fps)
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m);
    const slides = buildQuizSlides(15); // ~300s (5 minutes)
    const timing = buildTiming(16, 2.0, 0.3);
    const template = buildTemplate('16:9');
    const audio: AudioSettings = { ...DEFAULT_AUDIO };
    const ac = new AbortController();

    let maxProgressSeen = 0;
    const res = await exportQuizVideo(
      slides,
      template,
      timing,
      audio,
      (p) => {
        maxProgressSeen = Math.max(maxProgressSeen, p.progress);
      },
      ac.signal,
      {
        formatPreference: 'mp4',
        resolutionPreference: '1080p',
        qualityTier: 'max',
        includeAudio: true,
      }
    );

    assert.equal(res.extension, 'mp4');
    assert.equal(res.width, 1920);
    assert.equal(res.height, 1080);
    assert.ok(res.durationSec >= 295, `Expected ~300s duration, got ${res.durationSec}`);
    assert.ok(m.videoFramesCreated >= 8800, `Expected >=8800 frames, got ${m.videoFramesCreated}`);
    assert.equal(m.videoFramesCreated, m.videoFramesClosed);
    assert.equal(m.audioDataCreated, m.audioDataClosed);
    assert.equal(m.videoEncodersCreated, m.videoEncodersClosed);
    assert.equal(m.audioEncodersCreated, m.audioEncodersClosed);
    assert.equal(m.postCloseCalls, 0);
    assert.ok(maxProgressSeen >= 0.9);
    console.log(
      `✓ Test 3 & 7: 300s (5 min) 1080p 16:9 MP4 (${m.videoFramesCreated} frames, ${res.blob.size} bytes, 0 leaks)`
    );
  }

  // --------------------------------------------------------------------------
  // Test 9: Without Audio (includeAudio: false)
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m);
    const slides = buildQuizSlides(1);
    const timing = buildTiming(2, 1.5, 0.2);
    const template = buildTemplate('9:16');
    const ac = new AbortController();

    const res = await exportQuizVideo(
      slides,
      template,
      timing,
      DEFAULT_AUDIO,
      () => {},
      ac.signal,
      {
        formatPreference: 'mp4',
        resolutionPreference: '720p',
        includeAudio: false,
      }
    );

    assert.equal(res.hasAudio, false);
    assert.equal(m.audioEncodersCreated, 0);
    assert.equal(m.audioDataCreated, 0);
    assert.equal(m.videoFramesCreated, m.videoFramesClosed);
    console.log('✓ Test 9: Export Without Audio (video-only MP4, 0 audio encoder instances)');
  }

  // --------------------------------------------------------------------------
  // Test 10: Safe Cancellation Mid-Export (AbortController + Session Manager)
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m, { webCodecsDelayMs: 12 });
    const slides = buildQuizSlides(2);
    const timing = buildTiming(4, 1.5, 0.2);
    const template = buildTemplate('9:16');

    const sess = exportSessionManager.beginSession('proj-cancel');
    assert.equal(exportSessionManager.hasActiveSession('proj-cancel'), true);

    globalThis.setTimeout(() => {
      exportSessionManager.cancelSession('proj-cancel', sess.sessionId);
    }, 60);

    await assert.rejects(
      () =>
        exportQuizVideo(
          slides,
          template,
          timing,
          DEFAULT_AUDIO,
          () => {},
          sess.controller.signal,
          { formatPreference: 'mp4', resolutionPreference: '720p', includeAudio: true }
        ),
      /إلغاء/
    );

    assert.equal(exportSessionManager.hasActiveSession('proj-cancel'), false);
    assert.equal(m.videoFramesCreated, m.videoFramesClosed);
    assert.equal(m.audioDataCreated, m.audioDataClosed);
    assert.equal(m.videoEncodersCreated, m.videoEncodersClosed);
    assert.equal(m.audioEncodersCreated, m.audioEncodersClosed);
    assert.equal(m.postCloseCalls, 0);
    console.log('✓ Test 10: Safe Mid-Export Cancellation & Complete Cleanup');
  }

  // --------------------------------------------------------------------------
  // Test 11: WebCodecs Failure -> Hardened MediaRecorder Fallback (incl. suspended AudioContext)
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m, {
      failWebCodecsOnConfigure: true,
      audioContextState: 'suspended',
      mediaRecorderThrowWithBitrate: true, // Also verifies bitrate-free retry in MediaRecorder!
    });
    const slides = buildQuizSlides(1);
    const timing = buildTiming(0.5, 0.4, 0.1);
    const template = buildTemplate('9:16');
    const ac = new AbortController();

    const res = await exportQuizVideo(
      slides,
      template,
      timing,
      DEFAULT_AUDIO,
      () => {},
      ac.signal,
      {
        formatPreference: 'auto',
        resolutionPreference: '720p',
        qualityTier: 'economy',
        includeAudio: true,
      }
    );

    assert.equal(res.engine, 'mediarecorder');
    assert.equal(res.usedFallback, true);
    assert.ok(Boolean(res.fallbackReason), 'Fallback reason should be disclosed');
    assert.ok(res.blob.size >= 512);
    assert.equal(
      m.mediaRecorderStoppedTracks,
      m.mediaRecorderTotalTracks,
      'All MediaStreamTracks must be stopped'
    );
    assert.equal(m.oscillatorsStarted, m.oscillatorsStopped, 'Keep-alive oscillator must stop');
    assert.equal(m.domNodesAdded, m.domNodesRemoved, 'Temporary capture canvas must be removed');
    soundEngine.stopAllSfxAndVoice();
    console.log(
      `✓ Test 11: WebCodecs Failure -> MediaRecorder Fallback + Suspended AudioContext Recovery (${res.blob.size} bytes)`
    );
  }

  // --------------------------------------------------------------------------
  // Test 12 & 14: Android Chunked Save Bridge, Failure Abort, and Native Share
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m);
    const g = globalThis as Record<string, unknown>;

    const uploadState = new Map<
      string,
      { fileName: string; mimeType: string; bytes: number; aborted: boolean }
    >();
    let seq = 0;
    let failOnChunkIndex = -1;
    let lastShareText = '';

    g.AndroidNativeBridge = {
      beginSaveFile(fileName: string, mimeType: string) {
        seq += 1;
        const id = `up_${seq}`;
        uploadState.set(id, { fileName, mimeType, bytes: 0, aborted: false });
        return id;
      },
      appendSaveChunk(uploadId: string, base64Chunk: string) {
        const entry = uploadState.get(uploadId);
        if (!entry) return false;
        if (failOnChunkIndex >= 0) {
          failOnChunkIndex -= 1;
          if (failOnChunkIndex === 0) return false;
        }
        entry.bytes += Buffer.from(base64Chunk, 'base64').length;
        return true;
      },
      abortSaveFile(uploadId: string) {
        const entry = uploadState.get(uploadId);
        if (entry) entry.aborted = true;
      },
      finishSaveFile(uploadId: string) {
        const entry = uploadState.get(uploadId);
        if (!entry || entry.aborted) {
          return JSON.stringify({ ok: false, error: 'aborted' });
        }
        return JSON.stringify({
          ok: true,
          fileName: entry.fileName,
          savedLocation: 'Movies/ShortsQuizStudio',
          contentUri: 'content://media/external/video/media/991',
        });
      },
      finishShareFileWithText(uploadId: string, extraText: string) {
        const entry = uploadState.get(uploadId);
        if (!entry || entry.aborted) {
          return JSON.stringify({ ok: false, error: 'share aborted' });
        }
        lastShareText = extraText;
        return JSON.stringify({ ok: true });
      },
    };

    // MIME & Extension matching
    assert.equal(normalizeExportMime('', 'clip.MP4'), 'video/mp4');
    assert.equal(ensureMatchingFileName('quiz.webm', 'video/mp4'), 'quiz.mp4');
    assert.equal(ensureMatchingFileName('cover.png', 'image/jpeg'), 'cover.jpg');

    // Large 1.2 MB blob -> multi-chunk transfer (5 chunks of <=256KB)
    const largeBytes = new Uint8Array(1_200_000).fill(0x41);
    const largeBlob = new Blob([largeBytes], { type: 'video/mp4' });
    let progressCalls = 0;
    const saveOk = await saveOrDownloadBlob(largeBlob, 'test-video.webm', 'video/mp4', {
      onProgress: () => {
        progressCalls += 1;
      },
    });
    assert.equal(saveOk.ok, true);
    assert.equal(saveOk.savedNatively, true);
    assert.equal(saveOk.fileName, 'test-video.mp4');
    assert.equal(saveOk.savedLocation, 'Movies/ShortsQuizStudio');
    assert.equal(saveOk.contentUri, 'content://media/external/video/media/991');
    assert.equal(uploadState.get('up_1')?.bytes, 1_200_000);
    assert.ok(progressCalls >= 4);

    // Simulated chunk write failure -> must invoke abortSaveFile & report error
    failOnChunkIndex = 2;
    const saveFail = await saveOrDownloadBlob(largeBlob, 'broken.mp4', 'video/mp4');
    assert.equal(saveFail.ok, false);
    assert.equal(uploadState.get('up_2')?.aborted, true, 'abortSaveFile must clean up failed upload');

    // Native share
    failOnChunkIndex = -1;
    const shared = await shareBlobNatively(
      largeBlob,
      'share-quiz.mp4',
      'video/mp4',
      'Quiz Title',
      'وصف الاختبار'
    );
    assert.equal(shared, true);
    assert.equal(lastShareText, 'وصف الاختبار');
    assert.equal(uploadState.get('up_3')?.bytes, 1_200_000);
    delete g.AndroidNativeBridge;
    console.log('✓ Test 12 & 14: Android Chunked Save, Failure Abort Cleanup & Native Share');
  }

  // --------------------------------------------------------------------------
  // Test 13: Concurrent Session Prevention + Retry After Failure
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m, { failWebCodecsOnConfigure: true });
    // Force MediaRecorder unavailable too for first failing attempt
    const g = globalThis as Record<string, unknown>;
    const savedMR = g.MediaRecorder;
    g.MediaRecorder = undefined;

    const slides = buildQuizSlides(1);
    const timing = buildTiming(1, 1, 0.2);
    const template = buildTemplate('9:16');

    const s1 = exportSessionManager.beginSession('proj-retry');
    const s2 = exportSessionManager.beginSession('proj-retry'); // Must abort s1 cleanly!
    assert.equal(s1.controller.signal.aborted, true, 'New session must abort older project session');
    assert.equal(s1.isCurrent(), false);
    assert.equal(s2.isCurrent(), true);

    await assert.rejects(() =>
      exportQuizVideo(
        slides,
        template,
        timing,
        DEFAULT_AUDIO,
        () => {},
        s2.controller.signal
      )
    );
    exportSessionManager.finishSession('proj-retry', s2.sessionId);
    assert.equal(exportSessionManager.hasActiveSession('proj-retry'), false);

    // Now retry with working WebCodecs
    g.MediaRecorder = savedMR;
    installMockEnvironment(m); // resets failure flags
    const s3 = exportSessionManager.beginSession('proj-retry');
    const okRetry = await exportQuizVideo(
      slides,
      template,
      timing,
      DEFAULT_AUDIO,
      () => {},
      s3.controller.signal
    );
    exportSessionManager.finishSession('proj-retry', s3.sessionId);
    assert.equal(okRetry.extension, 'mp4');
    assert.equal(exportSessionManager.hasActiveSession('proj-retry'), false);
    console.log('✓ Test 13: Concurrent Session Lock & Clean Retry After Failure');
  }

  // --------------------------------------------------------------------------
  // Test 1080p -> 720p automatic fallback inside WebCodecs
  // --------------------------------------------------------------------------
  {
    const m = createFreshMetrics();
    installMockEnvironment(m, { failWebCodecs1080pOnly: true });
    const slides = buildQuizSlides(1);
    const timing = buildTiming(1, 1, 0.2);
    const template = buildTemplate('9:16');
    const ac = new AbortController();

    const res = await exportQuizVideo(
      slides,
      template,
      timing,
      DEFAULT_AUDIO,
      () => {},
      ac.signal,
      {
        formatPreference: 'mp4',
        resolutionPreference: '1080p',
        qualityTier: 'balanced',
        includeAudio: false,
      }
    );

    assert.equal(res.engine, 'webcodecs');
    assert.equal(res.width, 720);
    assert.equal(res.height, 1280);
    assert.equal(res.usedFallback, true);
    assert.match(res.fallbackReason || '', /720p/);
    console.log('✓ Test Extra: WebCodecs 1080p -> 720p Graceful Resolution Fallback');
  }

  console.log('\n✅ All Phase 1 Export Hardening automated scenarios passed!');
}

runAllTests().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
