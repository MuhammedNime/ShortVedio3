import {
  ArrayBufferTarget as Mp4ArrayBufferTarget,
  Muxer as Mp4Muxer,
} from 'mp4-muxer';
import {
  ArrayBufferTarget as WebmArrayBufferTarget,
  Muxer as WebmMuxer,
} from 'webm-muxer';
import { soundEngine } from '../audio/soundEngine';
import {
  AudioSettings,
  QuestionSlide,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
  getCanvasDimensions,
  getIntroHookDuration,
  getTotalDuration,
} from '../types/quiz';
import {
  TimelineSoundEvent,
  clearRendererCaches,
  ensureQuizFontsLoaded,
  preloadTemplateBackground,
  preloadTimerVideo,
  renderQuizFrame,
} from './quizRenderer';
import {
  DimensionsPlan,
  ExportQualityTier,
  MimeCandidate,
  getPreferredMediaRecorderMimeTypes,
  isMobileBrowser,
  probeExportCapabilities,
  resolveExportDimensionPlans,
} from './exportCapabilities';

export type ExportFormatPreference = 'auto' | 'webm' | 'mp4';
export type ExportResolutionPreference = 'auto' | '720p' | '1080p';

export interface ExportVideoOptions {
  formatPreference?: ExportFormatPreference;
  resolutionPreference?: ExportResolutionPreference;
  qualityTier?: ExportQualityTier;
  includeAudio?: boolean;
  getPreviewCanvas?: () => HTMLCanvasElement | null;
}

export interface ExportProgress {
  progress: number;
  currentTime: number;
  totalDuration: number;
  statusText: string;
  stage?: 'preparing' | 'rendering' | 'finalizing';
  engineLabel?: string;
  fallbackNotice?: string;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  engine: 'webcodecs' | 'mediarecorder';
  engineLabel: string;
  codecLabel: string;
  width: number;
  height: number;
  fps: number;
  qualityTier: ExportQualityTier;
  hasAudio: boolean;
  usedFallback: boolean;
  fallbackReason?: string;
  durationSec: number;
}

interface ScheduledTimelineAudio {
  time: number;
  maxDuration?: number;
  event: TimelineSoundEvent;
}

const DEFAULT_EXPORT_FPS = 30;
const OPUS_VALID_RATES = [48000, 24000, 16000, 12000, 8000] as const;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function drawScaledPreview(
  sourceCanvas: HTMLCanvasElement,
  previewCanvas?: HTMLCanvasElement | null
): void {
  if (!previewCanvas || !previewCanvas.isConnected) return;
  const pCtx = previewCanvas.getContext('2d');
  if (!pCtx) return;
  try {
    pCtx.drawImage(sourceCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
  } catch {
    // ignore preview blit errors
  }
}

function releaseCanvas(canvas: HTMLCanvasElement | null | undefined, removeFromDom = false): void {
  if (!canvas) return;
  try {
    if (removeFromDom && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  } catch {
    // ignore DOM removal issues
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // ignore canvas resize issues
  }
}

async function resampleAudioBuffer(
  source: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  if (source.sampleRate === targetSampleRate) {
    return source;
  }
  const channels = Math.min(2, Math.max(1, source.numberOfChannels));
  const targetLength = Math.max(1, Math.ceil((source.length / source.sampleRate) * targetSampleRate));

  if (typeof OfflineAudioContext !== 'undefined') {
    try {
      const offline = new OfflineAudioContext(channels, targetLength, targetSampleRate);
      const bufferSrc = offline.createBufferSource();
      bufferSrc.buffer = source;
      bufferSrc.connect(offline.destination);
      bufferSrc.start(0);
      return await offline.startRendering();
    } catch {
      // fall back to deterministic linear resampling below
    }
  }

  const ratio = source.sampleRate / targetSampleRate;
  const outChannels: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const srcData = source.getChannelData(ch);
    const dstData = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const srcPos = i * ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = srcData[Math.min(idx, srcData.length - 1)] ?? 0;
      const s1 = srcData[Math.min(idx + 1, srcData.length - 1)] ?? s0;
      dstData[i] = s0 + (s1 - s0) * frac;
    }
    outChannels.push(dstData);
  }

  // Construct minimal AudioBuffer-compatible object when OfflineAudioContext is unavailable
  return {
    sampleRate: targetSampleRate,
    length: targetLength,
    duration: targetLength / targetSampleRate,
    numberOfChannels: channels,
    getChannelData: (channel: number) => outChannels[Math.min(channel, outChannels.length - 1)],
    copyFromChannel: (destination: Float32Array, channelNumber: number, bufferOffset = 0) => {
      const ch = outChannels[Math.min(channelNumber, outChannels.length - 1)];
      destination.set(ch.subarray(bufferOffset, bufferOffset + destination.length));
    },
    copyToChannel: (srcArr: Float32Array, channelNumber: number, bufferOffset = 0) => {
      const ch = outChannels[Math.min(channelNumber, outChannels.length - 1)];
      ch.set(srcArr, bufferOffset);
    },
  } as unknown as AudioBuffer;
}

