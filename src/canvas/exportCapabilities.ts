import type { ExportFormatPreference, ExportResolutionPreference } from './videoExporter';

export type ExportQualityTier = 'economy' | 'balanced' | 'max';

export interface QualityTierSpec {
  id: ExportQualityTier;
  label: string;
  shortDesc: string;
  preferredResolution: '720p' | '1080p';
  fps: 30;
  bitrate720p: number;
  bitrate1080p: number;
}

export const EXPORT_QUALITY_TIERS: Record<ExportQualityTier, QualityTierSpec> = {
  economy: {
    id: 'economy',
    label: 'اقتصادية',
    shortDesc: '720p · 30fps (أسرع وحجم أصغر)',
    preferredResolution: '720p',
    fps: 30,
    bitrate720p: 2_600_000,
    bitrate1080p: 3_800_000,
  },
  balanced: {
    id: 'balanced',
    label: 'عالية',
    shortDesc: '1080p · 30fps (متوازنة)',
    preferredResolution: '1080p',
    fps: 30,
    bitrate720p: 3_200_000,
    bitrate1080p: 5_200_000,
  },
  max: {
    id: 'max',
    label: 'أعلى جودة مدعومة',
    shortDesc: '1080p · 30fps (بت ريت فائق)',
    preferredResolution: '1080p',
    fps: 30,
    bitrate720p: 4_000_000,
    bitrate1080p: 7_000_000,
  },
};

export interface DimensionsPlan {
  width: number;
  height: number;
  label: '1080p' | '720p';
  fps: number;
  videoBitrate: number;
}

export interface MimeCandidate {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

export type DevicePerformanceClass = 'low' | 'medium' | 'high';

export interface ExportCapabilitiesReport {
  probedAt: number;
  isAndroid: boolean;
  isApple: boolean;
  isMobile: boolean;
  hasWebCodecsVideo: boolean;
  hasWebCodecsAudio: boolean;
  hasMediaRecorder: boolean;
  hasAudioContext: boolean;
  hasOfflineAudioContext: boolean;
  supportsMp4WebCodecs: boolean;
  supportsWebmWebCodecs: boolean;
  supportsMp4MediaRecorder: boolean;
  supportsWebmMediaRecorder: boolean;
  supportsMp4: boolean;
  supportsWebm: boolean;
  supportsAac: boolean;
  supportsOpus: boolean;
  supports1080pWebCodecs: boolean;
  supports720pWebCodecs: boolean;
  supportedVideoCodecs: string[];
  supportedAudioCodecs: string[];
  supportedMediaRecorderMimes: string[];
  maxRecommendedWidth: number;
  maxRecommendedHeight: number;
  estimatedDeviceTier: DevicePerformanceClass;
  recommendedQualityTier: ExportQualityTier;
  recommendedFormat: 'mp4' | 'webm';
  recommendedResolution: '720p' | '1080p';
}

export function isAppleBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Android|Edg|CriOS|FxiOS/i.test(ua);
  return isIos || isSafari;
}

export function isAndroidBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua);
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

