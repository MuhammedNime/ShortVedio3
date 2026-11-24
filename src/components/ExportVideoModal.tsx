import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Film,
  Layers,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Square,
  UploadCloud,
  Volume2,
  VolumeX,
  X,
  Youtube,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { exportThumbnailJpg } from '../canvas/quizRenderer';
import { exportStoryThumbnailJpg } from '../canvas/storyRenderer';
import {
  EXPORT_QUALITY_TIERS,
  ExportCapabilitiesReport,
  ExportQualityTier,
  formatExportErrorMessage,
  probeExportCapabilities,
} from '../canvas/exportCapabilities';
import {
  ExportSessionState,
  ManagedExportSession,
  estimateRemainingMs,
  exportSessionManager,
  formatDurationCompact,
  isExportSessionActive,
} from '../canvas/exportSession';
import {
  ExportFormatPreference,
  ExportProgress,
  ExportResolutionPreference,
  ExportResult,
  exportQuizVideo,
  exportStoryVideo,
} from '../canvas/videoExporter';
import { YoutubePublishKit, generateYoutubePublishKit } from '../services/aiClient';
import {
  YouTubeChannelInfo,
  YouTubePlaylistItem,
  YouTubePrivacyStatus,
  YouTubeUploadResult,
  getWebLoginBaseUrl,
  getYouTubeNativeMode,
  launchWebLinkLoginForApk,
  uploadVideoToYouTube,
} from '../services/youtubeClient';
import {
  QuizProject,
  computeProjectTimeline,
  computeStoryTimeline,
  getCanvasDimensions,
} from '../types/quiz';
import {
  canShareNatively,
  isAndroidNativeApp,
  saveOrDownloadBlob,
  shareBlobNatively,
} from '../utils/nativeDownload';
import { GoogleSignInButton } from './YouTubePublishPanel';

export interface SharedYouTubeProps {
  publishKit: YoutubePublishKit;
  tagsInput: string;
  onUpdatePublishKit: (updater: (prev: YoutubePublishKit) => YoutubePublishKit) => void;
  onUpdateTagsInput: (val: string) => void;
  ytConnected: boolean;
  ytChannel: YouTubeChannelInfo | null;
  ytEmail: string | null;
  ytPlaylists: YouTubePlaylistItem[];
  selectedPlaylistId: string;
  onSelectPlaylistId: (id: string) => void;
  ytPrivacy: YouTubePrivacyStatus;
  onChangePrivacy: (privacy: YouTubePrivacyStatus) => void;
  ytUseSchedule: boolean;
  onChangeUseSchedule: (useSchedule: boolean) => void;
  ytScheduleLocal: string;
  onChangeScheduleLocal: (val: string) => void;
  ytAutoPostComment: boolean;
  onChangeAutoPostComment: (autoPost: boolean) => void;
  isConnectingYt: boolean;
  ytAuthError: string;
  onConnectYouTube: () => Promise<void>;
  onDisconnectYouTube: () => Promise<void>;
}

interface ExportVideoModalProps extends SharedYouTubeProps {
  isOpen: boolean;
  project: QuizProject;
  onClose: () => void;
}

type ExportScopeMode = 'full' | 'single' | 'splitBatch' | 'chunkBatch';