function buildScheduledAudioPlan(
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template: TemplateSettings,
  totalDuration: number
): {
  events: ScheduledTimelineAudio[];
  speechIntervals: Array<{ start: number; end: number }>;
} {
  const events: ScheduledTimelineAudio[] = [];
  const speechIntervals: Array<{ start: number; end: number }> = [];

  const schedules = computeProjectTimeline(slides, timing, audio, template);
  const introDur = getIntroHookDuration(template, timing);
  if (introDur > 0 && slides.length > 0) {
    const firstSlideStart = schedules[0]?.startTime ?? introDur;
    const introBound = Math.max(0.15, firstSlideStart - 0.02);
    events.push({
      time: 0,
      maxDuration: introBound,
      event: { type: 'introHook', slideIndex: 0 },
    });
    if (template.introHookAudio?.dataUrl && (template.introHookAudio.duration ?? 0) > 0.2) {
      speechIntervals.push({
        start: 0,
        end: Math.min(introBound, template.introHookAudio.duration),
      });
    }
  }

  const urgentThreshold = Math.max(1, Math.min(10, template?.timerUrgentThreshold ?? 3));

  for (let idx = 0; idx < schedules.length; idx++) {
    const sched = schedules[idx];
    const sIdx = sched.slideIndex;
    const slide = slides[sIdx];
    const base = sched.startTime;
    const nextSlideStart =
      idx < schedules.length - 1 ? schedules[idx + 1].startTime : totalDuration;

    const tQ = base + sched.tQuestionStart;
    const opt0Time = base + sched.tOptionStarts[0];
    const tThink = base + sched.tThinkingStart;
    const tSus = base + sched.tSuspenseStart;
    const tReveal = base + sched.tRevealStart;
    const optCount =
      slide?.slideType === 'trueFalse' || slide?.slideType === 'versus'
        ? 2
        : slide?.slideType === 'clues'
          ? 3
          : 4;
    const hasAnyOptVoice = Array.from({ length: optCount }).some((_, oi) =>
      Boolean(slide?.voiceover?.options?.[oi]?.dataUrl)
    );

    const qBound = hasAnyOptVoice
      ? Math.max(0.15, opt0Time - tQ - 0.02)
      : Math.max(0.15, tThink - tQ - 0.03);
    events.push({
      time: tQ,
      maxDuration: slide?.voiceover?.question?.dataUrl
        ? Math.min(nextSlideStart - tQ - 0.02, qBound)
        : Math.max(0.15, opt0Time - tQ - 0.02),
      event: { type: 'questionEnter', slideIndex: sIdx },
    });
    if (slide?.voiceover?.question?.dataUrl && slide.voiceover.question.duration > 0.2) {
      speechIntervals.push({
        start: tQ,
        end: tQ + Math.min(slide.voiceover.question.duration, qBound),
      });
    }

    let optVoiceCursor = opt0Time;
    for (let oIdx = 0; oIdx < optCount; oIdx++) {
      const tOpt = base + sched.tOptionStarts[oIdx];
      let groupEndBoundary = tThink;
      for (let k = oIdx + 1; k < optCount; k++) {
        const cand = base + sched.tOptionStarts[k];
        if (cand > tOpt + 0.01) {
          groupEndBoundary = cand;
          break;
        }
      }
      const sameAsPrev =
        oIdx > 0 && Math.abs(sched.tOptionStarts[oIdx] - sched.tOptionStarts[oIdx - 1]) < 0.01;
      const isGroupedSameStart =
        oIdx < optCount - 1 && Math.abs(sched.tOptionStarts[oIdx + 1] - tOpt) < 0.01;
      const oClip = slide?.voiceover?.options?.[oIdx];

      if (oClip?.dataUrl) {
        const scheduledStart =
          isGroupedSameStart || sameAsPrev ? Math.max(tOpt, optVoiceCursor) : tOpt;
        const maxBound = Math.max(scheduledStart + 0.15, groupEndBoundary - 0.02);
        if (scheduledStart < maxBound - 0.04) {
          const maxDur = Math.max(0.15, maxBound - scheduledStart);
          events.push({
            time: scheduledStart,
            maxDuration: maxDur,
            event: { type: 'optionEnter', slideIndex: sIdx, optionIndex: oIdx },
          });
          const clipDur = oClip.duration > 0.05 ? oClip.duration : 1.0;
          if (clipDur > 0.2) {
            speechIntervals.push({
              start: scheduledStart,
              end: scheduledStart + Math.min(clipDur, maxDur),
            });
          }
          optVoiceCursor = Math.min(maxBound, scheduledStart + clipDur + 0.04);
        }
      } else if (!sameAsPrev) {
        events.push({
          time: tOpt,
          maxDuration: Math.max(0.15, groupEndBoundary - tOpt - 0.02),
          event: { type: 'optionEnter', slideIndex: sIdx, optionIndex: oIdx },
        });
      }
    }

    const totalTicks = Math.floor(timing.thinkingDuration);
    for (let sec = 0; sec < totalTicks; sec++) {
      const tickSecond = totalTicks - sec;
      const tTick = tThink + sec;
      events.push({
        time: tTick,
        maxDuration: Math.max(0.08, Math.min(0.88, tSus - tTick - 0.02)),
        event: {
          type: 'countdownTick',
          slideIndex: sIdx,
          tickSecond,
          urgent: tickSecond <= urgentThreshold,
        },
      });
    }

    const susDur = Math.max(0, timing.suspenseDuration ?? 0);
    if (susDur > 0) {
      events.push({
        time: tSus,
        maxDuration: Math.max(0.15, tReveal - tSus - 0.02),
        event: { type: 'suspense', slideIndex: sIdx },
      });
    }

    events.push({
      time: tReveal,
      maxDuration: Math.max(0.25, nextSlideStart - tReveal - 0.03),
      event: { type: 'correctReveal', slideIndex: sIdx },
    });
    if (slide?.voiceover?.answer?.dataUrl && slide.voiceover.answer.duration > 0.2) {
      speechIntervals.push({
        start: tReveal,
        end: Math.min(nextSlideStart - 0.02, tReveal + slide.voiceover.answer.duration),
      });
    }
  }

  events.sort((a, b) => a.time - b.time);
  return { events, speechIntervals };
}

export interface WebCodecsPlan {
  container: 'mp4' | 'webm';
  videoConfig: VideoEncoderConfig;
  webmVideoCodec?: 'V_VP8' | 'V_VP9';
  audioConfig: AudioEncoderConfig | null;
  webmAudioCodec?: 'A_OPUS';
  audioBufferForPlan: AudioBuffer | null;
  mimeType: string;
  codecLabel: string;
}

export async function probeWebCodecsPlans(
  containerOrder: Array<'mp4' | 'webm'>,
  dims: DimensionsPlan,
  audioBuffer: AudioBuffer | null,
  requireAudio: boolean
): Promise<WebCodecsPlan[]> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof VideoFrame === 'undefined' ||
    typeof VideoEncoder.isConfigSupported !== 'function'
  ) {
    return [];
  }
  if (
    requireAudio &&
    (typeof AudioEncoder === 'undefined' ||
      typeof AudioData === 'undefined' ||
      typeof AudioEncoder.isConfigSupported !== 'function')
  ) {
    return [];
  }

  const plans: WebCodecsPlan[] = [];
  const rawSampleRate = audioBuffer ? audioBuffer.sampleRate : 48000;
  const numChannels = audioBuffer ? Math.min(2, Math.max(1, audioBuffer.numberOfChannels)) : 2;

  let cachedAacConfig: AudioEncoderConfig | null | undefined;
  const resolveAacConfig = async (): Promise<AudioEncoderConfig | null> => {
    if (!requireAudio || !audioBuffer) return null;
    if (cachedAacConfig !== undefined) return cachedAacConfig;
    const candidates: AudioEncoderConfig[] = [
      {
        codec: 'mp4a.40.2',
        sampleRate: rawSampleRate,
        numberOfChannels: numChannels,
        bitrate: 128_000,
      },
      {
        codec: 'mp4a.40.2',
        sampleRate: rawSampleRate,
        numberOfChannels: numChannels,
        bitrate: 96_000,
      },
      {
        codec: 'mp4a.40.2',
        sampleRate: rawSampleRate,
        numberOfChannels: numChannels,
      },
    ];
    for (const cfg of candidates) {
      try {
        const res = await AudioEncoder.isConfigSupported(cfg);
        if (res.supported) {
          cachedAacConfig = res.config ?? cfg;
          return cachedAacConfig;
        }
      } catch {
        // try next
      }
    }
    cachedAacConfig = null;
    return null;
  };

  let opusBuffer: AudioBuffer | null | undefined;
  let cachedOpusConfig: AudioEncoderConfig | null | undefined;
  const resolveOpusPlan = async (): Promise<{
    config: AudioEncoderConfig;
    buffer: AudioBuffer;
  } | null> => {
    if (!requireAudio || !audioBuffer) return null;
    if (cachedOpusConfig !== undefined) {
      return cachedOpusConfig && opusBuffer
        ? { config: cachedOpusConfig, buffer: opusBuffer }
        : null;
    }

    const isValidOpusRate = (OPUS_VALID_RATES as readonly number[]).includes(rawSampleRate);
    opusBuffer = isValidOpusRate ? audioBuffer : await resampleAudioBuffer(audioBuffer, 48000);
    const opusRate = opusBuffer.sampleRate;
    const opusChannels = Math.min(2, Math.max(1, opusBuffer.numberOfChannels));

    const candidates: AudioEncoderConfig[] = [
      {
        codec: 'opus',
        sampleRate: opusRate,
        numberOfChannels: opusChannels,
        bitrate: 128_000,
      },
      {
        codec: 'opus',
        sampleRate: opusRate,
        numberOfChannels: opusChannels,
      },
    ];
    for (const cfg of candidates) {
      try {
        const res = await AudioEncoder.isConfigSupported(cfg);
        if (res.supported) {
          cachedOpusConfig = res.config ?? cfg;
          return { config: cachedOpusConfig, buffer: opusBuffer };
        }
      } catch {
        // try next
      }
    }
    cachedOpusConfig = null;
    return null;
  };

  const seenKeys = new Set<string>();

  for (const container of containerOrder) {
    if (container === 'mp4') {
      const audioConfig = await resolveAacConfig();
      if (requireAudio && !audioConfig) {
        continue;
      }

      // Ordered by quality & broad Android/WebView H.264 compatibility (includes software fallback)
      const avcCandidates: Array<{
        codec: string;
        hardwareAcceleration?: HardwareAcceleration;
        label: string;
      }> =
        dims.label === '1080p'
          ? [
              { codec: 'avc1.640028', label: 'H.264 High L4.0' },
              { codec: 'avc1.4d002a', label: 'H.264 Main L4.2' },
              { codec: 'avc1.420028', label: 'H.264 Baseline L4.0' },
              { codec: 'avc1.42E01F', label: 'H.264 Constrained L3.1' },
              { codec: 'avc1.42001f', label: 'H.264 Baseline L3.1' },
              {
                codec: 'avc1.42E01F',
                hardwareAcceleration: 'prefer-software',
                label: 'H.264 Software',
              },
            ]
          : [
              { codec: 'avc1.4d002a', label: 'H.264 Main L4.2' },
              { codec: 'avc1.42E01F', label: 'H.264 Constrained L3.1' },
              { codec: 'avc1.640028', label: 'H.264 High L4.0' },
              { codec: 'avc1.42001f', label: 'H.264 Baseline L3.1' },
              {
                codec: 'avc1.42E01F',
                hardwareAcceleration: 'prefer-software',
                label: 'H.264 Software',
              },
            ];

      for (const cand of avcCandidates) {
        const cfg: VideoEncoderConfig = {
          codec: cand.codec,
          width: dims.width,
          height: dims.height,
          bitrate: dims.videoBitrate,
          framerate: dims.fps,
          avc: { format: 'avc' },
          ...(cand.hardwareAcceleration
            ? { hardwareAcceleration: cand.hardwareAcceleration }
            : {}),
        };
        try {
          const sup = await VideoEncoder.isConfigSupported(cfg);
          if (sup.supported) {
            const finalCfg = sup.config ? { ...cfg, ...sup.config, avc: { format: 'avc' as const } } : cfg;
            const key = `mp4|${finalCfg.codec}|${finalCfg.hardwareAcceleration ?? 'auto'}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              plans.push({
                container: 'mp4',
                videoConfig: finalCfg,
                audioConfig,
                audioBufferForPlan: audioConfig ? audioBuffer : null,
                mimeType: 'video/mp4',
                codecLabel: audioConfig ? `${cand.label} + AAC` : cand.label,
              });
            }
          }
        } catch {
          // try next codec
        }
      }
    } else {
      const opusResolved = await resolveOpusPlan();
      if (requireAudio && !opusResolved) {
        continue;
      }

      const webmCodecs: Array<{
        codec: string;
        muxerCodec: 'V_VP8' | 'V_VP9';
        hardwareAcceleration?: HardwareAcceleration;
        label: string;
      }> = [
        { codec: 'vp8', muxerCodec: 'V_VP8', label: 'VP8' },
        { codec: 'vp09.00.10.08', muxerCodec: 'V_VP9', label: 'VP9' },
        {
          codec: 'vp8',
          muxerCodec: 'V_VP8',
          hardwareAcceleration: 'prefer-software',
          label: 'VP8 Software',
        },
        {
          codec: 'vp09.00.10.08',
          muxerCodec: 'V_VP9',
          hardwareAcceleration: 'prefer-software',
          label: 'VP9 Software',
        },
      ];

      for (const wc of webmCodecs) {
        const cfg: VideoEncoderConfig = {
          codec: wc.codec,
          width: dims.width,
          height: dims.height,
          bitrate: dims.videoBitrate,
          framerate: dims.fps,
          ...(wc.hardwareAcceleration ? { hardwareAcceleration: wc.hardwareAcceleration } : {}),
        };
        try {
          const sup = await VideoEncoder.isConfigSupported(cfg);
          if (sup.supported) {
            const finalCfg = sup.config ? { ...cfg, ...sup.config } : cfg;
            const key = `webm|${finalCfg.codec}|${finalCfg.hardwareAcceleration ?? 'auto'}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              plans.push({
                container: 'webm',
                videoConfig: finalCfg,
                webmVideoCodec: wc.muxerCodec,
                audioConfig: opusResolved ? opusResolved.config : null,
                webmAudioCodec: opusResolved ? 'A_OPUS' : undefined,
                audioBufferForPlan: opusResolved ? opusResolved.buffer : null,
                mimeType: 'video/webm',
                codecLabel: opusResolved ? `${wc.label} + Opus` : wc.label,
              });
            }
          }
        } catch {
          // try next
        }
      }
    }
  }

  return plans;
}