export function makeEvenDimension(n: number): number {
  const rounded = Math.max(2, Math.round(n));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function computeScaledDimensions(
  baseWidth: number,
  baseHeight: number,
  targetLabel: '1080p' | '720p'
): { width: number; height: number } {
  const fullW = makeEvenDimension(baseWidth);
  const fullH = makeEvenDimension(baseHeight);
  if (targetLabel === '1080p') {
    return { width: fullW, height: fullH };
  }
  const shortSide = Math.min(fullW, fullH);
  const scale720 = shortSide > 720 ? 720 / shortSide : 1;
  return {
    width: makeEvenDimension(fullW * scale720),
    height: makeEvenDimension(fullH * scale720),
  };
}

export function resolveExportDimensionPlans(
  baseWidth: number,
  baseHeight: number,
  resPref: ExportResolutionPreference,
  qualityTier: ExportQualityTier = 'balanced',
  capabilities?: Pick<ExportCapabilitiesReport, 'isMobile' | 'supports1080pWebCodecs'>
): DimensionsPlan[] {
  const tierSpec = EXPORT_QUALITY_TIERS[qualityTier] ?? EXPORT_QUALITY_TIERS.balanced;
  const fullDims = computeScaledDimensions(baseWidth, baseHeight, '1080p');
  const hdDims = computeScaledDimensions(baseWidth, baseHeight, '720p');

  const fullPlan: DimensionsPlan = {
    width: fullDims.width,
    height: fullDims.height,
    label: '1080p',
    fps: tierSpec.fps,
    videoBitrate: tierSpec.bitrate1080p,
  };

  const hdPlan: DimensionsPlan = {
    width: hdDims.width,
    height: hdDims.height,
    label: '720p',
    fps: tierSpec.fps,
    videoBitrate: tierSpec.bitrate720p,
  };

  const hasDistinctHd = hdDims.width < fullDims.width || hdDims.height < fullDims.height;
  if (!hasDistinctHd) {
    return [fullPlan];
  }

  // Respect explicit user resolution selection first, with safe fallback to 720p if 1080p fails at runtime
  if (resPref === '720p') {
    return [hdPlan];
  }
  if (resPref === '1080p') {
    return [fullPlan, hdPlan];
  }

  // 'auto': follow quality tier preference; economy prefers 720p, balanced/max prefer 1080p on desktop or capable WebCodecs devices, 720p on mobile fallback
  if (qualityTier === 'economy') {
    return [hdPlan];
  }
  const mobile = capabilities?.isMobile ?? isMobileBrowser();
  if (mobile && qualityTier === 'balanced') {
    return [hdPlan, fullPlan];
  }
  if (mobile && qualityTier === 'max') {
    return capabilities?.supports1080pWebCodecs === false ? [hdPlan] : [fullPlan, hdPlan];
  }
  return [fullPlan, hdPlan];
}

export function getPreferredMediaRecorderMimeTypes(
  formatPref: ExportFormatPreference = 'auto'
): MimeCandidate[] {
  const mp4Candidates: MimeCandidate[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
  ];

  const webmCandidates: MimeCandidate[] = [
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  const preferMp4 = formatPref === 'mp4' || (formatPref === 'auto' && isAppleBrowser());

  const ordered = preferMp4
    ? [...mp4Candidates, ...webmCandidates]
    : [...webmCandidates, ...mp4Candidates];

  const supported =
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? ordered.filter((c) => {
          try {
            return MediaRecorder.isTypeSupported(c.mimeType);
          } catch {
            return false;
          }
        })
      : [];

  const fallbackExt: 'mp4' | 'webm' = preferMp4 ? 'mp4' : 'webm';
  const result = [...supported, { mimeType: '', extension: fallbackExt }];

  const seen = new Set<string>();
  return result.filter((item) => {
    const key = `${item.mimeType}|${item.extension}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function isVideoCodecSupportedSafe(config: VideoEncoderConfig): Promise<boolean> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof VideoEncoder.isConfigSupported !== 'function'
  ) {
    return false;
  }
  try {
    const res = await VideoEncoder.isConfigSupported(config);
    return Boolean(res?.supported);
  } catch {
    return false;
  }
}

async function isAudioCodecSupportedSafe(config: AudioEncoderConfig): Promise<boolean> {
  if (
    typeof AudioEncoder === 'undefined' ||
    typeof AudioEncoder.isConfigSupported !== 'function'
  ) {
    return false;
  }
  try {
    const res = await AudioEncoder.isConfigSupported(config);
    return Boolean(res?.supported);
  } catch {
    return false;
  }
}

let cachedCapabilities: ExportCapabilitiesReport | null = null;
const CAPABILITY_CACHE_TTL_MS = 60_000;

export function resetExportCapabilitiesCache(): void {
  cachedCapabilities = null;
}

export async function probeExportCapabilities(
  forceRefresh = false
): Promise<ExportCapabilitiesReport> {
  if (
    !forceRefresh &&
    cachedCapabilities &&
    Date.now() - cachedCapabilities.probedAt < CAPABILITY_CACHE_TTL_MS
  ) {
    return cachedCapabilities;
  }

  const isAndroid = isAndroidBrowser();
  const isApple = isAppleBrowser();
  const isMobile = isMobileBrowser();

  const hasWebCodecsVideo =
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof VideoEncoder.isConfigSupported === 'function';

  const hasWebCodecsAudio =
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioData !== 'undefined' &&
    typeof AudioEncoder.isConfigSupported === 'function';

  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
  const hasAudioContext =
    typeof window !== 'undefined' &&
    Boolean(
      window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    );
  const hasOfflineAudioContext = typeof OfflineAudioContext !== 'undefined';

  const supportedVideoCodecs: string[] = [];
  const supportedAudioCodecs: string[] = [];

  let supports720pAvc = false;
  let supports1080pAvc = false;
  let supports720pWebm = false;
  let supports1080pWebm = false;

  if (hasWebCodecsVideo) {
    const avcProbeCodecs = ['avc1.42E01F', 'avc1.4d002a', 'avc1.640028', 'avc1.420028'];
    for (const codec of avcProbeCodecs) {
      const ok720 = await isVideoCodecSupportedSafe({
        codec,
        width: 720,
        height: 1280,
        bitrate: 3_000_000,
        framerate: 30,
        avc: { format: 'avc' },
      });
      if (ok720) {
        supports720pAvc = true;
        if (!supportedVideoCodecs.includes(codec)) supportedVideoCodecs.push(codec);
      }
      const ok1080 = await isVideoCodecSupportedSafe({
        codec,
        width: 1080,
        height: 1920,
        bitrate: 5_200_000,
        framerate: 30,
        avc: { format: 'avc' },
      });
      if (ok1080) {
        supports1080pAvc = true;
        if (!supportedVideoCodecs.includes(codec)) supportedVideoCodecs.push(codec);
      }
    }

    const webmProbeCodecs = ['vp8', 'vp09.00.10.08'];
    for (const codec of webmProbeCodecs) {
      const ok720 = await isVideoCodecSupportedSafe({
        codec,
        width: 720,
        height: 1280,
        bitrate: 3_000_000,
        framerate: 30,
      });
      if (ok720) {
        supports720pWebm = true;
        if (!supportedVideoCodecs.includes(codec)) supportedVideoCodecs.push(codec);
      }
      const ok1080 = await isVideoCodecSupportedSafe({
        codec,
        width: 1080,
        height: 1920,
        bitrate: 5_200_000,
        framerate: 30,
      });
      if (ok1080) {
        supports1080pWebm = true;
        if (!supportedVideoCodecs.includes(codec)) supportedVideoCodecs.push(codec);
      }
    }
  }

  let supportsAac = false;
  let supportsOpus = false;
  if (hasWebCodecsAudio) {
    supportsAac = await isAudioCodecSupportedSafe({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    if (supportsAac) supportedAudioCodecs.push('mp4a.40.2');

    supportsOpus = await isAudioCodecSupportedSafe({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    if (supportsOpus) supportedAudioCodecs.push('opus');
  }

  const supportedMediaRecorderMimes = hasMediaRecorder
    ? getPreferredMediaRecorderMimeTypes('auto')
        .map((c) => c.mimeType)
        .filter(Boolean)
    : [];

  const supportsMp4WebCodecs = (supports720pAvc || supports1080pAvc) && (!hasWebCodecsAudio || supportsAac);
  const supportsWebmWebCodecs = (supports720pWebm || supports1080pWebm) && (!hasWebCodecsAudio || supportsOpus);

  const supportsMp4MediaRecorder = supportedMediaRecorderMimes.some((m) => m.includes('mp4'));
  const supportsWebmMediaRecorder = supportedMediaRecorderMimes.some((m) => m.includes('webm'));

  const supportsMp4 = supportsMp4WebCodecs || supportsMp4MediaRecorder;
  const supportsWebm = supportsWebmWebCodecs || supportsWebmMediaRecorder;
  const supports1080pWebCodecs = supports1080pAvc || supports1080pWebm;
  const supports720pWebCodecs = supports720pAvc || supports720pWebm;

  // Estimate device tier conservatively using reliable capability signals (never rely solely on navigator.deviceMemory)
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  let estimatedDeviceTier: DevicePerformanceClass = 'medium';
  if (!hasWebCodecsVideo || (!supports1080pWebCodecs && isMobile)) {
    estimatedDeviceTier = 'low';
  } else if (!isMobile && cores >= 6 && supports1080pWebCodecs) {
    estimatedDeviceTier = 'high';
  } else if (isMobile && cores >= 8 && supports1080pWebCodecs) {
    estimatedDeviceTier = 'medium';
  } else if (isMobile && cores <= 4) {
    estimatedDeviceTier = 'low';
  }

  const recommendedQualityTier: ExportQualityTier =
    estimatedDeviceTier === 'low' ? 'economy' : 'balanced';

  const recommendedFormat: 'mp4' | 'webm' =
    supportsMp4 ? 'mp4' : supportsWebm ? 'webm' : isApple ? 'mp4' : 'webm';

  const recommendedResolution: '720p' | '1080p' =
    isMobile && estimatedDeviceTier === 'low' ? '720p' : supports1080pWebCodecs && !isMobile ? '1080p' : '720p';

  const report: ExportCapabilitiesReport = {
    probedAt: Date.now(),
    isAndroid,
    isApple,
    isMobile,
    hasWebCodecsVideo,
    hasWebCodecsAudio,
    hasMediaRecorder,
    hasAudioContext,
    hasOfflineAudioContext,
    supportsMp4WebCodecs,
    supportsWebmWebCodecs,
    supportsMp4MediaRecorder,
    supportsWebmMediaRecorder,
    supportsMp4,
    supportsWebm,
    supportsAac,
    supportsOpus,
    supports1080pWebCodecs,
    supports720pWebCodecs,
    supportedVideoCodecs,
    supportedAudioCodecs,
    supportedMediaRecorderMimes,
    maxRecommendedWidth: recommendedResolution === '1080p' ? 1080 : 720,
    maxRecommendedHeight: recommendedResolution === '1080p' ? 1920 : 1280,
    estimatedDeviceTier,
    recommendedQualityTier,
    recommendedFormat,
    recommendedResolution,
  };

  cachedCapabilities = report;
  return report;
}

export function formatExportErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return 'تعذر إتمام تصدير الفيديو. جرّب تقليل الدقة إلى 720p أو استخدام الصيغة التلقائية.';
  }

  // Already a clean Arabic message authored by our engine
  if (/[\u0600-\u06FF]/.test(trimmed) && !/(exception|error:|undefined|null|stack|at\s+\w+\s*\()/i.test(trimmed)) {
    return trimmed;
  }

  if (lower.includes('abort') || lower.includes('cancel') || lower.includes('إلغاء')) {
    return 'تم إلغاء تصدير الفيديو بأمان.';
  }
  if (lower.includes('memory') || lower.includes('oom') || lower.includes('allocation')) {
    return 'ذاكرة الجهاز غير كافية لهذه الدقة. اختر الجودة الاقتصادية (720p) وأعد المحاولة.';
  }
  if (lower.includes('notsupported') || lower.includes('not supported') || lower.includes('codec')) {
    return 'ترميز الفيديو أو الصوت المطلوب غير مدعوم على هذا الجهاز. جرّب الصيغة التلقائية أو WebM.';
  }
  if (lower.includes('audio') && (lower.includes('encode') || lower.includes('suspended') || lower.includes('track'))) {
    return 'تعذر معالجة مسار الصوت على هذا الجهاز. يمكنك إعادة المحاولة أو التصدير بدون صوت.';
  }
  if (lower.includes('mediarecorder')) {
    return 'تعذر تسجيل الفيديو عبر مسجل المتصفح. جرّب دقة 720p أو صيغة WebM.';
  }
  if (lower.includes('permission') || lower.includes('storage') || lower.includes('mediastore')) {
    return 'تعذر حفظ ملف الفيديو في ذاكرة الجهاز. تأكد من توفر مساحة تخزين كافية ومنح الإذن اللازم.';
  }
  if (lower.includes('timeout') || lower.includes('مهلة') || lower.includes('stall')) {
    return 'استغرقت عملية الترميز وقتاً أطول من المتوقع وتوقفت لحماية الجهاز. جرّب دقة 720p.';
  }

  return 'تعذر إتمام تصدير الفيديو بهذه الإعدادات. جرّب دقة 720p أو الصيغة التلقائية.';
}