export const ExportVideoModal: React.FC<ExportVideoModalProps> = ({
  isOpen,
  project,
  onClose,
  publishKit,
  tagsInput,
  onUpdatePublishKit,
  onUpdateTagsInput,
  ytConnected,
  ytChannel,
  ytEmail,
  ytPlaylists,
  selectedPlaylistId,
  onSelectPlaylistId,
  ytPrivacy,
  onChangePrivacy,
  ytUseSchedule,
  onChangeUseSchedule,
  ytScheduleLocal,
  onChangeScheduleLocal,
  ytAutoPostComment,
  onChangeAutoPostComment,
  isConnectingYt,
  ytAuthError,
  onConnectYouTube,
  onDisconnectYouTube,
}) => {
  const [scopeMode, setScopeMode] = useState<ExportScopeMode>('full');
  const [formatPref, setFormatPref] = useState<ExportFormatPreference>('auto');
  const [resPref, setResPref] = useState<ExportResolutionPreference>('auto');
  const [qualityTier, setQualityTier] = useState<ExportQualityTier>('balanced');
  const [includeAudio, setIncludeAudio] = useState<boolean>(true);
  const [selectedSlideIdx, setSelectedSlideIdx] = useState(0);
  const [chunkSize, setChunkSize] = useState<3 | 5 | 10>(5);

  const [sessionState, setSessionState] = useState<ExportSessionState>('idle');
  const [capabilities, setCapabilities] = useState<ExportCapabilitiesReport | null>(null);
  const [progress, setProgress] = useState<ExportProgress>({
    progress: 0,
    currentTime: 0,
    totalDuration: 0,
    statusText: '',
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [estimatedRemainingMs, setEstimatedRemainingMs] = useState<number | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [exportedFileName, setExportedFileName] = useState<string>('');
  const [batchDoneCount, setBatchDoneCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // AI Publishing Kit UI local state
  const [isGeneratingKit, setIsGeneratingKit] = useState(false);
  const [kitError, setKitError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // YouTube Direct Upload local UI state
  const [ytPanelOpen, setYtPanelOpen] = useState(true);
  const [confirmUploadOpen, setConfirmUploadOpen] = useState(false);
  const [isUploadingYt, setIsUploadingYt] = useState(false);
  const [ytUploadPct, setYtUploadPct] = useState(0);
  const [ytUploadStage, setYtUploadStage] = useState('');
  const [ytError, setYtError] = useState('');
  const [ytResult, setYtResult] = useState<YouTubeUploadResult | null>(null);

  const activeSessionRef = useRef<ManagedExportSession | null>(null);
  const sessionStateRef = useRef<ExportSessionState>('idle');
  sessionStateRef.current = sessionState;
  const progressRatioRef = useRef(0);
  const livePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const isExportActive = isExportSessionActive(sessionState);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void probeExportCapabilities().then((rep) => {
      if (active) setCapabilities(rep);
    });
    return () => {
      active = false;
    };
  }, [isOpen]);

  // Live elapsed & ETA clock during active export
  useEffect(() => {
    if (!isOpen || !isExportActive) return;
    const id = window.setInterval(() => {
      const sess = activeSessionRef.current;
      if (!sess) return;
      const nowElapsed = Math.max(0, performance.now() - sess.startedAt);
      setElapsedMs(nowElapsed);
      setEstimatedRemainingMs(
        estimateRemainingMs(nowElapsed, progressRatioRef.current, sessionStateRef.current)
      );
    }, 250);
    return () => window.clearInterval(id);
  }, [isOpen, isExportActive]);

  const getActiveTargetSlides = (overrideMode?: ExportScopeMode, overrideSlideIdx?: number) => {
    const activeProject = projectRef.current;
    const effMode = overrideMode ?? scopeMode;
    const effIdx = overrideSlideIdx ?? selectedSlideIdx;
    if (effMode === 'single' && activeProject.slides[effIdx]) {
      return [activeProject.slides[effIdx]];
    }
    return activeProject.slides;
  };

  const resetExportOutputs = () => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResult(null);
    setYtResult(null);
    setConfirmUploadOpen(false);
    setBatchDoneCount(0);
    setSaveNotice('');
    setErrorMsg('');
    setElapsedMs(0);
    setEstimatedRemainingMs(null);
    progressRatioRef.current = 0;
  };

  const startSingleOrFullExport = (
    mode: 'full' | 'single',
    slideIdx = 0,
    overrideFormat?: ExportFormatPreference,
    overrideRes?: ExportResolutionPreference,
    overrideQuality?: ExportQualityTier,
    overrideAudio?: boolean
  ) => {
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    const activeProject = projectRef.current;
    const isStoryMode = activeProject.studioMode === 'storyStudio';
    if (isStoryMode) {
      if ((activeProject.storyScenes ?? []).length === 0) {
        setErrorMsg('لا توجد مشاهد قصة صالحة للتصدير.');
        setSessionState('failed');
        return;
      }
    } else if (activeProject.slides.length === 0) {
      setErrorMsg('لا توجد أسئلة صالحة للتصدير.');
      setSessionState('failed');
      return;
    }

    // Enforce single active export session per project
    const session = exportSessionManager.beginSession(activeProject.id);
    activeSessionRef.current = session;

    resetExportOutputs();
    setSessionState('preparing');
    setProgress({
      progress: 0.01,
      currentTime: 0,
      totalDuration: 0,
      statusText: 'جارٍ تجهيز الجلسة وفحص قدرات الجهاز...',
      stage: 'preparing',
    });

    const targetSlides =
      mode === 'single' && activeProject.slides[slideIdx]
        ? [activeProject.slides[slideIdx]]
        : activeProject.slides;

    const exportOptions = {
      formatPreference: overrideFormat ?? formatPref,
      resolutionPreference: overrideRes ?? resPref,
      qualityTier: overrideQuality ?? qualityTier,
      includeAudio: overrideAudio ?? includeAudio,
      getPreviewCanvas: () => livePreviewCanvasRef.current,
    };

    const onExportProgress = (p: ExportProgress) => {
      if (!session.isCurrent() || session.controller.signal.aborted) return;
      progressRatioRef.current = p.progress;
      setProgress(p);
      if (p.stage === 'finalizing') {
        setSessionState('finalizing');
      } else if (p.stage === 'rendering') {
        setSessionState('rendering');
      } else if (p.stage === 'preparing') {
        setSessionState('preparing');
      }
    };

    const exportTask = isStoryMode
      ? exportStoryVideo(
          activeProject,
          onExportProgress,
          session.controller.signal,
          exportOptions
        )
      : exportQuizVideo(
          targetSlides,
          activeProject.template,
          activeProject.timing,
          activeProject.audio,
          onExportProgress,
          session.controller.signal,
          exportOptions
        );

    void exportTask
      .then(async (res) => {
        if (!session.isCurrent() || session.controller.signal.aborted) return;
        const url = URL.createObjectURL(res.blob);
        const prefix = isStoryMode
          ? 'story-cinema-3d'
          : mode === 'single'
            ? `quiz-slide-${slideIdx + 1}`
            : 'youtube-short-quiz';
        const generatedName = `${prefix}-${Date.now()}.${res.extension || 'mp4'}`;
        setResult(res);
        setVideoUrl(url);
        setExportedFileName(generatedName);
        setElapsedMs(Math.max(0, performance.now() - session.startedAt));
        setEstimatedRemainingMs(0);

        if (isAndroidNativeApp()) {
          setSessionState('saving');
          setIsSaving(true);
          setProgress((prev) => ({
            ...prev,
            progress: 0.98,
            statusText: 'جارٍ حفظ الفيديو في ذاكرة الجهاز بأمان...',
          }));
          const saveRes = await saveOrDownloadBlob(res.blob, generatedName, res.mimeType, {
            signal: session.controller.signal,
          });
          if (!session.isCurrent() || session.controller.signal.aborted) return;
          setIsSaving(false);
          if (saveRes.ok) {
            const loc = saveRes.savedLocation || 'Movies/ShortsQuizStudio';
            setSaveNotice(
              `تم حفظ الفيديو تلقائياً في (${loc}): ${saveRes.fileName || generatedName}`
            );
          } else if (saveRes.error) {
            setSaveNotice(`تعذر الحفظ التلقائي (${saveRes.error})، يمكنك استخدام زر الحفظ أو المشاركة بالأسفل.`);
          }
        }

        if (session.isCurrent() && !session.controller.signal.aborted) {
          exportSessionManager.finishSession(activeProject.id, session.sessionId);
          setSessionState('completed');
        }
      })
      .catch((err: unknown) => {
        if (!session.isCurrent()) return;
        exportSessionManager.finishSession(activeProject.id, session.sessionId);
        if (session.controller.signal.aborted) {
          setSessionState('cancelled');
          return;
        }
        setErrorMsg(formatExportErrorMessage(err));
        setSessionState('failed');
      });
  };

  const startSplitBatchExport = async (
    overrideFormat?: ExportFormatPreference,
    overrideRes?: ExportResolutionPreference,
    overrideQuality?: ExportQualityTier,
    overrideAudio?: boolean
  ) => {
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    const activeProject = projectRef.current;
    if (activeProject.slides.length === 0) return;

    const session = exportSessionManager.beginSession(activeProject.id);
    activeSessionRef.current = session;

    resetExportOutputs();
    setSessionState('preparing');

    const totalCount = activeProject.slides.length;
    try {
      let lastRes: ExportResult | null = null;
      let lastFile = '';
      for (let i = 0; i < totalCount; i++) {
        if (!session.isCurrent() || session.controller.signal.aborted) return;
        const slide = activeProject.slides[i];
        const res = await exportQuizVideo(
          [slide],
          activeProject.template,
          activeProject.timing,
          activeProject.audio,
          (p) => {
            if (!session.isCurrent() || session.controller.signal.aborted) return;
            const overall = (i + p.progress) / totalCount;
            progressRatioRef.current = overall;
            setProgress({
              progress: overall,
              currentTime: p.currentTime,
              totalDuration: p.totalDuration,
              statusText: `سؤال ${i + 1} من ${totalCount}: ${p.statusText || 'جارٍ التصدير...'}`,
              stage: p.stage,
              engineLabel: p.engineLabel,
              fallbackNotice: p.fallbackNotice,
            });
            setSessionState(
              p.stage === 'finalizing'
                ? 'finalizing'
                : p.stage === 'preparing'
                  ? 'preparing'
                  : 'rendering'
            );
          },
          session.controller.signal,
          {
            formatPreference: overrideFormat ?? formatPref,
            resolutionPreference: overrideRes ?? resPref,
            qualityTier: overrideQuality ?? qualityTier,
            includeAudio: overrideAudio ?? includeAudio,
            getPreviewCanvas: () => livePreviewCanvasRef.current,
          }
        );
        if (!session.isCurrent() || session.controller.signal.aborted) return;
        setSessionState('saving');
        const fileName = `quiz-slide-${i + 1}-${Date.now()}.${res.extension || 'mp4'}`;
        const batchSave = await saveOrDownloadBlob(res.blob, fileName, res.mimeType, {
          signal: session.controller.signal,
        });
        if (!batchSave.ok) {
          throw new Error(batchSave.error || `تعذر حفظ الفيديو رقم ${i + 1} على الجهاز`);
        }
        lastRes = res;
        lastFile = batchSave.fileName || fileName;
        setBatchDoneCount(i + 1);
      }

      if (lastRes && session.isCurrent() && !session.controller.signal.aborted) {
        const url = URL.createObjectURL(lastRes.blob);
        setResult(lastRes);
        setVideoUrl(url);
        setExportedFileName(lastFile);
        setElapsedMs(Math.max(0, performance.now() - session.startedAt));
        setEstimatedRemainingMs(0);
        exportSessionManager.finishSession(activeProject.id, session.sessionId);
        setSessionState('completed');
        setSaveNotice(`تم تصدير وحفظ ${totalCount} فيديوهات مستقلة بنجاح.`);
      }
    } catch (err: unknown) {
      if (!session.isCurrent()) return;
      exportSessionManager.finishSession(activeProject.id, session.sessionId);
      if (session.controller.signal.aborted) {
        setSessionState('cancelled');
        return;
      }
      setErrorMsg(formatExportErrorMessage(err));
      setSessionState('failed');
    }
  };

  const startChunkBatchExport = async (
    overrideFormat?: ExportFormatPreference,
    overrideRes?: ExportResolutionPreference,
    overrideQuality?: ExportQualityTier,
    overrideAudio?: boolean
  ) => {
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    const activeProject = projectRef.current;
    if (activeProject.slides.length === 0) return;

    const chunks: typeof activeProject.slides[] = [];
    for (let i = 0; i < activeProject.slides.length; i += chunkSize) {
      chunks.push(activeProject.slides.slice(i, i + chunkSize));
    }
    if (chunks.length === 0) return;

    const session = exportSessionManager.beginSession(activeProject.id);
    activeSessionRef.current = session;

    resetExportOutputs();
    setSessionState('preparing');

    try {
      let lastRes: ExportResult | null = null;
      let lastFile = '';
      for (let i = 0; i < chunks.length; i++) {
        if (!session.isCurrent() || session.controller.signal.aborted) return;
        const packSlides = chunks[i];
        const res = await exportQuizVideo(
          packSlides,
          activeProject.template,
          activeProject.timing,
          activeProject.audio,
          (p) => {
            if (!session.isCurrent() || session.controller.signal.aborted) return;
            const overall = (i + p.progress) / chunks.length;
            progressRatioRef.current = overall;
            setProgress({
              progress: overall,
              currentTime: p.currentTime,
              totalDuration: p.totalDuration,
              statusText: `حزمة ${i + 1} من ${chunks.length} (${packSlides.length} شرائح): ${p.statusText || 'جارٍ التصدير...'}`,
              stage: p.stage,
              engineLabel: p.engineLabel,
              fallbackNotice: p.fallbackNotice,
            });
            setSessionState(
              p.stage === 'finalizing'
                ? 'finalizing'
                : p.stage === 'preparing'
                  ? 'preparing'
                  : 'rendering'
            );
          },
          session.controller.signal,
          {
            formatPreference: overrideFormat ?? formatPref,
            resolutionPreference: overrideRes ?? resPref,
            qualityTier: overrideQuality ?? qualityTier,
            includeAudio: overrideAudio ?? includeAudio,
            getPreviewCanvas: () => livePreviewCanvasRef.current,
          }
        );
        if (!session.isCurrent() || session.controller.signal.aborted) return;
        setSessionState('saving');
        const fileName = `quiz-pack-${i + 1}-of-${chunks.length}-${Date.now()}.${res.extension || 'mp4'}`;
        const packSave = await saveOrDownloadBlob(res.blob, fileName, res.mimeType, {
          signal: session.controller.signal,
        });
        if (!packSave.ok) {
          throw new Error(packSave.error || `تعذر حفظ الحزمة رقم ${i + 1} على الجهاز`);
        }
        lastRes = res;
        lastFile = packSave.fileName || fileName;
        setBatchDoneCount(i + 1);
      }

      if (lastRes && session.isCurrent() && !session.controller.signal.aborted) {
        const url = URL.createObjectURL(lastRes.blob);
        setResult(lastRes);
        setVideoUrl(url);
        setExportedFileName(lastFile);
        setElapsedMs(Math.max(0, performance.now() - session.startedAt));
        setEstimatedRemainingMs(0);
        exportSessionManager.finishSession(activeProject.id, session.sessionId);
        setSessionState('completed');
        setSaveNotice(`تم تصدير وحفظ ${chunks.length} فيديوهات مجمّعة بنجاح.`);
      }
    } catch (err: unknown) {
      if (!session.isCurrent()) return;
      exportSessionManager.finishSession(activeProject.id, session.sessionId);
      if (session.controller.signal.aborted) {
        setSessionState('cancelled');
        return;
      }
      setErrorMsg(formatExportErrorMessage(err));
      setSessionState('failed');
    }
  };

  useEffect(() => {
    const projectId = projectRef.current.id;
    if (!isOpen) {
      exportSessionManager.cancelSession(projectId, activeSessionRef.current?.sessionId);
      activeSessionRef.current = null;
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setScopeMode('full');
      setSelectedSlideIdx(0);
      setSessionState('idle');
      setResult(null);
      setExportedFileName('');
      setBatchDoneCount(0);
      setIsSaving(false);
      setSaveNotice('');
      setErrorMsg('');
      setElapsedMs(0);
      setEstimatedRemainingMs(null);
      setKitError('');
      setYtPanelOpen(true);
      setConfirmUploadOpen(false);
      setYtError('');
      setYtResult(null);
      return;
    }

    setYtPanelOpen(true);
    setScopeMode('full');
    startSingleOrFullExport('full');

    return () => {
      exportSessionManager.cancelSession(projectId, activeSessionRef.current?.sessionId);
      activeSessionRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isStoryStudio = project.studioMode === 'storyStudio';
  const fileName =
    exportedFileName ||
    `${isStoryStudio ? 'story-cinema-3d' : 'youtube-short-quiz'}-${Date.now()}.${result?.extension || 'mp4'}`;

  const handleDownload = async () => {
    if (!result || isSaving) return;
    setIsSaving(true);
    setSaveNotice('');
    const res = await saveOrDownloadBlob(result.blob, fileName, result.mimeType);
    setIsSaving(false);
    if (res.ok) {
      const loc = res.savedLocation || 'Movies/ShortsQuizStudio';
      setSaveNotice(
        res.savedNatively
          ? `تم حفظ الفيديو في (${loc}): ${res.fileName || fileName}`
          : 'بدأ تنزيل الفيديو على جهازك.'
      );
    } else if (res.error) {
      setSaveNotice(`تعذر حفظ الفيديو: ${res.error}`);
    }
  };

  const handleCaptureCover = async () => {
    if (isCapturingThumb) return;
    setIsCapturingThumb(true);
    try {
      if (isStoryStudio) {
        const scenes = project.storyScenes ?? [];
        const schedules = computeStoryTimeline(
          scenes,
          project.timing,
          project.storySettings,
          project.template
        );
        const sched = schedules[0];
        const firstLine = sched?.lines?.[0];
        const captureTime = firstLine
          ? firstLine.startTime + Math.min(0.9, firstLine.duration * 0.4)
          : sched
            ? sched.startTime + Math.min(1.2, sched.duration * 0.3)
            : 0.6;
        const blob = await exportStoryThumbnailJpg(project, captureTime);
        if (blob) {
          const thumbName = `story-cover-${Date.now()}.jpg`;
          const res = await saveOrDownloadBlob(blob, thumbName, 'image/jpeg');
          if (res.ok) {
            setSaveNotice('تم حفظ صورة الغلاف (JPG) بدقة الفيديو الكاملة.');
          } else if (res.error) {
            setSaveNotice(`تعذر حفظ الغلاف: ${res.error}`);
          }
        }
        return;
      }

      const targetIdx = scopeMode === 'single' ? selectedSlideIdx : 0;
      const targetSlides =
        scopeMode === 'single' && project.slides[targetIdx]
          ? [project.slides[targetIdx]]
          : project.slides;
      const schedules = computeProjectTimeline(
        targetSlides,
        project.timing,
        project.audio,
        project.template
      );
      const sched = schedules[0];
      const captureTime = sched
        ? sched.startTime +
          sched.tThinkingStart +
          Math.min(1.1, project.timing.thinkingDuration * 0.25)
        : 0.5;
      const blob = await exportThumbnailJpg(
        targetSlides,
        project.template,
        project.timing,
        project.audio,
        captureTime
      );
      if (blob) {
        const thumbName = `quiz-cover-${Date.now()}.jpg`;
        const res = await saveOrDownloadBlob(blob, thumbName, 'image/jpeg');
        if (res.ok) {
          setSaveNotice('تم حفظ صورة الغلاف (JPG) بدقة الفيديو الكاملة.');
        } else if (res.error) {
          setSaveNotice(`تعذر حفظ الغلاف: ${res.error}`);
        }
      }
    } finally {
      setIsCapturingThumb(false);
    }
  };

  const canNativeShare = !!result && canShareNatively(fileName, result.mimeType, result.blob);
  const runningInAndroidApk = isAndroidNativeApp();
  const ytNativeMode = getYouTubeNativeMode();

  const handleShareVideo = async (copyMetadataFirst = false) => {
    if (!result || isSaving) return;
    if (copyMetadataFirst) {
      try {
        await navigator.clipboard.writeText(
          `${publishKit.title}\n\n${publishKit.description}`.trim()
        );
        setSaveNotice('تم نسخ العنوان والوصف، اختر تطبيق YouTube من قائمة المشاركة لإكمال النشر.');
      } catch {
        // ignore clipboard denial
      }
    }
    try {
      setIsSaving(true);
      await shareBlobNatively(
        result.blob,
        fileName,
        result.mimeType,
        publishKit.title || 'فيديو شورتس الأسئلة',
        publishKit.title || ''
      );
    } catch {
      // User cancelled share sheet
    } finally {
      setIsSaving(false);
    }
  };

  const handleSafeCancelExport = () => {
    exportSessionManager.cancelSession(
      projectRef.current.id,
      activeSessionRef.current?.sessionId
    );
    activeSessionRef.current = null;
    setIsSaving(false);
    setSessionState('cancelled');
  };

  const handleCancelAndClose = () => {
    exportSessionManager.cancelSession(
      projectRef.current.id,
      activeSessionRef.current?.sessionId
    );
    activeSessionRef.current = null;
    onClose();
  };

  const handleSwitchScope = (nextScope: ExportScopeMode) => {
    if (nextScope === scopeMode && sessionState !== 'idle' && sessionState !== 'cancelled') return;
    exportSessionManager.cancelSession(
      projectRef.current.id,
      activeSessionRef.current?.sessionId
    );
    activeSessionRef.current = null;
    setScopeMode(nextScope);
    if (nextScope === 'full') {
      startSingleOrFullExport('full');
    } else {
      setSessionState('idle');
      setSaveNotice('');
      setErrorMsg('');
    }
  };

  const handleGeneratePublishKit = async () => {
    if (isGeneratingKit) return;
    setIsGeneratingKit(true);
    setKitError('');
    try {
      const targetSlides = isStoryStudio
        ? (project.storyScenes ?? []).map((sc, idx) => ({
            id: sc.id,
            slideType: 'story' as const,
            badgeText: `المشهد ${idx + 1}`,
            question: `${sc.title || `مشهد ${idx + 1}`}: ${(sc.lines[0]?.text || '').slice(0, 90)}`,
            options: [
              sc.lines[0]?.text || '',
              sc.lines[1]?.text || '',
              sc.lines[2]?.text || '',
              sc.lines[3]?.text || '',
            ] as [string, string, string, string],
            correctIndex: 0 as const,
            explanationText: project.storySettings?.endMoralTitle || '',
          }))
        : getActiveTargetSlides();
      const generated = await generateYoutubePublishKit(
        targetSlides,
        project.template.aspectRatio,
        project.template.showIntroHook ? project.template.introHookText : project.storyTitle
      );
      const hashtagsLine = generated.hashtags.join(' ');
      const fullDescription =
        hashtagsLine && !generated.description.includes(generated.hashtags[0] || '')
          ? `${generated.description}\n\n${hashtagsLine}`.trim()
          : generated.description;

      onUpdatePublishKit(() => ({
        ...generated,
        description: fullDescription,
      }));
      onUpdateTagsInput(generated.tags.join('، '));
    } catch (err) {
      setKitError(err instanceof Error ? err.message : 'تعذر توليد حزمة النشر بالذكاء الاصطناعي.');
    } finally {
      setIsGeneratingKit(false);
    }
  };

  const copyText = async (field: string, text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((cur) => (cur === field ? null : cur));
      }, 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const parsedTags = tagsInput
    .split(/[,،\n]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);

  const handleConfirmYouTubeUpload = async () => {
    if (!result || isUploadingYt) return;
    let publishAtIso: string | undefined;
    if (ytUseSchedule) {
      if (!ytScheduleLocal) {
        setYtError('يرجى تحديد تاريخ ووقت النشر المجدول.');
        return;
      }
      const d = new Date(ytScheduleLocal);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now() + 60_000) {
        setYtError('اختر وقتاً مستقبلياً للجدولة (بعد دقيقة على الأقل من الآن).');
        return;
      }
      publishAtIso = d.toISOString();
    }

    setConfirmUploadOpen(false);
    setIsUploadingYt(true);
    setYtError('');
    setYtResult(null);
    setYtUploadPct(2);
    setYtUploadStage('جارٍ تجهيز الرفع...');

    try {
      const uploadRes = await uploadVideoToYouTube({
        blob: result.blob,
        mimeType: result.mimeType,
        title: publishKit.title,
        description: publishKit.description,
        tags: parsedTags,
        privacyStatus: ytPrivacy,
        publishAtIso,
        playlistId: selectedPlaylistId || undefined,
        pinnedComment: ytAutoPostComment ? publishKit.pinnedComment : undefined,
        onProgress: (pct, txt) => {
          setYtUploadPct(pct);
          setYtUploadStage(txt);
        },
      });
      setYtResult(uploadRes);
    } catch (err) {
      setYtError(err instanceof Error ? err.message : 'فشل رفع الفيديو إلى YouTube.');
    } finally {
      setIsUploadingYt(false);
    }
  };

  const dims = getCanvasDimensions(project.template);
  const isWideRatio = project.template.aspectRatio === '16:9';
  const ratioLabel = isWideRatio ? '16:9' : '9:16';
  const effectiveYtError = ytError || ytAuthError;
  const miniPreviewW = isWideRatio ? 240 : 135;
  const miniPreviewH = isWideRatio ? 135 : 240;

  const sessionStateLabel: Record<ExportSessionState, string> = {
    idle: 'جاهز للتصدير',
    preparing: 'جارٍ التحضير',
    rendering: 'جارٍ التصيير والترميز',
    finalizing: 'جارٍ إنهاء الملف',
    saving: 'جارٍ الحفظ على الجهاز',
    completed: 'مكتمل',
    failed: 'تعذر التصدير',
    cancelled: 'تم الإلغاء',
  };

  const retriggerIfNeeded = (
    nextFmt: ExportFormatPreference,
    nextRes: ExportResolutionPreference,
    nextQuality: ExportQualityTier,
    nextAudio: boolean
  ) => {
    if (
      scopeMode === 'full' &&
      (sessionState === 'completed' || sessionState === 'failed' || sessionState === 'cancelled')
    ) {
      startSingleOrFullExport('full', 0, nextFmt, nextRes, nextQuality, nextAudio);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4">
      <div className="w-full max-w-xl rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl overflow-hidden text-[var(--ptxt)] max-h-[95dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-[var(--pline)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Film className="w-5 h-5 text-[#00B050] shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold truncate">
                تصدير ونشر الفيديو ({dims.width}×{dims.height})
              </h3>
              {capabilities && (
                <p className="text-[10px] text-[var(--pmuted)] truncate">
                  {capabilities.hasWebCodecsVideo
                    ? `محرك WebCodecs السريع (${capabilities.supportsMp4 ? 'MP4' : ''}${capabilities.supportsMp4 && capabilities.supportsWebm ? ' · ' : ''}${capabilities.supportsWebm ? 'WebM' : ''})`
                    : 'محرك MediaRecorder المتوافق'}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelAndClose}
            className="p-1.5 rounded-lg text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-3 sm:p-5 flex flex-col gap-3 sm:gap-4 overflow-y-auto">
          {/* Export Format, Quality, Resolution & Audio Switcher */}
          <div className="flex flex-col gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[var(--pmuted)] shrink-0">الصيغة:</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                  {(
                    [
                      { id: 'auto', label: 'تلقائي' },
                      { id: 'mp4', label: 'MP4' },
                      { id: 'webm', label: 'WebM' },
                    ] as { id: ExportFormatPreference; label: string }[]
                  ).map((fmt) => {
                    const active = formatPref === fmt.id;
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        disabled={isExportActive}
                        onClick={() => {
                          setFormatPref(fmt.id);
                          retriggerIfNeeded(fmt.id, resPref, qualityTier, includeAudio);
                        }}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                          active
                            ? 'bg-[#00B050] text-white'
                            : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[var(--pmuted)] shrink-0">الدقة:</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                  {(
                    [
                      { id: 'auto', label: 'تلقائية' },
                      { id: '720p', label: '720p' },
                      { id: '1080p', label: '1080p' },
                    ] as { id: ExportResolutionPreference; label: string }[]
                  ).map((rq) => {
                    const active = resPref === rq.id;
                    return (
                      <button
                        key={rq.id}
                        type="button"
                        disabled={isExportActive}
                        onClick={() => {
                          setResPref(rq.id);
                          retriggerIfNeeded(formatPref, rq.id, qualityTier, includeAudio);
                        }}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                          active
                            ? 'bg-[#00B050] text-white'
                            : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                        }`}
                      >
                        {rq.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[var(--pline)]/60">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-[var(--pmuted)] shrink-0">الجودة:</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                  {(['economy', 'balanced', 'max'] as ExportQualityTier[]).map((tierId) => {
                    const tier = EXPORT_QUALITY_TIERS[tierId];
                    const active = qualityTier === tierId;
                    return (
                      <button
                        key={tierId}
                        type="button"
                        disabled={isExportActive}
                        title={tier.shortDesc}
                        onClick={() => {
                          setQualityTier(tierId);
                          retriggerIfNeeded(formatPref, resPref, tierId, includeAudio);
                        }}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                          active
                            ? 'bg-[#00B050] text-white'
                            : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                        }`}
                      >
                        {tier.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                disabled={isExportActive}
                onClick={() => {
                  const nextAudio = !includeAudio;
                  setIncludeAudio(nextAudio);
                  retriggerIfNeeded(formatPref, resPref, qualityTier, nextAudio);
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                  includeAudio
                    ? 'bg-[#00B050]/12 border-[#00B050]/45 text-[#00B050] dark:text-[#6ee7b7]'
                    : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--pmuted)]'
                }`}
              >
                {includeAudio ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                <span>{includeAudio ? 'مع الصوت' : 'بدون صوت'}</span>
              </button>
            </div>
          </div>

          {/* Export Scope Switcher (Quiz Studio only) */}
          {!isStoryStudio && project.slides.length > 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <button
                type="button"
                onClick={() => handleSwitchScope('full')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  scopeMode === 'full'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                الفيديو الكامل
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('single')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  scopeMode === 'single'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                سؤال محدد
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('splitBatch')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  scopeMode === 'splitBatch'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                كل سؤال مستقل
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('chunkBatch')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  scopeMode === 'chunkBatch'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                مجموعات أسبوعية
              </button>
            </div>
          )}

          {/* Idle controls for single slide, split batch, or weekly pack mode */}
          {!isStoryStudio && (sessionState === 'idle' || sessionState === 'cancelled') && scopeMode === 'single' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-[var(--ptxt)]">
                  اختر السؤال لتصديره كفيديو مستقل:
                </span>
                <select
                  value={selectedSlideIdx}
                  onChange={(e) => setSelectedSlideIdx(parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                >
                  {project.slides.map((sl, i) => (
                    <option key={sl.id} value={i}>
                      سؤال {i + 1}: {(sl.question || '').slice(0, 48)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => startSingleOrFullExport('single', selectedSlideIdx)}
                className="w-full py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                بدء تصدير السؤال {selectedSlideIdx + 1}
              </button>
            </div>
          )}

          {!isStoryStudio && (sessionState === 'idle' || sessionState === 'cancelled') && scopeMode === 'splitBatch' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex items-start gap-2 text-xs text-[var(--ptxt)] leading-relaxed">
                <Layers className="w-4 h-4 text-[#00B050] shrink-0 mt-0.5" />
                <span>
                  سيتم تجهيز وحفظ <strong>{project.slides.length} فيديوهات شورتس مستقلة</strong>{' '}
                  (سؤال واحد في كل فيديو) بنفس التصميم والأصوات تباعاً.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void startSplitBatchExport()}
                className="w-full py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                تصدير وتنزيل كل الأسئلة ({project.slides.length} فيديو)
              </button>
            </div>
          )}

          {!isStoryStudio && (sessionState === 'idle' || sessionState === 'cancelled') && scopeMode === 'chunkBatch' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--ptxt)]">
                  عدد الشرائح في كل فيديو:
                </span>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                  {([3, 5, 10] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setChunkSize(sz)}
                      className={`px-3 py-1 rounded-md text-xs font-mono-nums font-bold cursor-pointer ${
                        chunkSize === sz
                          ? 'bg-[#00B050] text-white'
                          : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-[var(--pmuted)] leading-relaxed">
                سيتم تقسيم الـ {project.slides.length} شريحة تلقائياً إلى{' '}
                <strong className="text-[var(--ptxt)]">
                  {Math.ceil(project.slides.length / chunkSize)} فيديوهات متتالية
                </strong>{' '}
                وحفظها على الجهاز تباعاً (مناسبة للنشر اليومي أو الأسبوعي).
              </p>
              <button
                type="button"
                onClick={() => void startChunkBatchExport()}
                className="w-full py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                تصدير وتنزيل {Math.ceil(project.slides.length / chunkSize)} فيديوهات مجمّعة
              </button>
            </div>
          )}

          {/* Active export session progress card */}
          {isExportActive && (
            <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex items-center gap-3">
                <div className="shrink-0 rounded-lg overflow-hidden border border-[var(--pline)] bg-black/80 flex items-center justify-center">
                  <canvas
                    ref={livePreviewCanvasRef}
                    width={miniPreviewW}
                    height={miniPreviewH}
                    className={
                      isWideRatio
                        ? 'w-20 sm:w-24 h-[45px] sm:h-[54px] object-contain'
                        : 'w-[48px] sm:w-[54px] h-[85px] sm:h-24 object-contain'
                    }
                  />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="truncate font-semibold">
                      {progress.statusText || sessionStateLabel[sessionState]}
                    </span>
                    <span className="font-mono-nums text-[#00B050] font-bold shrink-0">
                      {Math.round(progress.progress * 100)}%
                    </span>
                  </div>

                  <div className="w-full h-2.5 rounded-full bg-[var(--panel)] overflow-hidden border border-[var(--pline)]">
                    <div
                      className="h-full bg-[#00B050] transition-all duration-150"
                      style={{ width: `${Math.round(progress.progress * 100)}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-[11px] text-[var(--pmuted)] gap-x-3 gap-y-1">
                    <span className="truncate">
                      {progress.engineLabel || `${ratioLabel} · ${sessionStateLabel[sessionState]}`}
                    </span>
                    <span className="font-mono-nums shrink-0">
                      {progress.currentTime.toFixed(1)} / {progress.totalDuration.toFixed(1)} ث
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-[10px] text-[var(--pmuted)] gap-2">
                    <span className="flex items-center gap-1 font-mono-nums">
                      <Clock className="w-3 h-3 text-[#00B050]" />
                      المنقضي: {formatDurationCompact(elapsedMs)}
                    </span>
                    <span className="font-mono-nums">
                      المتبقي التقديري:{' '}
                      {estimatedRemainingMs !== null
                        ? formatDurationCompact(estimatedRemainingMs)
                        : 'جارٍ الحساب...'}
                    </span>
                  </div>
                </div>
              </div>

              {progress.fallbackNotice && (
                <div className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/35 text-[11px] text-amber-600 dark:text-amber-300">
                  {progress.fallbackNotice}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--pline)]/60">
                <span className="text-[10px] text-[var(--pmuted)]">
                  الحالة: <strong className="text-[var(--ptxt)]">{sessionStateLabel[sessionState]}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleSafeCancelExport}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/12 border border-rose-500/35 hover:bg-rose-500/20 text-rose-500 dark:text-rose-300 text-[11px] font-bold cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>إلغاء التصدير بأمان</span>
                </button>
              </div>
            </div>
          )}

          {/* Cancelled notice */}
          {sessionState === 'cancelled' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/35">
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>تم إلغاء التصدير بأمان وتنظيف الموارد المؤقتة.</span>
              </div>
              {scopeMode === 'full' && (
                <button
                  type="button"
                  onClick={() => startSingleOrFullExport('full')}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>بدء التصدير مجدداً</span>
                </button>
              )}
            </div>
          )}

          {sessionState === 'completed' && videoUrl && result && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-bold text-[#00B050]">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>
                    {scopeMode === 'splitBatch'
                      ? `تم تجهيز وتنزيل ${batchDoneCount} فيديو بنجاح`
                      : result.hasAudio
                        ? 'تم تجهيز الفيديو بنجاح مع الصوت'
                        : 'تم تجهيز الفيديو بنجاح (بدون صوت)'}
                  </span>
                </div>
                <span className="text-[10px] font-mono-nums text-[var(--pmuted)]">
                  الزمن: {formatDurationCompact(elapsedMs)}
                </span>
              </div>

              <div className="w-full max-h-[240px] flex justify-center bg-black rounded-xl overflow-hidden border border-[var(--pline)]">
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  className="h-[220px] sm:h-[240px] w-auto object-contain"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--pmuted)] px-1">
                <span>
                  الصيغة: <strong className="text-[var(--ptxt)]">{result.extension.toUpperCase()}</strong> ·{' '}
                  {result.width}×{result.height} ({result.fps}fps)
                </span>
                <span className="truncate">{result.engineLabel}</span>
                <span className="font-mono-nums">
                  الحجم: {(result.blob.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>

              {result.usedFallback && result.fallbackReason && (
                <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/35 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  {result.fallbackReason}
                </div>
              )}

              {saveNotice && (
                <div
                  className={`px-3 py-2 rounded-xl border text-xs leading-relaxed break-words ${
                    saveNotice.startsWith('تعذر')
                      ? 'bg-rose-500/12 border-rose-500/35 text-rose-600 dark:text-rose-300'
                      : 'bg-[#00B050]/12 border-[#00B050]/35 text-[#00B050] dark:text-[#6ee7b7]'
                  }`}
                >
                  {saveNotice}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleDownload()}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-60 text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>
                    {isSaving
                      ? 'جارٍ الحفظ...'
                      : runningInAndroidApk
                        ? 'حفظ الفيديو في المعرض'
                        : 'حفظ / تنزيل الفيديو'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isCapturingThumb}
                  onClick={() => void handleCaptureCover()}
                  title="حفظ صورة غلاف JPG بدقة كاملة"
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-[#00B050]" />
                  <span>{isCapturingThumb ? '...' : 'غلاف JPG'}</span>
                </button>
                {canNativeShare && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleShareVideo(runningInAndroidApk)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 ${
                      runningInAndroidApk
                        ? 'w-full justify-center bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-[var(--surface)] border border-[#00B050]/40 text-[#00B050] dark:text-[#6ee7b7]'
                    }`}
                  >
                    {runningInAndroidApk ? (
                      <Youtube className="w-4 h-4 shrink-0" />
                    ) : (
                      <Share2 className="w-4 h-4 shrink-0" />
                    )}
                    <span>
                      {runningInAndroidApk
                        ? 'مشاركة / رفع عبر تطبيق YouTube الآن (مع نسخ العنوان والوصف)'
                        : 'مشاركة الفيديو'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          {sessionState === 'failed' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/35">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs sm:text-sm text-rose-600 dark:text-rose-300 leading-relaxed">
                  {errorMsg}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (scopeMode === 'splitBatch') {
                      void startSplitBatchExport();
                    } else if (scopeMode === 'single') {
                      startSingleOrFullExport('single', selectedSlideIdx);
                    } else {
                      startSingleOrFullExport('full');
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>إعادة التصدير الآن</span>
                </button>
                {formatPref !== 'webm' && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormatPref('webm');
                      if (scopeMode === 'splitBatch') {
                        void startSplitBatchExport('webm', resPref, qualityTier, includeAudio);
                      } else if (scopeMode === 'single') {
                        startSingleOrFullExport(
                          'single',
                          selectedSlideIdx,
                          'webm',
                          resPref,
                          qualityTier,
                          includeAudio
                        );
                      } else {
                        startSingleOrFullExport('full', 0, 'webm', resPref, qualityTier, includeAudio);
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold text-[var(--ptxt)] cursor-pointer"
                  >
                    تجربة صيغة WebM الآمنة
                  </button>
                )}
                {resPref !== '720p' && (
                  <button
                    type="button"
                    onClick={() => {
                      setResPref('720p');
                      setQualityTier('economy');
                      if (scopeMode === 'splitBatch') {
                        void startSplitBatchExport(formatPref, '720p', 'economy', includeAudio);
                      } else if (scopeMode === 'single') {
                        startSingleOrFullExport(
                          'single',
                          selectedSlideIdx,
                          formatPref,
                          '720p',
                          'economy',
                          includeAudio
                        );
                      } else {
                        startSingleOrFullExport(
                          'full',
                          0,
                          formatPref,
                          '720p',
                          'economy',
                          includeAudio
                        );
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold text-[var(--ptxt)] cursor-pointer"
                  >
                    تجربة الجودة الاقتصادية (720p)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 1. Direct YouTube Upload Section (Always Visible) */}
          <div className="rounded-xl bg-[var(--surface)] border border-rose-500/35 p-3.5 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setYtPanelOpen((v) => !v)}
              className="flex items-center justify-between w-full text-right cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Youtube className="w-4 h-4 text-rose-500 shrink-0" />
                <span className="text-xs font-extrabold text-[var(--ptxt)] truncate">
                  الرفع المباشر إلى قناتك على YouTube
                </span>
                {ytConnected && (
                  <span className="text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] shrink-0">
                    · {ytChannel?.title || ytEmail || 'متصل'}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-bold text-rose-500 dark:text-rose-400 shrink-0">
                {ytPanelOpen ? 'إخفاء' : 'فتح'}
              </span>
            </button>

            {ytPanelOpen && (
              <div className="flex flex-col gap-3 pt-2 border-t border-[var(--pline)]">
                {!ytConnected ? (
                  ytNativeMode === 'standalone-apk' ? (
                    <div className="flex flex-col gap-2.5 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--pmuted)] leading-relaxed">
                      <p className="font-bold text-[var(--ptxt)]">
                        النشر أو تسجيل الدخول من تطبيق الأندرويد (APK):
                      </p>
                      <button
                        type="button"
                        onClick={() => launchWebLinkLoginForApk(getWebLoginBaseUrl())}
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl bg-white hover:bg-[#f8f9fa] text-[#1f1f1f] border border-[#747775]/45 text-xs font-extrabold shadow-sm transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4 text-[#4285F4]" />
                        <span>تسجيل الدخول عبر رابط الموقع (Chrome) والعودة للتطبيق</span>
                      </button>
                      <p>
                        أو بعد اكتمال التصدير بالأعلى، يُحفظ الفيديو تلقائياً في المعرض ويمكنك ضغط زر{' '}
                        <strong className="text-rose-400">«مشاركة / رفع عبر تطبيق YouTube الآن»</strong>{' '}
                        لإرسال الفيديو مباشرة إلى تطبيق يوتيوب.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                        اختر أي حساب Google أو قناة يوتيوب تريد الرفع عليها:
                      </p>
                      <GoogleSignInButton
                        loading={isConnectingYt}
                        label="تسجيل الدخول بحساب Google / ربط قناة"
                        onClick={() => void onConnectYouTube()}
                      />
                    </div>
                  )
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                      <div className="flex items-center gap-2 min-w-0">
                        {ytChannel?.thumbnailUrl ? (
                          <img
                            src={ytChannel.thumbnailUrl}
                            alt={ytChannel.title}
                            className="w-7 h-7 rounded-full shrink-0"
                          />
                        ) : (
                          <Youtube className="w-4 h-4 text-rose-500 shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold truncate">
                            {ytChannel?.title || 'حساب Google متصل'}
                          </span>
                          {ytEmail && (
                            <span className="text-[10px] text-[var(--pmuted)] truncate" dir="ltr">
                              {ytEmail}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isConnectingYt}
                          onClick={() => void onConnectYouTube()}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-bold cursor-pointer"
                        >
                          <RefreshCw className={`w-3 h-3 text-[#00B050] ${isConnectingYt ? 'animate-spin' : ''}`} />
                          <span>تبديل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDisconnectYouTube()}
                          className="flex items-center gap-1 text-[11px] text-[var(--pmuted)] hover:text-rose-400 cursor-pointer shrink-0"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>خروج</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'private', label: 'خاص (آمن)' },
                          { id: 'unlisted', label: 'غير مدرج' },
                          { id: 'public', label: 'علني مباشرة' },
                        ] as { id: YouTubePrivacyStatus; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={ytUseSchedule}
                          onClick={() => onChangePrivacy(opt.id)}
                          className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                            !ytUseSchedule && ytPrivacy === opt.id
                              ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                              : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--pmuted)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ytUseSchedule}
                          onChange={(e) => onChangeUseSchedule(e.target.checked)}
                          className="accent-[#00B050]"
                        />
                        <CalendarClock className="w-3.5 h-3.5 text-[var(--gold)]" />
                        <span>جدولة موعد النشر</span>
                      </label>
                      {ytUseSchedule && (
                        <input
                          type="datetime-local"
                          value={ytScheduleLocal}
                          onChange={(e) => onChangeScheduleLocal(e.target.value)}
                          className="px-2 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px]"
                        />
                      )}
                    </div>

                    {ytPlaylists.length > 0 && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[var(--pmuted)]">
                          إضافة إلى قائمة تشغيل (اختياري):
                        </span>
                        <select
                          value={selectedPlaylistId}
                          onChange={(e) => onSelectPlaylistId(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                        >
                          <option value="">بدون قائمة تشغيل</option>
                          {ytPlaylists.map((pl) => (
                            <option key={pl.id} value={pl.id}>
                              {pl.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="flex items-center gap-2 text-[11px] font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ytAutoPostComment}
                        onChange={(e) => onChangeAutoPostComment(e.target.checked)}
                        className="accent-[#00B050]"
                      />
                      <span>نشر التعليق التفاعلي تلقائياً تحت الفيديو (عند النشر كغير مدرج أو علني)</span>
                    </label>

                    {!confirmUploadOpen && !isUploadingYt && (
                      <button
                        type="button"
                        disabled={sessionState !== 'completed' || !result}
                        onClick={() => {
                          setYtError('');
                          setConfirmUploadOpen(true);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer disabled:cursor-not-allowed"
                      >
                        <UploadCloud className="w-4 h-4" />
                        <span>
                          {sessionState === 'completed' && result
                            ? 'رفع الفيديو إلى YouTube'
                            : 'بانتظار اكتمال تجهيز الفيديو للرفع...'}
                        </span>
                      </button>
                    )}

                    {confirmUploadOpen && !isUploadingYt && (
                      <div className="p-3 rounded-xl bg-[var(--panel)] border border-amber-500/45 flex flex-col gap-2.5">
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                          تأكيد النشر على قناة YouTube:
                        </p>
                        <ul className="text-[11px] text-[var(--pmuted)] space-y-1">
                          <li>
                            • القناة: {ytChannel?.title || 'القناة المتصلة'}
                            {ytEmail ? ` (${ytEmail})` : ''}
                          </li>
                          <li>• العنوان: {publishKit.title}</li>
                          <li>
                            • الحالة:{' '}
                            {ytUseSchedule
                              ? `مجدول (${ytScheduleLocal})`
                              : ytPrivacy === 'public'
                                ? 'علني (يظهر للجميع فوراً)'
                                : ytPrivacy === 'unlisted'
                                  ? 'غير مدرج'
                                  : 'خاص (يظهر لك فقط)'}
                          </li>
                          <li>
                            • التعليق التلقائي:{' '}
                            {ytAutoPostComment && publishKit.pinnedComment.trim()
                              ? 'مفعّل'
                              : 'غير مفعّل'}
                          </li>
                        </ul>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleConfirmYouTubeUpload()}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>تأكيد الرفع الآن</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmUploadOpen(false)}
                            className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs font-semibold cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    {isUploadingYt && (
                      <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                        <div className="flex items-center justify-between text-[11px]">
                          <span>{ytUploadStage}</span>
                          <span className="font-mono-nums font-bold text-[#00B050]">
                            {ytUploadPct}%
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-[var(--surface)] overflow-hidden">
                          <div
                            className="h-full bg-rose-500 transition-all duration-150"
                            style={{ width: `${ytUploadPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {effectiveYtError && (
                  <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-[11px] text-rose-600 dark:text-rose-300 leading-relaxed">
                    {effectiveYtError}
                  </div>
                )}

                {ytResult && (
                  <div className="p-3 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
                        تم رفع الفيديو إلى YouTube بنجاح!
                      </span>
                      <a
                        href={ytResult.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] text-white text-[11px] font-bold"
                      >
                        <span>فتح الفيديو</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    {ytResult.commentNote && (
                      <p className="text-[11px] text-[var(--ptxt)] leading-relaxed">
                        {ytResult.commentNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. AI YouTube Publishing Kit Section (Always Visible) */}
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--pline)] p-3.5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--gold)]" />
                <span className="text-xs font-extrabold text-[var(--ptxt)]">
                  حزمة النشر على YouTube (عنوان · وصف · هاشتاغات · تعليق)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isGeneratingKit}
                  onClick={() => void handleGeneratePublishKit()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-60 text-white text-[11px] font-bold cursor-pointer"
                >
                  {isGeneratingKit ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isGeneratingKit ? 'جارٍ التوليد...' : 'توليد بالذكاء الاصطناعي'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      'all',
                      `العنوان:\n${publishKit.title}\n\nالوصف:\n${publishKit.description}\n\nالكلمات المفتاحية:\n${tagsInput}\n\nالتعليق المثبت:\n${publishKit.pinnedComment}`
                    )
                  }
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-bold cursor-pointer"
                >
                  {copiedField === 'all' ? (
                    <Check className="w-3.5 h-3.5 text-[#00B050]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[var(--gold)]" />
                  )}
                  <span>{copiedField === 'all' ? 'تم النسخ' : 'نسخ الكل'}</span>
                </button>
              </div>
            </div>

            {kitError && (
              <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-[11px] text-rose-600 dark:text-rose-300">
                {kitError}
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">عنوان الفيديو</span>
                  <button
                    type="button"
                    onClick={() => void copyText('title', publishKit.title)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'title' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'title' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={publishKit.title}
                  onChange={(e) =>
                    onUpdatePublishKit((p) => ({ ...p, title: e.target.value }))
                  }
                  maxLength={100}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">
                    الوصف والهاشتاغات
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('desc', publishKit.description)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'desc' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'desc' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={publishKit.description}
                  onChange={(e) =>
                    onUpdatePublishKit((p) => ({ ...p, description: e.target.value }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none resize-y"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">
                    الكلمات المفتاحية (Tags - مفصولة بفاصلة)
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('tags', tagsInput)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'tags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'tags' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => onUpdateTagsInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">
                    التعليق التفاعلي الجاهز للتثبيت
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('comment', publishKit.pinnedComment)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'comment' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'comment' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={publishKit.pinnedComment}
                  onChange={(e) =>
                    onUpdatePublishKit((p) => ({ ...p, pinnedComment: e.target.value }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCancelAndClose}
            className="w-full py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
          >
            {isExportActive ? 'إلغاء التصدير وإغلاق' : 'إغلاق'}
          </button>
        </div>
      </div>
    </div>
  );
};