async function encodeWithWebCodecsPlan(
  plan: WebCodecsPlan,
  baseWidth: number,
  baseHeight: number,
  dims: DimensionsPlan,
  qualityTier: ExportQualityTier,
  usedFallback: boolean,
  fallbackReason: string | undefined,
  totalDuration: number,
  sSlides: QuestionSlide[],
  sTemplate: TemplateSettings,
  timing: TimingSettings,
  sAudio: AudioSettings,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  getPreviewCanvas?: () => HTMLCanvasElement | null
): Promise<ExportResult> {
  if (signal.aborted) {
    throw new Error('تم إلغاء التصدير.');
  }

  const engineLabel = `WebCodecs · ${plan.container.toUpperCase()} (${dims.label})`;

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = baseWidth;
  renderCanvas.height = baseHeight;
  const renderCtx = renderCanvas.getContext('2d', { alpha: false });
  if (!renderCtx) {
    releaseCanvas(renderCanvas);
    throw new Error('تعذر تهيئة محرك الرسم.');
  }
  renderCtx.imageSmoothingEnabled = true;
  renderCtx.imageSmoothingQuality = 'high';

  const needsDownscale = dims.width !== baseWidth || dims.height !== baseHeight;
  const outputCanvas = needsDownscale ? document.createElement('canvas') : renderCanvas;
  if (needsDownscale) {
    outputCanvas.width = dims.width;
    outputCanvas.height = dims.height;
  }
  const outputCtx = needsDownscale ? outputCanvas.getContext('2d', { alpha: false }) : renderCtx;
  if (!outputCtx) {
    releaseCanvas(outputCanvas);
    releaseCanvas(renderCanvas);
    throw new Error('تعذر تهيئة طبقة التحجيم.');
  }
  outputCtx.imageSmoothingEnabled = true;
  outputCtx.imageSmoothingQuality = 'high';

  const audioBuffer = plan.audioBufferForPlan;
  const hasAudio = Boolean(plan.audioConfig && audioBuffer);
  const audioChannels = audioBuffer
    ? Math.min(2, Math.max(1, audioBuffer.numberOfChannels))
    : 2;

  let mp4Target: Mp4ArrayBufferTarget | null =
    plan.container === 'mp4' ? new Mp4ArrayBufferTarget() : null;
  let webmTarget: WebmArrayBufferTarget | null =
    plan.container === 'webm' ? new WebmArrayBufferTarget() : null;

  let mp4Muxer: Mp4Muxer<Mp4ArrayBufferTarget> | null =
    plan.container === 'mp4' && mp4Target
      ? new Mp4Muxer({
          target: mp4Target,
          video: {
            codec: 'avc',
            width: dims.width,
            height: dims.height,
            frameRate: dims.fps,
          },
          ...(hasAudio && audioBuffer
            ? {
                audio: {
                  codec: 'aac',
                  numberOfChannels: audioChannels,
                  sampleRate: audioBuffer.sampleRate,
                },
              }
            : {}),
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        })
      : null;

  let webmMuxer: WebmMuxer<WebmArrayBufferTarget> | null =
    plan.container === 'webm' && webmTarget
      ? new WebmMuxer({
          target: webmTarget,
          video: {
            codec: plan.webmVideoCodec ?? 'V_VP8',
            width: dims.width,
            height: dims.height,
            frameRate: dims.fps,
          },
          ...(hasAudio && audioBuffer
            ? {
                audio: {
                  codec: plan.webmAudioCodec ?? 'A_OPUS',
                  numberOfChannels: audioChannels,
                  sampleRate: audioBuffer.sampleRate,
                },
              }
            : {}),
          firstTimestampBehavior: 'offset',
        })
      : null;

  let fatalError: Error | null = null;
  let encodersClosed = false;
  let videoChunksEmitted = 0;
  let audioChunksEmitted = 0;
  let lastVideoOutputPerf = performance.now();
  let lastAudioOutputPerf = performance.now();

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (encodersClosed || fatalError || signal.aborted) return;
      videoChunksEmitted += 1;
      lastVideoOutputPerf = performance.now();
      try {
        if (mp4Muxer) {
          mp4Muxer.addVideoChunk(chunk, meta);
        } else if (webmMuxer) {
          webmMuxer.addVideoChunk(chunk, meta);
        }
      } catch (err) {
        if (!fatalError) {
          fatalError = err instanceof Error ? err : new Error('فشل دمج إطارات الفيديو.');
        }
      }
    },
    error: (err) => {
      if (!fatalError) {
        fatalError = err instanceof Error ? err : new Error('حدث خطأ في مشفر الفيديو.');
      }
    },
  });

  let audioEncoder: AudioEncoder | null = null;
  if (hasAudio && plan.audioConfig) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (encodersClosed || fatalError || signal.aborted) return;
        audioChunksEmitted += 1;
        lastAudioOutputPerf = performance.now();
        try {
          if (mp4Muxer) {
            mp4Muxer.addAudioChunk(chunk, meta);
          } else if (webmMuxer) {
            webmMuxer.addAudioChunk(chunk, meta);
          }
        } catch (err) {
          if (!fatalError) {
            fatalError = err instanceof Error ? err : new Error('فشل دمج مقاطع الصوت.');
          }
        }
      },
      error: (err) => {
        if (!fatalError) {
          fatalError = err instanceof Error ? err : new Error('حدث خطأ في مشفر الصوت.');
        }
      },
    });
  }

  const maxVideoQueue = isMobileBrowser() ? 3 : 5;
  const maxAudioQueue = 8;

  const waitForVideoBackpressure = async () => {
    let lastQueue = videoEncoder.encodeQueueSize;
    lastVideoOutputPerf = performance.now();
    while (videoEncoder.encodeQueueSize > maxVideoQueue) {
      if (signal.aborted) throw new Error('تم إلغاء التصدير.');
      if (fatalError) throw fatalError;
      if (videoEncoder.state !== 'configured') {
        throw new Error('توقف مشفر الفيديو بشكل غير متوقع.');
      }
      const curQueue = videoEncoder.encodeQueueSize;
      const nowP = performance.now();
      if (curQueue < lastQueue) {
        lastQueue = curQueue;
        lastVideoOutputPerf = nowP;
      } else if (nowP - lastVideoOutputPerf > 10_000) {
        throw new Error('توقف مشفر الفيديو عن الاستجابة.');
      }
      await sleepMs(8);
    }
  };

  const waitForAudioBackpressure = async () => {
    if (!audioEncoder) return;
    let lastQueue = audioEncoder.encodeQueueSize;
    lastAudioOutputPerf = performance.now();
    while (audioEncoder.encodeQueueSize > maxAudioQueue) {
      if (signal.aborted) throw new Error('تم إلغاء التصدير.');
      if (fatalError) throw fatalError;
      if (audioEncoder.state !== 'configured') {
        throw new Error('توقف مشفر الصوت بشكل غير متوقع.');
      }
      const curQueue = audioEncoder.encodeQueueSize;
      const nowP = performance.now();
      if (curQueue < lastQueue) {
        lastQueue = curQueue;
        lastAudioOutputPerf = nowP;
      } else if (nowP - lastAudioOutputPerf > 10_000) {
        throw new Error('توقف مشفر الصوت عن الاستجابة.');
      }
      await sleepMs(6);
    }
  };

  try {
    videoEncoder.configure(plan.videoConfig);
    if (audioEncoder && plan.audioConfig) {
      audioEncoder.configure(plan.audioConfig);
    }

    const audioSampleRate = audioBuffer ? audioBuffer.sampleRate : 48000;
    const maxAudioFrames = audioBuffer
      ? Math.min(audioBuffer.length, Math.max(1, Math.round(totalDuration * audioSampleRate)))
      : 0;
    const audioChunkFrames = 4096;
    let audioOffset = 0;

    const encodeAudioUpToTime = async (targetTimeSec: number) => {
      if (!audioEncoder || !audioBuffer || audioOffset >= maxAudioFrames) return;
      const targetSample = Math.min(
        maxAudioFrames,
        Math.ceil(targetTimeSec * audioSampleRate)
      );

      while (audioOffset < targetSample) {
        if (signal.aborted) throw new Error('تم إلغاء التصدير.');
        if (fatalError) throw fatalError;
        if (audioEncoder.state !== 'configured') {
          throw new Error('مشفر الصوت غير جاهز.');
        }

        await waitForAudioBackpressure();

        const count = Math.min(audioChunkFrames, maxAudioFrames - audioOffset);
        const planar = new Float32Array(count * audioChannels);
        for (let ch = 0; ch < audioChannels; ch++) {
          const chData = audioBuffer.getChannelData(ch);
          planar.set(chData.subarray(audioOffset, audioOffset + count), ch * count);
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: audioSampleRate,
          numberOfChannels: audioChannels,
          numberOfFrames: count,
          timestamp: Math.round((audioOffset / audioSampleRate) * 1_000_000),
          data: planar,
        });
        try {
          if (audioEncoder.state === 'configured' && !signal.aborted && !fatalError) {
            audioEncoder.encode(audioData);
          }
        } finally {
          audioData.close();
        }
        audioOffset += count;
      }
    };

    const totalFrames = Math.max(1, Math.ceil(totalDuration * dims.fps));
    const frameDurationUs = Math.round(1_000_000 / dims.fps);
    let lastProgressPerf = 0;
    let lastYieldPerf = performance.now();

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (signal.aborted) throw new Error('تم إلغاء التصدير.');
      if (fatalError) throw fatalError;
      if (videoEncoder.state !== 'configured') {
        throw new Error('مشفر الفيديو غير مهيأ.');
      }

      const frameTime = Math.min(totalDuration, frameIdx / dims.fps);

      // Interleave audio encoding alongside video timestamps to reduce muxer buffer RAM
      if (hasAudio) {
        await encodeAudioUpToTime(frameTime + 0.12);
      }

      await waitForVideoBackpressure();

      renderQuizFrame(renderCtx, frameTime, sSlides, sTemplate, timing, sAudio, false);

      if (needsDownscale) {
        outputCtx.drawImage(renderCanvas, 0, 0, dims.width, dims.height);
      }
      if (frameIdx % 2 === 0 || frameIdx === totalFrames - 1) {
        drawScaledPreview(outputCanvas, getPreviewCanvas?.());
      }

      const timestampUs = Math.round((frameIdx / dims.fps) * 1_000_000);
      const videoFrame = new VideoFrame(outputCanvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      });
      try {
        if (videoEncoder.state === 'configured' && !signal.aborted && !fatalError) {
          videoEncoder.encode(videoFrame, { keyFrame: frameIdx % (dims.fps * 2) === 0 });
        }
      } finally {
        videoFrame.close();
      }

      const nowPerf = performance.now();
      if (frameIdx === totalFrames - 1 || nowPerf - lastProgressPerf >= 100) {
        lastProgressPerf = nowPerf;
        const pctRatio = (frameIdx + 1) / totalFrames;
        onProgress({
          progress: 0.05 + 0.87 * pctRatio,
          currentTime: frameTime,
          totalDuration,
          statusText: `جارٍ تصدير الفيديو (${Math.round(pctRatio * 100)}%)`,
          stage: 'rendering',
          engineLabel,
          fallbackNotice: fallbackReason,
        });
      }

      if (nowPerf - lastYieldPerf >= 16) {
        lastYieldPerf = performance.now();
        await sleepMs(0);
      }
    }

    // Encode any trailing audio samples
    if (hasAudio) {
      await encodeAudioUpToTime(totalDuration + 0.5);
    }

    if (signal.aborted) throw new Error('تم إلغاء التصدير.');
    if (fatalError) throw fatalError;

    onProgress({
      progress: 0.94,
      currentTime: totalDuration,
      totalDuration,
      statusText: 'جارٍ إنهاء الترميز وتجميع ملف الفيديو...',
      stage: 'finalizing',
      engineLabel,
      fallbackNotice: fallbackReason,
    });

    const flushTasks: Promise<void>[] = [];
    if (videoEncoder.state === 'configured') {
      flushTasks.push(videoEncoder.flush());
    }
    if (audioEncoder && audioEncoder.state === 'configured') {
      flushTasks.push(audioEncoder.flush());
    }

    const flushTimeoutMs = Math.max(20_000, Math.min(45_000, Math.round(totalDuration * 150)));
    let flushTimerId = 0;
    try {
      await Promise.race([
        Promise.all(flushTasks),
        new Promise<never>((_, reject) => {
          flushTimerId = window.setTimeout(
            () => reject(new Error('انتهت مهلة إتمام ترميز الفيديو.')),
            flushTimeoutMs
          );
        }),
      ]);
    } finally {
      window.clearTimeout(flushTimerId);
    }

    if (signal.aborted) throw new Error('تم إلغاء التصدير.');
    if (fatalError) throw fatalError;
    if (videoChunksEmitted === 0) {
      throw new Error('لم يصدر مشفر الفيديو أي إطارات صالحة.');
    }
    if (hasAudio && audioChunksEmitted === 0) {
      throw new Error('لم يصدر مشفر الصوت أي بيانات صوتية.');
    }

    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize();
      const blob = new Blob([mp4Target.buffer], { type: 'video/mp4' });
      if (blob.size < 512) {
        throw new Error('نتج عن التصدير ملف فيديو فارغ.');
      }
      return {
        blob,
        mimeType: 'video/mp4',
        extension: 'mp4',
        engine: 'webcodecs',
        engineLabel,
        codecLabel: plan.codecLabel,
        width: dims.width,
        height: dims.height,
        fps: dims.fps,
        qualityTier,
        hasAudio,
        usedFallback,
        fallbackReason,
        durationSec: totalDuration,
      };
    }

    if (webmMuxer && webmTarget) {
      webmMuxer.finalize();
      const blob = new Blob([webmTarget.buffer], { type: 'video/webm' });
      if (blob.size < 512) {
        throw new Error('نتج عن التصدير ملف فيديو فارغ.');
      }
      return {
        blob,
        mimeType: 'video/webm',
        extension: 'webm',
        engine: 'webcodecs',
        engineLabel,
        codecLabel: plan.codecLabel,
        width: dims.width,
        height: dims.height,
        fps: dims.fps,
        qualityTier,
        hasAudio,
        usedFallback,
        fallbackReason,
        durationSec: totalDuration,
      };
    }

    throw new Error('تعذر تهيئة حاوية الفيديو.');
  } finally {
    encodersClosed = true;
    try {
      if (videoEncoder.state !== 'closed') {
        videoEncoder.close();
      }
    } catch {
      // ignore
    }
    if (audioEncoder) {
      try {
        if (audioEncoder.state !== 'closed') {
          audioEncoder.close();
        }
      } catch {
        // ignore
      }
    }
    mp4Muxer = null;
    webmMuxer = null;
    mp4Target = null;
    webmTarget = null;
    if (needsDownscale) {
      releaseCanvas(outputCanvas);
    }
    releaseCanvas(renderCanvas);
  }
}

export async function exportQuizVideo(
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  options?: ExportVideoOptions
): Promise<ExportResult> {
  if (slides.length === 0) {
    throw new Error('لا توجد أسئلة صالحة للتصدير.');
  }

  const checkAborted = () => {
    if (signal.aborted) {
      throw new Error('تم إلغاء التصدير.');
    }
  };

  checkAborted();
  const { width: baseWidth, height: baseHeight } = getCanvasDimensions(template);
  const formatPref: ExportFormatPreference = options?.formatPreference ?? 'auto';
  const resPref: ExportResolutionPreference = options?.resolutionPreference ?? 'auto';
  const qualityTier: ExportQualityTier = options?.qualityTier ?? 'balanced';
  const includeAudio = options?.includeAudio !== false;
  const getPreviewCanvas = options?.getPreviewCanvas;

  onProgress({
    progress: 0.01,
    currentTime: 0,
    totalDuration: getTotalDuration(slides, timing, audio, template) || 1,
    statusText: 'جارٍ فحص قدرات الجهاز وتجهيز الخطوط والقالب...',
    stage: 'preparing',
    engineLabel: 'جاري الفحص...',
  });

  const [capabilities] = await Promise.all([
    probeExportCapabilities(),
    ensureQuizFontsLoaded(template.fontFamily),
    preloadTemplateBackground(template, slides),
    preloadTimerVideo(),
  ]);
  clearRendererCaches();
  checkAborted();

  // Reuse the app's single shared AudioContext (never close it on cleanup!)
  let sharedAudioCtx: AudioContext | null = null;
  try {
    sharedAudioCtx = soundEngine.getContext();
  } catch {
    sharedAudioCtx = null;
  }

  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    await Promise.race([
      sharedAudioCtx.resume().catch(() => undefined),
      sleepMs(400),
    ]);
  }
  checkAborted();

  const syncTask = soundEngine.syncProjectAudioDurations(
    slides,
    audio,
    template,
    sharedAudioCtx ?? undefined
  );
  const synced = await Promise.race([
    syncTask,
    new Promise<{ slides: QuestionSlide[]; audio: AudioSettings; template: TemplateSettings }>(
      (resolve) => {
        window.setTimeout(() => resolve({ slides, audio, template }), 8000);
      }
    ),
  ]);
  checkAborted();

  const sSlides = synced.slides;
  const sAudio = synced.audio;
  const sTemplate = synced.template;

  const totalDuration = getTotalDuration(sSlides, timing, sAudio, sTemplate);
  if (totalDuration <= 0) {
    throw new Error('لا توجد أسئلة صالحة للتصدير.');
  }

  let masterAudioBuffer: AudioBuffer | null = null;
  if (includeAudio) {
    onProgress({
      progress: 0.03,
      currentTime: 0,
      totalDuration,
      statusText: 'جارٍ معالجة ودمج المسار الصوتي بدقة...',
      stage: 'preparing',
      engineLabel: 'تحضير الصوت',
    });

    try {
      const rendered = await soundEngine.renderOfflineExportMix(
        sSlides,
        sTemplate,
        timing,
        sAudio,
        48000
      );
      masterAudioBuffer = rendered?.buffer ?? null;
    } catch {
      masterAudioBuffer = null;
    }
    checkAborted();
  }

  const dimensionPlans = resolveExportDimensionPlans(
    baseWidth,
    baseHeight,
    resPref,
    qualityTier,
    capabilities
  );
  let lastErr: unknown = null;
  let webCodecsFailureNote: string | undefined;

  // ============================================================================
  // TIER 1: Offline WebCodecs Engine (MP4 / WebM)
  // ============================================================================
  const canTryWebCodecs =
    capabilities.hasWebCodecsVideo &&
    (!includeAudio || (masterAudioBuffer !== null && capabilities.hasWebCodecsAudio));

  if (canTryWebCodecs) {
    const containerOrder: Array<'mp4' | 'webm'> =
      formatPref === 'webm'
        ? ['webm', 'mp4']
        : formatPref === 'mp4'
          ? ['mp4', 'webm']
          : capabilities.isApple || capabilities.supportsMp4WebCodecs
            ? ['mp4', 'webm']
            : ['webm', 'mp4'];

    const primaryResLabel = dimensionPlans[0]?.label;
    const primaryFormat = containerOrder[0];

    for (let dIdx = 0; dIdx < dimensionPlans.length; dIdx++) {
      const dims = dimensionPlans[dIdx];
      checkAborted();
      const plans = await probeWebCodecsPlans(
        containerOrder,
        dims,
        masterAudioBuffer,
        includeAudio
      );

      for (let i = 0; i < plans.length; i++) {
        checkAborted();
        const plan = plans[i];
        const switchedFormat =
          formatPref !== 'auto' && plan.container !== formatPref;
        const switchedRes =
          resPref !== 'auto' && dims.label !== resPref;
        const isRetryPlan = i > 0 || dIdx > 0;

        let fallbackReason: string | undefined;
        if (switchedFormat && switchedRes) {
          fallbackReason = `تم التحويل إلى ${plan.container.toUpperCase()} بدقة ${dims.label} لتوافق الجهاز.`;
        } else if (switchedFormat) {
          fallbackReason = `تم التحويل إلى صيغة ${plan.container.toUpperCase()} لعدم توفر ترميز ${formatPref.toUpperCase()} على الجهاز.`;
        } else if (switchedRes) {
          fallbackReason = `تم خفض الدقة إلى ${dims.label} لضمان استقرار الترميز على الجهاز.`;
        } else if (isRetryPlan && plan.container !== primaryFormat) {
          fallbackReason = `تم استخدام حاوية ${plan.container.toUpperCase()} البديلة لضمان التوافق.`;
        } else if (isRetryPlan && dims.label !== primaryResLabel) {
          fallbackReason = `تم استخدام دقة ${dims.label} البديلة بعد تعذر الدقة الأعلى.`;
        }

        try {
          if (isRetryPlan) {
            onProgress({
              progress: 0.04,
              currentTime: 0,
              totalDuration,
              statusText: `جارٍ المحاولة بدقة ${dims.label} (${plan.container.toUpperCase()})...`,
              stage: 'preparing',
              engineLabel: `WebCodecs · ${plan.container.toUpperCase()} (${dims.label})`,
              fallbackNotice: fallbackReason,
            });
          }
          return await encodeWithWebCodecsPlan(
            plan,
            baseWidth,
            baseHeight,
            dims,
            qualityTier,
            Boolean(fallbackReason),
            fallbackReason,
            totalDuration,
            sSlides,
            sTemplate,
            timing,
            sAudio,
            onProgress,
            signal,
            getPreviewCanvas
          );
        } catch (err) {
          if (signal.aborted) throw err;
          lastErr = err;
          webCodecsFailureNote = 'تعذر إكمال التصدير السريع، تم التحويل إلى المسجل الاحتياطي.';
        }
      }
    }
  } else if (!capabilities.hasWebCodecsVideo) {
    webCodecsFailureNote = 'المتصفح لا يدعم WebCodecs، تم استخدام مسجل MediaRecorder الاحتياطي.';
  } else if (includeAudio && masterAudioBuffer === null) {
    webCodecsFailureNote = 'تم استخدام مسجل MediaRecorder الاحتياطي لمعالجة الصوت.';
  }

  // ============================================================================
  // TIER 2: Hardened MediaRecorder Fallback
  // ============================================================================
  if (typeof MediaRecorder === 'undefined') {
    throw lastErr instanceof Error
      ? lastErr
      : new Error('متصفحك الحالي لا يدعم تصدير الفيديو (WebCodecs أو MediaRecorder).');
  }

  const fallbackPlan =
    includeAudio && !masterAudioBuffer
      ? buildScheduledAudioPlan(sSlides, timing, sAudio, sTemplate, totalDuration)
      : { events: [], speechIntervals: [] };

  const mimeCandidates = getPreferredMediaRecorderMimeTypes(formatPref);

  const checkAudioClockRunning = async (ctx: AudioContext | null): Promise<boolean> => {
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await Promise.race([ctx.resume().catch(() => undefined), sleepMs(400)]);
    }
    if (ctx.state !== 'running') return false;
    const t0 = ctx.currentTime;
    await sleepMs(80);
    return ctx.state === 'running' && ctx.currentTime > t0 + 0.005;
  };

  const runRecorderAttempt = async (
    candidate: MimeCandidate,
    dims: DimensionsPlan,
    withAudioTrack: boolean,
    fallbackReason?: string
  ): Promise<ExportResult> => {
    checkAborted();

    const engineLabel = `MediaRecorder · ${candidate.extension.toUpperCase()} (${dims.label})`;
    const audioIsLive = withAudioTrack ? await checkAudioClockRunning(sharedAudioCtx) : false;
    // Never attach a dead suspended AudioContext stream to MediaRecorder — it stalls muxing!
    const attachAudio = Boolean(withAudioTrack && sharedAudioCtx && audioIsLive);

    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = baseWidth;
    renderCanvas.height = baseHeight;
    const renderCtx = renderCanvas.getContext('2d', { alpha: false });
    if (!renderCtx) {
      releaseCanvas(renderCanvas);
      throw new Error('تعذر تهيئة محرك الرسم على هذا المتصفح.');
    }
    renderCtx.imageSmoothingEnabled = true;
    renderCtx.imageSmoothingQuality = 'high';

    const needsDownscale = dims.width !== baseWidth || dims.height !== baseHeight;
    const captureCanvas = needsDownscale ? document.createElement('canvas') : renderCanvas;
    if (needsDownscale) {
      captureCanvas.width = dims.width;
      captureCanvas.height = dims.height;
    }
    captureCanvas.style.position = 'fixed';
    captureCanvas.style.right = '4px';
    captureCanvas.style.bottom = '4px';
    captureCanvas.style.width = `${Math.max(120, Math.round(dims.width / 8))}px`;
    captureCanvas.style.height = `${Math.max(120, Math.round(dims.height / 8))}px`;
    captureCanvas.style.opacity = '0.03';
    captureCanvas.style.zIndex = '60';
    captureCanvas.style.pointerEvents = 'none';
    captureCanvas.style.visibility = 'visible';
    document.body.appendChild(captureCanvas);

    const captureCtx = needsDownscale
      ? captureCanvas.getContext('2d', { alpha: false })
      : renderCtx;
    if (!captureCtx) {
      releaseCanvas(captureCanvas, true);
      if (needsDownscale) releaseCanvas(renderCanvas);
      throw new Error('تعذر تهيئة محرك الالتقاط.');
    }
    captureCtx.imageSmoothingEnabled = true;
    captureCtx.imageSmoothingQuality = 'high';

    let audioDest: MediaStreamAudioDestinationNode | null = null;
    let keepAliveOsc: OscillatorNode | null = null;
    let keepAliveGain: GainNode | null = null;

    if (attachAudio && sharedAudioCtx) {
      try {
        audioDest = sharedAudioCtx.createMediaStreamDestination();
        keepAliveOsc = sharedAudioCtx.createOscillator();
        keepAliveGain = sharedAudioCtx.createGain();
        keepAliveGain.gain.setValueAtTime(0.00001, sharedAudioCtx.currentTime);
        keepAliveOsc.connect(keepAliveGain);
        keepAliveGain.connect(audioDest);
        keepAliveOsc.start();
      } catch {
        audioDest = null;
      }
    }

    let canvasStream: MediaStream;
    try {
      canvasStream = captureCanvas.captureStream(dims.fps);
    } catch (err) {
      try {
        keepAliveOsc?.stop();
        keepAliveOsc?.disconnect();
        keepAliveGain?.disconnect();
        audioDest?.disconnect();
      } catch {
        // ignore
      }
      releaseCanvas(captureCanvas, true);
      if (needsDownscale) releaseCanvas(renderCanvas);
      throw err instanceof Error ? err : new Error('تعذر التقاط إطارات الفيديو من اللوحة.');
    }

    const audioTracks = audioDest ? audioDest.stream.getAudioTracks() : [];
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    if (attachAudio && audioTracks.length > 0) {
      tracks.push(...audioTracks);
    }
    const combinedStream = new MediaStream(tracks);

    const cleanupPreStartMedia = () => {
      combinedStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      canvasStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      soundEngine.stopExportAudioForDestination(audioDest);
      try {
        keepAliveOsc?.stop();
        keepAliveOsc?.disconnect();
        keepAliveGain?.disconnect();
        audioDest?.disconnect();
      } catch {
        // ignore
      }
      releaseCanvas(captureCanvas, true);
      if (needsDownscale) releaseCanvas(renderCanvas);
    };

    let activeRecorder: MediaRecorder;
    try {
      const opts: MediaRecorderOptions = {
        videoBitsPerSecond: dims.videoBitrate,
        ...(attachAudio && audioTracks.length > 0 ? { audioBitsPerSecond: 160_000 } : {}),
      };
      if (candidate.mimeType) {
        opts.mimeType = candidate.mimeType;
      }
      activeRecorder = new MediaRecorder(combinedStream, opts);
    } catch (primaryErr) {
      try {
        // Retry constructor without explicit bitrates if the WebView rejects bitrate hints
        activeRecorder = candidate.mimeType
          ? new MediaRecorder(combinedStream, { mimeType: candidate.mimeType })
          : new MediaRecorder(combinedStream);
      } catch {
        cleanupPreStartMedia();
        throw primaryErr instanceof Error ? primaryErr : new Error('تعذر بدء مسجل الفيديو.');
      }
    }

    const chunks: BlobPart[] = [];
    let lastChunkPerf = performance.now();
    activeRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
        lastChunkPerf = performance.now();
      }
    };

    let bgSource: AudioBufferSourceNode | null = null;
    let masterSource: AudioBufferSourceNode | null = null;

    let wakeLock: { release: () => Promise<void> } | null = null;
    try {
      const wl = (navigator as unknown as {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
      }).wakeLock;
      if (wl) wakeLock = await wl.request('screen');
    } catch {
      // ignore
    }

    return await new Promise<ExportResult>((resolve, reject) => {
      let timerId = 0;
      let stopWatchdogId = 0;
      let stallCheckIntervalId = 0;
      let rafId = 0;
      let cleanedUp = false;
      let settled = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        window.clearTimeout(timerId);
        window.clearTimeout(stopWatchdogId);
        window.clearInterval(stallCheckIntervalId);
        cancelAnimationFrame(rafId);

        soundEngine.stopExportAudioForDestination(audioDest);
        try {
          keepAliveOsc?.stop();
          keepAliveOsc?.disconnect();
          keepAliveGain?.disconnect();
        } catch {
          // ignore
        }
        if (masterSource) {
          try {
            masterSource.stop();
            masterSource.disconnect();
          } catch {
            // ignore
          }
          masterSource = null;
        }
        if (bgSource) {
          try {
            bgSource.stop();
            bgSource.disconnect();
          } catch {
            // ignore
          }
          bgSource = null;
        }
        try {
          audioDest?.disconnect();
        } catch {
          // ignore
        }
        combinedStream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore
          }
        });
        canvasStream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore
          }
        });
        if (wakeLock) {
          void wakeLock.release().catch(() => undefined);
          wakeLock = null;
        }
        releaseCanvas(captureCanvas, true);
        if (needsDownscale) {
          releaseCanvas(renderCanvas);
        }
      };

      const finishSuccess = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        cleanup();
        if (signal.aborted) {
          reject(new Error('تم إلغاء التصدير.'));
          return;
        }
        const finalType =
          activeRecorder.mimeType || candidate.mimeType || `video/${candidate.extension}`;
        const blob = new Blob(chunks, { type: finalType });
        chunks.length = 0;
        if (blob.size < 512) {
          reject(new Error('نتج عن التسجيل ملف فيديو فارغ.'));
          return;
        }
        const ext: 'mp4' | 'webm' = finalType.includes('mp4') ? 'mp4' : 'webm';
        resolve({
          blob,
          mimeType: finalType,
          extension: ext,
          engine: 'mediarecorder',
          engineLabel,
          codecLabel: finalType,
          width: dims.width,
          height: dims.height,
          fps: dims.fps,
          qualityTier,
          hasAudio: attachAudio,
          usedFallback: true,
          fallbackReason: fallbackReason ?? webCodecsFailureNote,
          durationSec: totalDuration,
        });
      };

      const finishError = (msg: string) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        try {
          if (activeRecorder.state !== 'inactive') {
            activeRecorder.stop();
          }
        } catch {
          // ignore
        }
        chunks.length = 0;
        cleanup();
        reject(new Error(msg));
      };

      const onAbort = () => {
        finishError('تم إلغاء التصدير.');
      };

      signal.addEventListener('abort', onAbort, { once: true });

      activeRecorder.onerror = () => {
        finishError('حدث خطأ أثناء تسجيل الفيديو بهذه الصيغة.');
      };

      activeRecorder.onstop = () => {
        finishSuccess();
      };

      const renderToCapture = (t: number) => {
        renderQuizFrame(renderCtx, t, sSlides, sTemplate, timing, sAudio, false);
        if (needsDownscale) {
          captureCtx.drawImage(renderCanvas, 0, 0, dims.width, dims.height);
        }
        drawScaledPreview(captureCanvas, getPreviewCanvas?.());
      };

      try {
        renderToCapture(0);
      } catch (err) {
        finishError(err instanceof Error ? err.message : 'فشل رسم الإطار الأول.');
        return;
      }

      let nextAudioIdx = 0;
      let audioStartTime = sharedAudioCtx ? sharedAudioCtx.currentTime : 0;

      const scheduleFallbackAudioLookahead = (horizonTime: number) => {
        if (!attachAudio || !sharedAudioCtx || !audioDest || masterAudioBuffer) return;
        while (
          nextAudioIdx < fallbackPlan.events.length &&
          fallbackPlan.events[nextAudioIdx].time <= horizonTime
        ) {
          const item = fallbackPlan.events[nextAudioIdx];
          nextAudioIdx += 1;
          const when = Math.max(sharedAudioCtx.currentTime, audioStartTime + item.time);
          const ev = item.event;
          const slide = sSlides[ev.slideIndex];
          const maxDur = item.maxDuration;

          if (ev.type === 'introHook') {
            const hookSfx = sTemplate.introHookSfx ?? 'whoosh';
            const hasHookVoice = Boolean(sTemplate.introHookAudio?.dataUrl);
            if (hookSfx && hookSfx !== 'none') {
              soundEngine.playBuiltInSfx(
                hookSfx,
                hasHookVoice ? 0.42 : 0.72,
                sharedAudioCtx,
                audioDest,
                when,
                false,
                1.6,
                hasHookVoice ? Math.min(0.28, maxDur ?? 0.28) : maxDur
              );
            }
            if (sTemplate.introHookAudio?.dataUrl) {
              void soundEngine.playClip(
                sTemplate.introHookAudio,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            }
          } else if (ev.type === 'questionEnter') {
            if (slide?.voiceover?.question?.dataUrl) {
              void soundEngine.playClip(
                slide.voiceover.question,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(
                sAudio.questionEnter,
                audioDest,
                sharedAudioCtx,
                when,
                false,
                maxDur
              );
            }
          } else if (ev.type === 'optionEnter') {
            const optIdx = ev.optionIndex ?? 0;
            const optClip = slide?.voiceover?.options?.[optIdx];
            if (optClip?.dataUrl) {
              void soundEngine.playClip(
                optClip,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(
                sAudio.optionEnter,
                audioDest,
                sharedAudioCtx,
                when,
                false,
                maxDur
              );
            }
          } else if (ev.type === 'countdownTick') {
            void soundEngine.playSlot(
              sAudio.countdownTick,
              audioDest,
              sharedAudioCtx,
              when,
              !!ev.urgent,
              maxDur
            );
          } else if (ev.type === 'suspense') {
            void soundEngine.playSlot(
              sAudio.suspense,
              audioDest,
              sharedAudioCtx,
              when,
              false,
              maxDur,
              timing.suspenseDuration
            );
          } else if (ev.type === 'correctReveal') {
            if (slide?.voiceover?.answer?.dataUrl) {
              void soundEngine.playClip(
                slide.voiceover.answer,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(
                sAudio.correctReveal,
                audioDest,
                sharedAudioCtx,
                when,
                false,
                maxDur
              );
            }
          }
        }
      };

      let loopStarted = false;
      let lastProgressEmitPerf = 0;

      const beginSyncLoop = () => {
        if (loopStarted || signal.aborted || cleanedUp || settled) return;
        loopStarted = true;

        const wallStartPerf = performance.now();
        lastChunkPerf = wallStartPerf;
        let lastRenderTickPerf = wallStartPerf;
        audioStartTime = sharedAudioCtx ? sharedAudioCtx.currentTime + 0.025 : 0;

        if (attachAudio && sharedAudioCtx && audioDest) {
          if (masterAudioBuffer) {
            try {
              const src = sharedAudioCtx.createBufferSource();
              src.buffer = masterAudioBuffer;
              src.connect(audioDest);
              src.start(audioStartTime);
              masterSource = src;
            } catch {
              // ignore
            }
          } else {
            void soundEngine
              .startBgMusic(sAudio.bgMusic, audioDest, sharedAudioCtx)
              .then((src) => {
                if ((cleanedUp || settled) && src) {
                  try {
                    src.stop();
                  } catch {
                    // ignore
                  }
                  return;
                }
                bgSource = src;
                if (timing.autoDuckMusic !== false && fallbackPlan.speechIntervals.length > 0) {
                  soundEngine.scheduleBgDuckIntervals(
                    sharedAudioCtx,
                    fallbackPlan.speechIntervals,
                    audioStartTime,
                    timing.bgMusicDuckRatio ?? 0.22
                  );
                }
              });
            scheduleFallbackAudioLookahead(0.8);
          }
        }

        try {
          renderToCapture(0);
        } catch (err) {
          finishError(err instanceof Error ? err.message : 'فشل رسم الفيديو.');
          return;
        }

        let nextSlotTime = 1 / dims.fps;
        let finishing = false;
        let forceWallClock = !attachAudio || !sharedAudioCtx || sharedAudioCtx.state !== 'running';
        let lastAudioSeen = sharedAudioCtx ? sharedAudioCtx.currentTime : 0;
        let lastAudioProgressPerf = wallStartPerf;
        let maxElapsedReached = 0;

        stallCheckIntervalId = window.setInterval(() => {
          if (settled || finishing || cleanedUp) return;
          const nowP = performance.now();
          if (nowP - lastRenderTickPerf > 5000) {
            finishError('توقف تحديث الإطارات أثناء التسجيل.');
            return;
          }
          if (totalDuration > 4 && nowP - lastChunkPerf > 6500 && chunks.length === 0) {
            finishError('لم يخرج مسجل المتصفح أي بيانات فيديو (MediaRecorder).');
          }
        }, 700);

        const stepFrame = () => {
          if (signal.aborted || cleanedUp || settled || finishing) return;
          window.clearTimeout(timerId);
          cancelAnimationFrame(rafId);

          const nowPerf = performance.now();
          lastRenderTickPerf = nowPerf;
          const wallElapsed = Math.max(0, (nowPerf - wallStartPerf) / 1000);

          if (!forceWallClock && sharedAudioCtx) {
            const curAudio = sharedAudioCtx.currentTime;
            if (curAudio > lastAudioSeen + 0.001) {
              lastAudioSeen = curAudio;
              lastAudioProgressPerf = nowPerf;
            } else if (
              sharedAudioCtx.state !== 'running' ||
              nowPerf - lastAudioProgressPerf > 260
            ) {
              forceWallClock = true;
            }
          }

          const rawAudioElapsed =
            !forceWallClock && sharedAudioCtx
              ? Math.max(0, sharedAudioCtx.currentTime - audioStartTime)
              : wallElapsed;

          const elapsed = Math.min(
            totalDuration,
            Math.max(maxElapsedReached, forceWallClock ? wallElapsed : rawAudioElapsed)
          );
          maxElapsedReached = elapsed;

          if (attachAudio && !masterAudioBuffer) {
            scheduleFallbackAudioLookahead(elapsed + 0.8);
          }

          if (elapsed >= nextSlotTime - 0.004 || elapsed >= totalDuration) {
            try {
              renderToCapture(elapsed);
            } catch (err) {
              finishError(
                err instanceof Error ? err.message : 'حدث خطأ أثناء رسم مشهد الفيديو.'
              );
              return;
            }

            if (elapsed >= totalDuration || nowPerf - lastProgressEmitPerf >= 140) {
              lastProgressEmitPerf = nowPerf;
              onProgress({
                progress: 0.04 + 0.92 * (elapsed / totalDuration),
                currentTime: elapsed,
                totalDuration,
                statusText: `جارٍ تسجيل الفيديو (${Math.round((elapsed / totalDuration) * 100)}%)`,
                stage: 'rendering',
                engineLabel,
                fallbackNotice: fallbackReason ?? webCodecsFailureNote,
              });
            }

            while (nextSlotTime <= elapsed + 0.004) {
              nextSlotTime += 1 / dims.fps;
            }
          }

          if (elapsed >= totalDuration) {
            finishing = true;
            onProgress({
              progress: 0.97,
              currentTime: totalDuration,
              totalDuration,
              statusText: 'جارٍ إيقاف المسجل وتجميع مقاطع الفيديو...',
              stage: 'finalizing',
              engineLabel,
              fallbackNotice: fallbackReason ?? webCodecsFailureNote,
            });
            timerId = window.setTimeout(() => {
              if (settled) return;
              try {
                if (activeRecorder.state === 'recording') {
                  try {
                    activeRecorder.requestData?.();
                  } catch {
                    // ignore
                  }
                  activeRecorder.stop();
                } else if (activeRecorder.state === 'inactive') {
                  finishSuccess();
                }
              } catch {
                finishSuccess();
              }

              stopWatchdogId = window.setTimeout(() => {
                if (chunks.length > 0) {
                  finishSuccess();
                } else {
                  finishError('انتهت مهلة إغلاق مسجل الفيديو دون بيانات كافية.');
                }
              }, 3500);
            }, 220);
            return;
          }

          const msToNext = Math.max(8, Math.min(36, (nextSlotTime - elapsed) * 1000));
          rafId = requestAnimationFrame(stepFrame);
          timerId = window.setTimeout(stepFrame, msToNext);
        };

        rafId = requestAnimationFrame(stepFrame);
        timerId = window.setTimeout(stepFrame, 33);
      };

      activeRecorder.onstart = () => {
        window.clearTimeout(timerId);
        cancelAnimationFrame(rafId);
        beginSyncLoop();
      };

      try {
        activeRecorder.start(1000);
      } catch {
        finishError('تعذر تشغيل مسجل الفيديو على هذا الجهاز.');
        return;
      }

      timerId = window.setTimeout(() => {
        beginSyncLoop();
      }, 90);
    });
  };

  for (let dIdx = 0; dIdx < dimensionPlans.length; dIdx++) {
    const dims = dimensionPlans[dIdx];
    for (let i = 0; i < mimeCandidates.length; i++) {
      checkAborted();
      const cand = mimeCandidates[i];
      const reason =
        webCodecsFailureNote ||
        (dIdx > 0 ? `تم خفض الدقة إلى ${dims.label} لضمان نجاح التسجيل.` : undefined);
      try {
        if (i > 0 || dIdx > 0 || webCodecsFailureNote) {
          onProgress({
            progress: 0.04,
            currentTime: 0,
            totalDuration,
            statusText: `جارٍ المحاولة بالمسجل الاحتياطي (${cand.extension.toUpperCase()} · ${dims.label})...`,
            stage: 'preparing',
            engineLabel: `MediaRecorder · ${cand.extension.toUpperCase()} (${dims.label})`,
            fallbackNotice: reason,
          });
        }
        return await runRecorderAttempt(cand, dims, includeAudio, reason);
      } catch (err) {
        if (signal.aborted) throw err;
        lastErr = err;
      }
    }
  }

  if (includeAudio) {
    const safeDims = dimensionPlans[dimensionPlans.length - 1];
    for (const cand of mimeCandidates.slice(0, 2)) {
      checkAborted();
      const noAudioReason =
        'تعذر دمج مسار الصوت على هذا المتصفح، تم تصدير الفيديو بدون صوت.';
      try {
        onProgress({
          progress: 0.04,
          currentTime: 0,
          totalDuration,
          statusText: noAudioReason,
          stage: 'preparing',
          engineLabel: `MediaRecorder · ${cand.extension.toUpperCase()} (${safeDims.label})`,
          fallbackNotice: noAudioReason,
        });
        return await runRecorderAttempt(cand, safeDims, false, noAudioReason);
      } catch (err) {
        if (signal.aborted) throw err;
        lastErr = err;
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error('تعذر تصدير الفيديو على هذا المتصفح. جرّب دقة 720p أو صيغة WebM.');
}

export const __exporterInternals = {
  buildScheduledAudioPlan,
  resampleAudioBuffer,
  DEFAULT_EXPORT_FPS,
};
