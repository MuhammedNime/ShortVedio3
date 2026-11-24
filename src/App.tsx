import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Brain,
  Clapperboard,
  FileText,
  Film,
  FolderOpen,
  Layers,
  Lock,
  MapPin,
  Menu,
  Moon,
  Music,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Undo2,
  Users,
  Wand2,
  X,
  Youtube,
} from 'lucide-react';
import { soundEngine } from './audio/soundEngine';
import { AiGeneratorPanel } from './components/AiGeneratorPanel';
import { AppLockScreen, ManageLockModal } from './components/AppLockGate';
import { AudioTimingPanel } from './components/AudioTimingPanel';
import { BulkImportPanel } from './components/BulkImportPanel';
import { ExportVideoModal } from './components/ExportVideoModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ProjectsModal } from './components/ProjectsModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { QuestionBankVaultModal } from './components/QuestionBankVaultModal';
import { QuickStartModal } from './components/QuickStartModal';
import { ShortsPreviewStage } from './components/ShortsPreviewStage';
import { SlidesEditorPanel } from './components/SlidesEditorPanel';
import { StoryAiGeneratorPanel } from './components/StoryAiGeneratorPanel';
import { StoryCastLocationsPanel } from './components/StoryCastLocationsPanel';
import { StoryScenesPanel } from './components/StoryScenesPanel';
import { StoryStoryboardBar } from './components/StoryStoryboardBar';
import { StoryTemplateAudioPanel } from './components/StoryTemplateAudioPanel';
import { StudioAppearanceModal } from './components/StudioAppearanceModal';
import { StudioStoryboardBar } from './components/StudioStoryboardBar';
import { TemplateDesignPanel } from './components/TemplateDesignPanel';
import { GoogleSignInButton, YouTubePublishPanel } from './components/YouTubePublishPanel';
import {
  BUILTIN_3D_CHARACTERS,
  DEFAULT_STORY_CINEMA_SETTINGS,
  createDefaultStoryScenes,
} from './data/storyAssets';
import { YoutubePublishKit } from './services/aiClient';
import {
  YouTubeChannelInfo,
  YouTubePlaylistItem,
  YouTubePrivacyStatus,
  completeApkWebLoginFromBrowser,
  connectYouTubeWithPopup,
  disconnectYouTubeSession,
  fetchMyYouTubePlaylists,
  initYouTubeAuthListener,
} from './services/youtubeClient';
import {
  ensureStoryDataOnProject,
  loadProjectFromStore,
  normalizeLoadedProject,
  saveProjectToStore,
} from './storage/projectStore';
import {
  QuestionSlide,
  QuizProject,
  STUDIO_THEME_ORDER,
  SlideType,
  StoryScene,
  StudioMode,
  applyChannelThemePreset,
  applyStudioThemePreset,
  applyThemeBackgroundOnly,
  createDefaultProject,
  getCanvasDimensions,
  getProjectTotalDuration,
} from './types/quiz';
import { isAppLockEnabled } from './utils/appLock';
import { setRootBackHandler } from './utils/androidBack';
import { isAndroidNativeApp } from './utils/nativeDownload';
import {
  StudioUiPreferences,
  applyStudioUiSkinToDom,
  loadStudioUiPreferences,
  saveStudioUiPreferences,
} from './utils/studioUiTheme';

type StudioTab = 'slides' | 'ai' | 'template' | 'audio' | 'import' | 'youtube';
type StoryTab = 'scenes' | 'storyCast' | 'storyLocations' | 'storyAi' | 'storyLook' | 'youtube';
type MobileStageMode = 'compact' | 'expanded' | 'collapsed';

const ApkWebLoginBridge: React.FC<{ onStayInWeb: () => void }> = ({ onStayInWeb }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [returnDeepLink, setReturnDeepLink] = useState('');
  const [signedEmail, setSignedEmail] = useState<string | null>(null);
  const [signedChannel, setSignedChannel] = useState<string | null>(null);

  const handleBrowserLogin = async () => {
    if (loading) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await completeApkWebLoginFromBrowser();
      setReturnDeepLink(res.deepLinkUrl);
      setSignedEmail(res.email);
      setSignedChannel(res.channel?.title ?? null);
      window.location.href = res.deepLinkUrl;
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر إتمام تسجيل الدخول بحساب Google.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--page)] text-[var(--ptxt)] p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--panel)] border border-[var(--pline)] p-6 shadow-2xl flex flex-col gap-4 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-[#00B050]/15 border border-[#00B050]/35 flex items-center justify-center">
          <Youtube className="w-6 h-6 text-rose-500" />
        </div>
        <h1 className="text-lg font-extrabold">ربط حساب Google والعودة للتطبيق</h1>
        <p className="text-xs text-[var(--pmuted)] leading-relaxed">
          سجّل دخولك عبر المتصفح بحساب Google / YouTube المطلوب، وسيتم إعادتك تلقائياً إلى تطبيق{' '}
          <strong>استوديو شورتس الأسئلة</strong> مسجلاً الدخول وجاهزاً للرفع.
        </p>

        {!returnDeepLink ? (
          <GoogleSignInButton
            loading={loading}
            label="تسجيل الدخول بحساب Google والعودة للتطبيق"
            onClick={() => void handleBrowserLogin()}
          />
        ) : (
          <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40">
            <p className="text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
              تم تسجيل الدخول بنجاح {signedChannel ? `(${signedChannel})` : signedEmail ? `(${signedEmail})` : ''}
            </p>
            <a
              href={returnDeepLink}
              className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-extrabold transition-colors"
            >
              <span>العودة إلى تطبيق استوديو شورتس الآن</span>
            </a>
          </div>
        )}

        {errorMsg && (
          <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/35 text-xs text-rose-400">
            {errorMsg}
          </div>
        )}

        <button
          type="button"
          onClick={onStayInWeb}
          className="text-xs font-semibold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
        >
          متابعة العمل على نسخة الموقع بدلاً من ذلك
        </button>
      </div>
    </div>
  );
};

function buildDefaultPublishKit(proj: QuizProject): YoutubePublishKit {
  const isShorts = proj.template.aspectRatio !== '16:9';

  if (proj.studioMode === 'storyStudio') {
    const storyTitle = (proj.storyTitle || proj.storyScenes?.[0]?.title || 'قصة وعبرة').trim();
    const shortTitle = storyTitle.length > 48 ? `${storyTitle.slice(0, 48)}...` : storyTitle;
    const scenesCount = proj.storyScenes?.length ?? 0;
    const hashtags = isShorts
      ? ['#Shorts', '#قصص_إسلامية', '#قصص_مؤثرة', '#عبرة_وحكمة', '#حكايات']
      : ['#قصص_إسلامية', '#قصص_مؤثرة', '#عبرة_وحكمة', '#حكايات'];
    const title = isShorts ? `${shortTitle} #Shorts` : `قصة وحوار: ${shortTitle}`;
    const moral = proj.storySettings?.endMoralTitle?.trim();
    const description = `${storyTitle}${
      scenesCount > 0 ? ` — قصة قصيرة من ${scenesCount} مشاهد متحركة` : ''
    }.${moral ? `\nالعبرة: ${moral}` : ''}\nاشترك في القناة لمزيد من القصص الهادفة والحوارات القيمة!\n\n${hashtags.join(' ')}`;
    const tags = ['قصص إسلامية', 'قصص مؤثرة', 'عبرة وحكمة', 'شورتس', 'حوارات هادفة', 'محتوى هادف'];
    const pinnedComment =
      'ما أكثر مشهد أثّر فيك في هذه القصة وما العبرة التي خرجت بها؟ شاركنا رأيك في التعليقات 👇';
    return { title, description, hashtags, tags, pinnedComment };
  }

  const targetSlides = proj.slides;
  const firstQ = (targetSlides[0]?.question || 'تحدي المعلومات').trim();
  const shortQ = firstQ.length > 48 ? `${firstQ.slice(0, 48)}...` : firstQ;
  const hashtags = isShorts
    ? ['#Shorts', '#أسئلة', '#تحدي_المعلومات', '#اختبر_ذكاءك', '#ثقافة_عامة']
    : ['#أسئلة', '#تحدي_المعلومات', '#اختبر_ذكاءك', '#ثقافة_عامة'];
  const title = isShorts ? `${shortQ} #Shorts` : `تحدي الأسئلة: ${shortQ}`;
  const description = `هل تستطيع الإجابة على ${
    targetSlides.length > 1 ? `جميع الأسئلة (${targetSlides.length} أسئلة)` : 'هذا السؤال'
  } قبل انتهاء الوقت؟ ⏱️🔥\nاكتب نتيجتك في التعليقات ولا تنسَ الاشتراك في القناة!\n\n${hashtags.join(' ')}`;
  const tags = ['أسئلة', 'تحدي المعلومات', 'اختبر ذكاءك', 'شورتس', 'ثقافة عامة', 'مسابقات'];
  const pinnedComment =
    targetSlides.length > 1
      ? `كم إجابة صحيحة جبت من أصل ${targetSlides.length}؟ اكتب نتيجتك في التعليقات 👇🔥`
      : 'هل عرفت الإجابة الصحيحة قبل انتهاء المؤقت؟ اكتب نعم أو لا في التعليقات 👇🔥';

  return { title, description, hashtags, tags, pinnedComment };
}

export default function App() {
  const [project, setProject] = useState<QuizProject>(() =>
    ensureStoryDataOnProject(createDefaultProject())
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>('slides');
  const [storyTab, setStoryTab] = useState<StoryTab>('scenes');
  const [tabHistory, setTabHistory] = useState<StudioTab[]>([]);
  const [mobileStageMode, setMobileStageMode] = useState<MobileStageMode>('compact');
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [activeStorySceneIndex, setActiveStorySceneIndex] = useState(0);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [uiPrefs, setUiPrefs] = useState<StudioUiPreferences>(() => loadStudioUiPreferences());
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(() => isAppLockEnabled());
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [isQuickStartOpen, setIsQuickStartOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [aiInitialContentType, setAiInitialContentType] = useState<
    'general' | 'math' | 'trueFalse' | 'clues' | 'versus' | 'order' | 'fillBlank' | 'story' | undefined
  >(undefined);
  const [vaultRefreshTrigger, setVaultRefreshTrigger] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showApkWebBridge, setShowApkWebBridge] = useState(() => {
    if (typeof window === 'undefined' || isAndroidNativeApp()) return false;
    return new URLSearchParams(window.location.search).get('apk_login') === '1';
  });

  // Shared YouTube Auth + AI Publishing Kit State
  const [publishKit, setPublishKit] = useState<YoutubePublishKit>(() =>
    buildDefaultPublishKit(createDefaultProject())
  );
  const [tagsInput, setTagsInput] = useState(() =>
    buildDefaultPublishKit(createDefaultProject()).tags.join('، ')
  );
  const kitEditedRef = useRef(false);
  const [ytConnected, setYtConnected] = useState(false);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelInfo | null>(null);
  const [ytEmail, setYtEmail] = useState<string | null>(null);
  const [ytPlaylists, setYtPlaylists] = useState<YouTubePlaylistItem[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [ytPrivacy, setYtPrivacy] = useState<YouTubePrivacyStatus>('private');
  const [ytUseSchedule, setYtUseSchedule] = useState(false);
  const [ytScheduleLocal, setYtScheduleLocal] = useState('');
  const [ytAutoPostComment, setYtAutoPostComment] = useState(true);
  const [isConnectingYt, setIsConnectingYt] = useState(false);
  const [ytAuthError, setYtAuthError] = useState('');

  const hasLocalMutationRef = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const pastRef = useRef<QuizProject[]>([]);
  const futureRef = useRef<QuizProject[]>([]);
  const lastHistoryPushTimeRef = useRef(0);

  const studioDark = uiPrefs.skin !== 'light';

  const navigateToTab = useCallback((nextTab: StudioTab) => {
    setActiveTab((prev) => {
      if (prev !== nextTab) {
        setTabHistory((hist) => [...hist.slice(-10), prev]);
      }
      return nextTab;
    });
  }, []);

  useEffect(() => {
    return setRootBackHandler(() => {
      if (isExportOpen) {
        setIsExportOpen(false);
        return true;
      }
      if (isVaultOpen) {
        setIsVaultOpen(false);
        setVaultRefreshTrigger((n) => n + 1);
        return true;
      }
      if (isQuickStartOpen) {
        setIsQuickStartOpen(false);
        return true;
      }
      if (isAppearanceOpen) {
        setIsAppearanceOpen(false);
        return true;
      }
      if (isMobileDrawerOpen) {
        setIsMobileDrawerOpen(false);
        return true;
      }
      if (isProjectsOpen) {
        setIsProjectsOpen(false);
        return true;
      }
      if (isLockModalOpen) {
        setIsLockModalOpen(false);
        return true;
      }
      if (mobileStageMode !== 'compact') {
        setMobileStageMode('compact');
        return true;
      }
      if (tabHistory.length > 0) {
        const prevTab = tabHistory[tabHistory.length - 1];
        setTabHistory((hist) => hist.slice(0, -1));
        setActiveTab(prevTab);
        return true;
      }
      if (activeTab !== 'slides') {
        setActiveTab('slides');
        return true;
      }
      return false;
    });
  }, [
    isExportOpen,
    isVaultOpen,
    isQuickStartOpen,
    isAppearanceOpen,
    isMobileDrawerOpen,
    isProjectsOpen,
    isLockModalOpen,
    mobileStageMode,
    tabHistory,
    activeTab,
  ]);

  useEffect(() => {
    applyStudioUiSkinToDom(uiPrefs.skin);
    saveStudioUiPreferences(uiPrefs);
  }, [uiPrefs]);

  const updateProject = useCallback(
    (updater: (prev: QuizProject) => QuizProject, immediateHistory = false) => {
      hasLocalMutationRef.current = true;
      setProject((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        const now = Date.now();
        if (immediateHistory || now - lastHistoryPushTimeRef.current > 450 || pastRef.current.length === 0) {
          pastRef.current = [...pastRef.current.slice(-39), prev];
          lastHistoryPushTimeRef.current = now;
        }
        futureRef.current = [];
        setCanUndo(pastRef.current.length > 0);
        setCanRedo(false);
        return next;
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prevSnapshot = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [projectRef.current, ...futureRef.current].slice(0, 40);
    setProject(prevSnapshot);
    setActiveSlideIndex((idx) => Math.min(idx, Math.max(0, prevSnapshot.slides.length - 1)));
    setActiveStorySceneIndex((idx) =>
      Math.min(idx, Math.max(0, (prevSnapshot.storyScenes?.length ?? 1) - 1))
    );
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const nextSnapshot = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-39), projectRef.current];
    setProject(nextSnapshot);
    setActiveSlideIndex((idx) => Math.min(idx, Math.max(0, nextSnapshot.slides.length - 1)));
    setActiveStorySceneIndex((idx) =>
      Math.min(idx, Math.max(0, (nextSnapshot.storyScenes?.length ?? 1) - 1))
    );
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) &&
        (target as HTMLInputElement).type !== 'range' &&
        (target as HTMLInputElement).type !== 'checkbox' &&
        (target as HTMLInputElement).type !== 'color';
      if (isTextInput) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    void loadProjectFromStore().then((loaded) => {
      if (!hasLocalMutationRef.current) {
        setProject(loaded);
      }
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      void saveProjectToStore(project);
    }, 380);
    return () => clearTimeout(timer);
  }, [project, isLoaded]);

  useEffect(() => {
    const flushSave = () => {
      if (isLoaded) {
        void saveProjectToStore(projectRef.current);
      }
    };
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('beforeunload', flushSave);
    return () => {
      window.removeEventListener('pagehide', flushSave);
      window.removeEventListener('beforeunload', flushSave);
    };
  }, [isLoaded]);

  useEffect(() => {
    return initYouTubeAuthListener((session) => {
      setYtConnected(session.connected);
      setYtChannel(session.channel);
      setYtEmail(session.email);
      if (session.connected && session.token) {
        void fetchMyYouTubePlaylists(session.token).then(setYtPlaylists);
      } else {
        setYtPlaylists([]);
        setSelectedPlaylistId('');
      }
    });
  }, []);

  useEffect(() => {
    if (kitEditedRef.current) return;
    const fallback = buildDefaultPublishKit(project);
    setPublishKit(fallback);
    setTagsInput(fallback.tags.join('، '));
  }, [
    project.studioMode,
    project.slides,
    project.storyTitle,
    project.storyScenes,
    project.storySettings?.endMoralTitle,
    project.template.aspectRatio,
  ]);

  const handleUpdatePublishKit = useCallback(
    (updater: (prev: YoutubePublishKit) => YoutubePublishKit) => {
      kitEditedRef.current = true;
      setPublishKit(updater);
    },
    []
  );

  const handleUpdateTagsInput = useCallback((val: string) => {
    kitEditedRef.current = true;
    setTagsInput(val);
  }, []);

  const handleResetDefaultKit = useCallback(() => {
    kitEditedRef.current = false;
    const fallback = buildDefaultPublishKit(projectRef.current);
    setPublishKit(fallback);
    setTagsInput(fallback.tags.join('، '));
  }, []);

  const handleConnectYouTube = useCallback(async () => {
    if (isConnectingYt) return;
    setIsConnectingYt(true);
    setYtAuthError('');
    try {
      const res = await connectYouTubeWithPopup();
      setYtConnected(true);
      setYtChannel(res.channel);
      setYtEmail(res.email);
      const pls = await fetchMyYouTubePlaylists(res.accessToken);
      setYtPlaylists(pls);
    } catch (err) {
      setYtAuthError(err instanceof Error ? err.message : 'تعذر ربط حساب Google / YouTube.');
    } finally {
      setIsConnectingYt(false);
    }
  }, [isConnectingYt]);

  const handleDisconnectYouTube = useCallback(async () => {
    setYtAuthError('');
    await disconnectYouTubeSession();
    setYtConnected(false);
    setYtChannel(null);
    setYtEmail(null);
    setYtPlaylists([]);
    setSelectedPlaylistId('');
  }, []);

  const audioSyncSigRef = useRef('');
  useEffect(() => {
    if (!isLoaded) return;
    const urls: string[] = [];
    if (project.template.introHookAudio?.dataUrl) {
      urls.push(
        `h:${project.template.introHookAudio.dataUrl.slice(0, 32)}:${project.template.introHookAudio.dataUrl.length}`
      );
    }
    (['questionEnter', 'optionEnter', 'countdownTick', 'suspense', 'correctReveal', 'bgMusic'] as const).forEach(
      (slot) => {
        const cfg = project.audio[slot];
        if (cfg?.sourceType === 'custom' && cfg.customDataUrl) {
          urls.push(`a:${slot}:${cfg.customDataUrl.slice(0, 32)}:${cfg.customDataUrl.length}`);
        }
      }
    );
    project.slides.forEach((s, si) => {
      if (s.voiceover?.question?.dataUrl) {
        urls.push(`q${si}:${s.voiceover.question.dataUrl.slice(0, 32)}:${s.voiceover.question.dataUrl.length}`);
      }
      if (s.voiceover?.answer?.dataUrl) {
        urls.push(`an${si}:${s.voiceover.answer.dataUrl.slice(0, 32)}:${s.voiceover.answer.dataUrl.length}`);
      }
      s.voiceover?.options?.forEach((o, oi) => {
        if (o?.dataUrl) {
          urls.push(`o${si}_${oi}:${o.dataUrl.slice(0, 32)}:${o.dataUrl.length}`);
        }
      });
    });

    if (urls.length === 0) {
      audioSyncSigRef.current = '';
      return;
    }

    const sig = urls.join('|');
    if (audioSyncSigRef.current === sig) return;
    audioSyncSigRef.current = sig;

    let cancelled = false;
    const decodeCtx =
      typeof OfflineAudioContext !== 'undefined'
        ? new OfflineAudioContext(1, 1, 48000)
        : undefined;

    void soundEngine
      .syncProjectAudioDurations(project.slides, project.audio, project.template, decodeCtx)
      .then((synced) => {
        if (cancelled) return;
        setProject((prev) => {
          let changed = false;
          const nextSlides = prev.slides.map((s, idx) => {
            const ss = synced.slides[idx];
            if (!s.voiceover || !ss?.voiceover) return s;
            const qChanged =
              s.voiceover.question?.dataUrl &&
              ss.voiceover.question &&
              Math.abs((s.voiceover.question.duration || 0) - ss.voiceover.question.duration) > 0.02;
            const ansChanged =
              s.voiceover.answer?.dataUrl &&
              ss.voiceover.answer &&
              Math.abs((s.voiceover.answer.duration || 0) - ss.voiceover.answer.duration) > 0.02;
            const optsChanged = Boolean(
              s.voiceover.options?.some(
                (o, oi) =>
                  o?.dataUrl &&
                  ss.voiceover?.options?.[oi] &&
                  Math.abs((o.duration || 0) - ss.voiceover.options[oi]!.duration) > 0.02
              )
            );
            if (!qChanged && !ansChanged && !optsChanged) return s;
            changed = true;
            return { ...s, voiceover: ss.voiceover };
          });

          const nextAudio = { ...prev.audio };
          (['questionEnter', 'optionEnter', 'countdownTick', 'suspense', 'correctReveal', 'bgMusic'] as const).forEach(
            (slot) => {
              const pCfg = prev.audio[slot];
              const sCfg = synced.audio[slot];
              if (
                pCfg?.sourceType === 'custom' &&
                pCfg.customDataUrl &&
                sCfg?.duration &&
                Math.abs((pCfg.duration ?? 0) - sCfg.duration) > 0.02
              ) {
                changed = true;
                nextAudio[slot] = { ...pCfg, duration: sCfg.duration };
              }
            }
          );

          let nextTemplate = prev.template;
          if (
            prev.template.introHookAudio?.dataUrl &&
            synced.template.introHookAudio &&
            Math.abs((prev.template.introHookAudio.duration || 0) - synced.template.introHookAudio.duration) >
              0.02
          ) {
            changed = true;
            nextTemplate = { ...prev.template, introHookAudio: synced.template.introHookAudio };
          }

          return changed
            ? { ...prev, slides: nextSlides, audio: nextAudio, template: nextTemplate }
            : prev;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, project.slides, project.audio, project.template]);

  const storyAudioSyncSigRef = useRef('');
  useEffect(() => {
    if (!isLoaded || project.studioMode !== 'storyStudio') return;
    const scenes = project.storyScenes ?? [];
    const urls: string[] = [];
    scenes.forEach((sc, si) => {
      sc.lines.forEach((line, li) => {
        if (line.voiceClip?.dataUrl) {
          urls.push(`st${si}_${li}:${line.voiceClip.dataUrl.slice(0, 32)}:${line.voiceClip.dataUrl.length}`);
        }
      });
    });
    if (project.template.introHookAudio?.dataUrl) {
      urls.push(
        `sh:${project.template.introHookAudio.dataUrl.slice(0, 32)}:${project.template.introHookAudio.dataUrl.length}`
      );
    }
    if (project.audio.bgMusic?.sourceType === 'custom' && project.audio.bgMusic.customDataUrl) {
      urls.push(
        `sm:${project.audio.bgMusic.customDataUrl.slice(0, 32)}:${project.audio.bgMusic.customDataUrl.length}`
      );
    }
    if (urls.length === 0) {
      storyAudioSyncSigRef.current = '';
      return;
    }
    const sig = urls.join('|');
    if (storyAudioSyncSigRef.current === sig) return;
    storyAudioSyncSigRef.current = sig;

    let cancelled = false;
    const decodeCtx =
      typeof OfflineAudioContext !== 'undefined'
        ? new OfflineAudioContext(1, 1, 48000)
        : undefined;

    void soundEngine
      .syncStoryAudioDurations(projectRef.current, decodeCtx)
      .then((synced) => {
        if (cancelled) return;
        const syncedScenes = synced.storyScenes ?? [];
        setProject((prev) => {
          let changed = false;
          const nextScenes = (prev.storyScenes ?? []).map((sc, si) => {
            const syncedSc = syncedScenes[si];
            if (!syncedSc) return sc;
            let scChanged = false;
            const nextLines = sc.lines.map((l, li) => {
              const sl = syncedSc.lines[li];
              if (!l.voiceClip?.dataUrl || !sl?.voiceClip) return l;
              if (Math.abs((l.voiceClip.duration || 0) - sl.voiceClip.duration) > 0.03) {
                scChanged = true;
                changed = true;
                return {
                  ...l,
                  voiceClip: sl.voiceClip,
                  durationSec: Math.max(sl.voiceClip.duration + 0.35, 1.4),
                };
              }
              return l;
            });
            return scChanged ? { ...sc, lines: nextLines } : sc;
          });

          const nextAudio = { ...prev.audio };
          if (
            prev.audio.bgMusic?.sourceType === 'custom' &&
            prev.audio.bgMusic.customDataUrl &&
            synced.audio.bgMusic?.duration &&
            Math.abs((prev.audio.bgMusic.duration ?? 0) - synced.audio.bgMusic.duration) > 0.03
          ) {
            changed = true;
            nextAudio.bgMusic = { ...prev.audio.bgMusic, duration: synced.audio.bgMusic.duration };
          }

          let nextTemplate = prev.template;
          if (
            prev.template.introHookAudio?.dataUrl &&
            synced.template.introHookAudio &&
            Math.abs(
              (prev.template.introHookAudio.duration || 0) - synced.template.introHookAudio.duration
            ) > 0.03
          ) {
            changed = true;
            nextTemplate = { ...prev.template, introHookAudio: synced.template.introHookAudio };
          }

          return changed
            ? { ...prev, storyScenes: nextScenes, audio: nextAudio, template: nextTemplate }
            : prev;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, project.studioMode, project.storyScenes, project.audio, project.template]);

  const isStoryStudio = project.studioMode === 'storyStudio';
  const storyCharacters =
    project.storyCharacters && project.storyCharacters.length > 0
      ? project.storyCharacters
      : BUILTIN_3D_CHARACTERS;
  const storyScenes =
    project.storyScenes && project.storyScenes.length > 0
      ? project.storyScenes
      : createDefaultStoryScenes();
  const storySettings = project.storySettings ?? DEFAULT_STORY_CINEMA_SETTINGS;
  const safeStorySceneIndex = Math.max(0, Math.min(storyScenes.length - 1, activeStorySceneIndex));
  const totalDuration = getProjectTotalDuration(project);
  const canvasDims = getCanvasDimensions(project.template);

  const handleUpdateSlide = useCallback(
    (idx: number, updated: QuestionSlide) => {
      updateProject((prev) => {
        const nextSlides = [...prev.slides];
        nextSlides[idx] = updated;
        return { ...prev, slides: nextSlides };
      });
    },
    [updateProject]
  );

  const createStarterSlide = useCallback((slideType: SlideType, num: number): QuestionSlide => {
    const id = `slide-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (slideType === 'story') {
      return {
        id,
        slideType: 'story',
        badgeText: `مشهد ${num}`,
        question: 'اكتب عنوان المشهد أو الفكرة الرئيسية هنا',
        options: [
          'النقطة الأولى في المشهد',
          'التفصيل أو الحقيقة الثانية',
          'النتيجة أو العبرة الثالثة',
          '',
        ],
        correctIndex: 0,
        explanationText: 'خلاصة المشهد أو الانتقال للمشهد التالي',
      };
    }
    if (slideType === 'trueFalse') {
      return {
        id,
        slideType: 'trueFalse',
        badgeText: `السؤال ${num}`,
        question: 'اكتب عبارة صح أم خطأ هنا',
        options: ['صح', 'خطأ', '', ''],
        correctIndex: 0,
        explanationText: '',
      };
    }
    if (slideType === 'versus') {
      return {
        id,
        slideType: 'versus',
        badgeText: `مواجهة ${num}`,
        question: 'أيهما تفضل أو الأقوى في هذا التحدي؟',
        options: ['الطرف الأول', 'الطرف الثاني', '', ''],
        correctIndex: 0,
        explanationText: 'اكتب اختيارك في التعليقات!',
      };
    }
    if (slideType === 'clues') {
      return {
        id,
        slideType: 'clues',
        badgeText: `تلميحات ${num}`,
        question: 'من أنا أو ما هو الشيء المقصود؟',
        options: ['التلميح الأول', 'التلميح الثاني', 'التلميح الثالث', 'الإجابة الصحيحة'],
        correctIndex: 3,
        explanationText: '',
      };
    }
    if (slideType === 'order') {
      return {
        id,
        slideType: 'order',
        badgeText: `رتّب ${num}`,
        question: 'رتّب العناصر التالية بالترتيب الصحيح',
        options: ['الخطوة 1 (الأولى)', 'الخطوة 2', 'الخطوة 3', 'الخطوة 4 (الأخيرة)'],
        correctIndex: 0,
        explanationText: '',
      };
    }
    if (slideType === 'fillBlank') {
      return {
        id,
        slideType: 'fillBlank',
        badgeText: `أكمل ${num}`,
        question: 'أكمل الجملة التالية بالكلمة ____ المناسبة',
        options: ['الكلمة الصحيحة', 'بديل خاطئ 1', 'بديل خاطئ 2', 'بديل خاطئ 3'],
        correctIndex: 0,
        explanationText: '',
      };
    }
    return {
      id,
      slideType: 'multiple',
      badgeText: `السؤال ${num}`,
      question: 'اكتب نص السؤال الجديد هنا',
      options: ['الجواب الصحيح', 'خيار خاطئ 1', 'خيار خاطئ 2', 'خيار خاطئ 3'],
      correctIndex: 0,
      explanationText: '',
    };
  }, []);

  const handleAddSlide = useCallback(
    (slideType?: SlideType) => {
      updateProject((prev) => {
        const nextNum = prev.slides.length + 1;
        const resolvedType: SlideType =
          slideType || prev.slides[prev.slides.length - 1]?.slideType || 'multiple';
        const newSlide = createStarterSlide(resolvedType, nextNum);
        const nextSlides = [...prev.slides, newSlide];
        setActiveSlideIndex(nextSlides.length - 1);
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [createStarterSlide, updateProject]
  );

  const handleDuplicateSlide = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        const source = prev.slides[idx];
        if (!source) return prev;
        const copy: QuestionSlide = {
          ...source,
          id: `slide-${Date.now()}`,
          options: [...source.options] as [string, string, string, string],
        };
        const nextSlides = [
          ...prev.slides.slice(0, idx + 1),
          copy,
          ...prev.slides.slice(idx + 1),
        ];
        setActiveSlideIndex(idx + 1);
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleDeleteSlide = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        if (prev.slides.length <= 1) return prev;
        const nextSlides = prev.slides.filter((_, i) => i !== idx);
        setActiveSlideIndex((curr) => Math.min(curr, nextSlides.length - 1));
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleReorderSlide = useCallback(
    (fromIdx: number, toIdx: number) => {
      updateProject((prev) => {
        if (
          fromIdx === toIdx ||
          fromIdx < 0 ||
          toIdx < 0 ||
          fromIdx >= prev.slides.length ||
          toIdx >= prev.slides.length
        ) {
          return prev;
        }
        const nextSlides = [...prev.slides];
        const [moved] = nextSlides.splice(fromIdx, 1);
        nextSlides.splice(toIdx, 0, moved);
        setActiveSlideIndex(toIdx);
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleUpdateAllSlides = useCallback(
    (updater: (slides: QuestionSlide[]) => QuestionSlide[]) => {
      updateProject((prev) => ({ ...prev, slides: updater(prev.slides) }), true);
    },
    [updateProject]
  );

  const handleCycleChannelTheme = useCallback(() => {
    updateProject((prev) => {
      const currentIdx = STUDIO_THEME_ORDER.indexOf(prev.template.presetId);
      const nextId =
        STUDIO_THEME_ORDER[(currentIdx + 1) % STUDIO_THEME_ORDER.length];
      const mode = prev.template.themeApplyMode || 'bgOnly';
      return {
        ...prev,
        template:
          mode === 'full'
            ? applyStudioThemePreset(prev.template, nextId)
            : applyThemeBackgroundOnly(prev.template, nextId),
      };
    }, true);
  }, [updateProject]);

  const handleToggleAspectRatio = useCallback(() => {
    updateProject(
      (prev) => ({
        ...prev,
        template: {
          ...prev.template,
          aspectRatio: prev.template.aspectRatio === '16:9' ? '9:16' : '16:9',
        },
      }),
      true
    );
  }, [updateProject]);

  const handleCreateBlankProject = useCallback(
    (customName?: string) => {
      const fresh = ensureStoryDataOnProject(createDefaultProject());
      updateProject(
        () => ({
          ...fresh,
          studioMode: 'quiz',
          id: `proj-${Date.now()}`,
          name: customName || `مشروع جديد ${new Date().toLocaleDateString('ar')}`,
          updatedAt: Date.now(),
        }),
        true
      );
      setActiveSlideIndex(0);
      setAiNotice(null);
      navigateToTab('slides');
    },
    [navigateToTab, updateProject]
  );

  const handleStartFormatProject = useCallback(
    (slideType: SlideType, projectTitle: string) => {
      const fresh = ensureStoryDataOnProject(createDefaultProject());
      const firstSlide = createStarterSlide(slideType, 1);
      updateProject(
        () => ({
          ...fresh,
          studioMode: 'quiz',
          id: `proj-${Date.now()}`,
          name: `${projectTitle} · ${new Date().toLocaleDateString('ar')}`,
          slides: [firstSlide],
          template:
            slideType === 'story'
              ? { ...fresh.template, showBadge: true, showAutoCaptions: true }
              : fresh.template,
          updatedAt: Date.now(),
        }),
        true
      );
      setActiveSlideIndex(0);
      setAiNotice(null);
      navigateToTab('slides');
    },
    [createStarterSlide, navigateToTab, updateProject]
  );

  const switchStudioMode = useCallback(
    (targetMode: StudioMode, targetStoryTab?: StoryTab) => {
      updateProject((prev) => {
        const ensured = targetMode === 'storyStudio' ? ensureStoryDataOnProject(prev) : prev;
        return {
          ...ensured,
          studioMode: targetMode,
        };
      }, true);
      if (targetMode === 'storyStudio') {
        setStoryTab(targetStoryTab ?? 'scenes');
      }
      setAiNotice(null);
    },
    [updateProject]
  );

  const handleAddStoryScene = useCallback(() => {
    updateProject((prev) => {
      const base = ensureStoryDataOnProject(prev);
      const currentScenes = base.storyScenes ?? [];
      const nextNum = currentScenes.length + 1;
      const fallbackCharId = (base.storyCharacters?.[0] || BUILTIN_3D_CHARACTERS[0]).id;
      const prevScene = currentScenes[currentScenes.length - 1];
      const newScene: StoryScene = {
        id: `story-scene-${Date.now()}`,
        title: `المشهد ${nextNum}`,
        locationId: prevScene?.locationId || 'loc_ancient_souq',
        cameraMotion: prevScene?.cameraMotion || 'zoomIn',
        atmosphere: prevScene?.atmosphere || 'goldenDust',
        sceneBannerText: '',
        characterIds:
          prevScene?.characterIds?.length ? [...prevScene.characterIds] : [fallbackCharId],
        lines: [
          {
            id: `line-${Date.now()}`,
            speakerId: fallbackCharId,
            position: 'center',
            expression: 'calm',
            text: 'اكتب حوار المشهد الجديد أو القصة هنا...',
          },
        ],
        transition: 'fade',
      };
      const nextScenes = [...currentScenes, newScene];
      setActiveStorySceneIndex(nextScenes.length - 1);
      return { ...base, storyScenes: nextScenes };
    }, true);
  }, [updateProject]);

  const handleDuplicateStoryScene = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        const base = ensureStoryDataOnProject(prev);
        const currentScenes = base.storyScenes ?? [];
        const src = currentScenes[idx];
        if (!src) return prev;
        const copy: StoryScene = {
          ...src,
          id: `story-scene-${Date.now()}`,
          title: `${src.title} (نسخة)`,
          characterIds: [...src.characterIds],
          lines: src.lines.map((l, li) => ({ ...l, id: `line-${Date.now()}-${li}` })),
        };
        const nextScenes = [
          ...currentScenes.slice(0, idx + 1),
          copy,
          ...currentScenes.slice(idx + 1),
        ];
        setActiveStorySceneIndex(idx + 1);
        return { ...base, storyScenes: nextScenes };
      }, true);
    },
    [updateProject]
  );

  const handleDeleteStoryScene = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        const base = ensureStoryDataOnProject(prev);
        const currentScenes = base.storyScenes ?? [];
        if (currentScenes.length <= 1) return prev;
        const nextScenes = currentScenes.filter((_, i) => i !== idx);
        setActiveStorySceneIndex((curr) => Math.min(curr, nextScenes.length - 1));
        return { ...base, storyScenes: nextScenes };
      }, true);
    },
    [updateProject]
  );

  const navTabs: { id: StudioTab; label: string; shortLabel: string; icon: typeof Layers }[] = [
    { id: 'slides', label: 'الأسئلة والشرائح', shortLabel: 'الأسئلة', icon: Layers },
    { id: 'ai', label: 'الذكاء والأفكار', shortLabel: 'ذكاء', icon: Sparkles },
    { id: 'template', label: 'القالب والتصميم', shortLabel: 'القالب', icon: Palette },
    { id: 'audio', label: 'الأصوات والتوقيت', shortLabel: 'الأصوات', icon: Music },
    { id: 'import', label: 'استيراد سريع', shortLabel: 'استيراد', icon: FileText },
    { id: 'youtube', label: 'نشر يوتيوب', shortLabel: 'يوتيوب', icon: Youtube },
  ];

  const storyNavTabs: { id: StoryTab; label: string; shortLabel: string; icon: typeof Clapperboard }[] = [
    { id: 'scenes', label: 'المشاهد والحوارات', shortLabel: 'المشاهد', icon: Clapperboard },
    { id: 'storyCast', label: 'الشخصيات 3D', shortLabel: 'الشخصيات', icon: Users },
    { id: 'storyLocations', label: 'الأماكن والخلفيات', shortLabel: 'الأماكن', icon: MapPin },
    { id: 'storyAi', label: 'مؤلف القصص بالذكاء', shortLabel: 'مؤلف AI', icon: Sparkles },
    { id: 'storyLook', label: 'الإخراج والموسيقى', shortLabel: 'الإخراج', icon: Palette },
    { id: 'youtube', label: 'حزمة يوتيوب', shortLabel: 'يوتيوب', icon: Youtube },
  ];

  if (showApkWebBridge) {
    return (
      <ApkWebLoginBridge
        onStayInWeb={() => {
          setShowApkWebBridge(false);
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            url.searchParams.delete('apk_login');
            window.history.replaceState({}, '', url.toString());
          }
        }}
      />
    );
  }

  if (isLocked) {
    return <AppLockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className="h-[100dvh] lg:h-screen flex flex-col bg-[var(--page)] text-[var(--ptxt)] overflow-hidden">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-3 lg:gap-8 px-3.5 lg:px-6 h-13 lg:h-15 border-b border-[var(--pline)] bg-[var(--panel)] shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="font-display text-sm sm:text-base lg:text-lg font-extrabold tracking-tight text-[var(--ptxt)] whitespace-nowrap shrink-0"
        >
          استوديو شورتس برو
        </a>

        {/* Zone 2: Clean single-line quick studio links (Tablet/Desktop) */}
        <nav className="hidden md:flex items-center gap-6 text-xs lg:text-sm font-semibold text-[var(--pmuted)]">
          <button
            type="button"
            onClick={() => setIsQuickStartOpen(true)}
            className="hover:text-[var(--ptxt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            البدء السريع
          </button>
          {isStoryStudio ? (
            <>
              <button
                type="button"
                onClick={() => setStoryTab('storyCast')}
                className="hover:text-[var(--ptxt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                الشخصيات 3D
              </button>
              <button
                type="button"
                onClick={() => setStoryTab('storyLocations')}
                className="hover:text-[var(--ptxt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                الأماكن 3D
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsVaultOpen(true)}
              className="hover:text-[var(--ptxt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              بنك الذاكرة
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsProjectsOpen(true)}
            className="hover:text-[var(--ptxt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            المشاريع
          </button>
          <button
            type="button"
            onClick={() => setIsAppearanceOpen(true)}
            className="hover:text-[var(--ptxt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            مظهر الواجهة
          </button>
          <button
            type="button"
            onClick={() => {
              if (isStoryStudio) {
                setStoryTab('youtube');
              } else {
                navigateToTab('youtube');
              }
            }}
            className="hover:text-[var(--ptxt)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            نشر يوتيوب
          </button>
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              try {
                soundEngine.getContext();
              } catch {
                // ignore
              }
              setIsExportOpen(true);
            }}
            className="flex items-center gap-1.5 lg:gap-2 px-3 lg:px-4 py-1.5 lg:py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs lg:text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Film className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
            <span>تصدير الفيديو</span>
          </button>
        </div>
      </header>

      {/* Main Studio Shell: Extended Collapsible Right Sidebar (lg+) + Editor Panel + Live Stage */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Desktop Extended Collapsible RTL Sidebar */}
        <aside
          aria-label="القائمة الجانبية للاستوديو"
          className={`hidden lg:flex flex-col justify-between bg-[var(--panel)] border-l border-[var(--pline)] shrink-0 overflow-y-auto overscroll-contain transition-[width] duration-150 ${
            isSidebarCollapsed || uiPrefs.cinemaFocus ? 'w-16' : 'w-64 xl:w-72'
          }`}
        >
          <div className="flex flex-col gap-1.5 p-2.5">
            <button
              type="button"
              onClick={() => {
                if (uiPrefs.cinemaFocus) {
                  setUiPrefs((p) => ({ ...p, cinemaFocus: false }));
                  setIsSidebarCollapsed(false);
                } else {
                  setIsSidebarCollapsed((c) => !c);
                }
              }}
              title={
                isSidebarCollapsed || uiPrefs.cinemaFocus
                  ? 'توسيع القائمة الجانبية'
                  : 'طي القائمة الجانبية'
              }
              aria-label={
                isSidebarCollapsed || uiPrefs.cinemaFocus
                  ? 'توسيع القائمة الجانبية'
                  : 'طي القائمة الجانبية'
              }
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-extrabold text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
            >
              {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && (
                <span className="whitespace-nowrap">أقسام وأدوات الاستوديو</span>
              )}
              {isSidebarCollapsed || uiPrefs.cinemaFocus ? (
                <PanelRightOpen className="w-4 h-4 mx-auto shrink-0" />
              ) : (
                <PanelRightClose className="w-4 h-4 shrink-0 text-[var(--pmuted)]" />
              )}
            </button>

            {/* Studio Mode Switcher: Dedicated 3D Storytelling vs Quiz Studio */}
            {!(isSidebarCollapsed || uiPrefs.cinemaFocus) ? (
              <div className="rounded-xl bg-[var(--surface)] border border-[var(--pline)] p-1.5 flex flex-col gap-1">
                <span className="px-1.5 text-[10px] font-bold text-[var(--pmuted)]">
                  نوع الاستوديو النشط
                </span>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => switchStudioMode('storyStudio')}
                    className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                      isStoryStudio
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--panel)]'
                    }`}
                  >
                    <Clapperboard className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">القصص 3D</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => switchStudioMode('quiz')}
                    className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                      !isStoryStudio
                        ? 'bg-[#00B050] text-white shadow-sm'
                        : 'text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--panel)]'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">المسابقات</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                title={
                  isStoryStudio
                    ? 'التبديل إلى استوديو المسابقات'
                    : 'التبديل إلى استوديو القصص 3D'
                }
                onClick={() => switchStudioMode(isStoryStudio ? 'quiz' : 'storyStudio')}
                className={`flex items-center justify-center p-2.5 rounded-xl border transition-colors cursor-pointer ${
                  isStoryStudio
                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : 'bg-[#00B050]/15 border-[#00B050] text-[#00B050]'
                }`}
              >
                {isStoryStudio ? (
                  <Clapperboard className="w-4 h-4 shrink-0" />
                ) : (
                  <Layers className="w-4 h-4 shrink-0" />
                )}
              </button>
            )}

            {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && (
              <div className="px-2 pt-1.5 text-[10px] font-bold text-[var(--pmuted)]">
                {isStoryStudio ? 'أقسام استوديو القصص والحوارات 3D' : 'أقسام استوديو المسابقات'}
              </div>
            )}

            {isStoryStudio
              ? storyNavTabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = storyTab === tab.id;
                  const compactRail = isSidebarCollapsed || uiPrefs.cinemaFocus;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      title={tab.label}
                      onClick={() => setStoryTab(tab.id)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                        compactRail ? 'justify-center px-0' : ''
                      } ${
                        active
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!compactRail && <span className="truncate">{tab.label}</span>}
                    </button>
                  );
                })
              : navTabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  const compactRail = isSidebarCollapsed || uiPrefs.cinemaFocus;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      title={tab.label}
                      onClick={() => navigateToTab(tab.id)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                        compactRail ? 'justify-center px-0' : ''
                      } ${
                        active
                          ? 'bg-[#00B050] text-white shadow-sm'
                          : 'text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!compactRail && <span className="truncate">{tab.label}</span>}
                    </button>
                  );
                })}

            {/* Extended Project Summary & Quick Studio Actions */}
            {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && (
              <div className="mt-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-[var(--ptxt)] truncate">
                    {isStoryStudio ? project.storyTitle || project.name : project.name}
                  </span>
                  <span className="font-mono-nums text-[10px] px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] shrink-0">
                    {project.template.aspectRatio}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--pmuted)]">
                  <span>
                    {isStoryStudio
                      ? `${storyScenes.length} مشاهد · ${storyCharacters.length} شخصيات`
                      : `${project.slides.length} شرائح`}
                  </span>
                  <span className="font-mono-nums font-bold text-[var(--ptxt)]">
                    {totalDuration.toFixed(1)} ث
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (isStoryStudio) {
                        handleAddStoryScene();
                        setStoryTab('scenes');
                      } else {
                        handleAddSlide();
                        navigateToTab('slides');
                      }
                    }}
                    className="flex items-center justify-center gap-1 py-2 px-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-[11px] font-bold text-[var(--ptxt)] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#00B050]" />
                    <span>{isStoryStudio ? 'مشهد جديد' : 'شريحة جديدة'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExportOpen(true)}
                    className="flex items-center justify-center gap-1 py-2 px-2 rounded-lg bg-[#00B050]/15 border border-[#00B050]/45 hover:border-[#00B050] text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>تصدير سريع</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 p-2.5 border-t border-[var(--pline)]/80">
            {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && (
              <div className="px-2 pb-1 text-[10px] font-bold text-[var(--pmuted)]">
                أدوات وإعدادات عامة
              </div>
            )}

            <button
              type="button"
              title="البدء السريع"
              onClick={() => setIsQuickStartOpen(true)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap cursor-pointer ${
                isSidebarCollapsed || uiPrefs.cinemaFocus ? 'justify-center px-0' : ''
              }`}
            >
              <Wand2 className="w-4 h-4 text-[var(--gold)] shrink-0" />
              {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && <span>البدء السريع</span>}
            </button>

            {!isStoryStudio && (
              <button
                type="button"
                title="بنك الذاكرة للأسئلة"
                onClick={() => setIsVaultOpen(true)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#00B050] dark:text-[#6ee7b7] hover:bg-[#00B050]/12 transition-colors whitespace-nowrap cursor-pointer ${
                  isSidebarCollapsed || uiPrefs.cinemaFocus ? 'justify-center px-0' : ''
                }`}
              >
                <Brain className="w-4 h-4 shrink-0" />
                {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && (
                  <span>بنك الذاكرة (700+ سؤال)</span>
                )}
              </button>
            )}

            <button
              type="button"
              title="المشاريع المحفوظة"
              onClick={() => setIsProjectsOpen(true)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap cursor-pointer ${
                isSidebarCollapsed || uiPrefs.cinemaFocus ? 'justify-center px-0' : ''
              }`}
            >
              <FolderOpen className="w-4 h-4 text-[var(--gold)] shrink-0" />
              {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && <span>مكتبة المشاريع</span>}
            </button>

            <button
              type="button"
              title="مظهر وتخطيط الواجهة"
              onClick={() => setIsAppearanceOpen(true)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap cursor-pointer ${
                isSidebarCollapsed || uiPrefs.cinemaFocus ? 'justify-center px-0' : ''
              }`}
            >
              <SlidersHorizontal className="w-4 h-4 text-[#00B050] shrink-0" />
              {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && <span>تخصيص الواجهة</span>}
            </button>

            {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && (
              <PWAInstallButton variant="menuItem" />
            )}

            <button
              type="button"
              title="قفل الخصوصية"
              onClick={() => setIsLockModalOpen(true)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap cursor-pointer ${
                isSidebarCollapsed || uiPrefs.cinemaFocus ? 'justify-center px-0' : ''
              }`}
            >
              <Lock className="w-4 h-4 text-[#00B050] shrink-0" />
              {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && <span>قفل الخصوصية</span>}
            </button>

            <button
              type="button"
              title={studioDark ? 'المظهر الفاتح' : 'المظهر الداكن'}
              onClick={() =>
                setUiPrefs((p) => ({
                  ...p,
                  skin: p.skin === 'light' ? 'obsidian' : 'light',
                }))
              }
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap cursor-pointer ${
                isSidebarCollapsed || uiPrefs.cinemaFocus ? 'justify-center px-0' : ''
              }`}
            >
              {studioDark ? (
                <Sun className="w-4 h-4 text-[var(--gold)] shrink-0" />
              ) : (
                <Moon className="w-4 h-4 text-[var(--gold)] shrink-0" />
              )}
              {!(isSidebarCollapsed || uiPrefs.cinemaFocus) && (
                <span>{studioDark ? 'المظهر الفاتح' : 'المظهر الداكن'}</span>
              )}
            </button>
          </div>
        </aside>

        {/* Active Editor Panel */}
        <section
          aria-label="محرر المحتوى والتصميم"
          className={`order-2 ${
            uiPrefs.stageSide === 'right' ? 'lg:order-2 lg:border-r' : 'lg:order-1 lg:border-l'
          } ${
            mobileStageMode === 'expanded' ? 'hidden lg:flex' : 'flex flex-1 lg:flex-none min-h-0'
          } ${
            uiPrefs.cinemaFocus ? 'lg:w-[380px]' : 'lg:w-[450px]'
          } flex-col bg-[var(--panel)] border-t lg:border-t-0 border-[var(--pline)] min-h-0 shrink-0`}
        >
          {/* Unboxed workspace metadata strip + Undo/Redo + Quick Tools */}
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 lg:px-5 lg:py-2.5 border-b border-[var(--pline)] text-[11px] lg:text-xs text-[var(--pmuted)] shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <span>
                {isStoryStudio
                  ? `${storyScenes.length} مشاهد 3D`
                  : `${project.slides.length} شرائح`}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-nums hidden sm:inline">
                {canvasDims.width}×{canvasDims.height}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="font-mono-nums">{totalDuration.toFixed(1)} ث</span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center border border-[var(--pline)] rounded-lg bg-[var(--surface)] overflow-hidden">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="تراجع (Ctrl+Z)"
                  aria-label="تراجع"
                  className="h-8 px-2 text-[var(--ptxt)] disabled:opacity-30 hover:text-[#00B050] cursor-pointer disabled:cursor-default"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title="إعادة (Ctrl+Y)"
                  aria-label="إعادة"
                  className="h-8 px-2 text-[var(--ptxt)] disabled:opacity-30 hover:text-[#00B050] border-r border-[var(--pline)] cursor-pointer disabled:cursor-default"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsAppearanceOpen(true)}
                title="مظهر وتخطيط الواجهة"
                aria-label="مظهر وتخطيط الواجهة"
                className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[var(--gold)] text-[var(--ptxt)] cursor-pointer shrink-0"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#00B050]" />
              </button>

              <button
                type="button"
                onClick={() => setIsQuickStartOpen(true)}
                title="فتح معالج البدء السريع"
                className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-bold text-[var(--ptxt)] cursor-pointer whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5 text-[var(--gold)]" />
                <span className="hidden sm:inline">البدء السريع</span>
              </button>

              {!isStoryStudio && (
                <button
                  type="button"
                  onClick={() => setIsVaultOpen(true)}
                  title="مكتبة الذاكرة الكبرى للأسئلة والمجلدات"
                  className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[#00B050]/12 border border-[#00B050]/45 hover:border-[#00B050] text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer whitespace-nowrap"
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span>الذاكرة</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 lg:p-5 overscroll-contain">
            {aiNotice && (
              <div className="mb-4 flex items-start justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                <span>{aiNotice}</span>
                <button
                  type="button"
                  onClick={() => setAiNotice(null)}
                  className="text-amber-700 dark:text-amber-300 hover:opacity-75 font-bold px-1 cursor-pointer shrink-0"
                  aria-label="إغلاق التنبيه"
                >
                  ×
                </button>
              </div>
            )}

            {isStoryStudio ? (
              <>
                {storyTab === 'scenes' && (
                  <StoryScenesPanel
                    storyTitle={project.storyTitle || project.name}
                    scenes={storyScenes}
                    characters={storyCharacters}
                    activeSceneIndex={safeStorySceneIndex}
                    onStoryTitleChange={(storyTitle) =>
                      updateProject((prev) => ({ ...prev, storyTitle }))
                    }
                    onSelectScene={setActiveStorySceneIndex}
                    onScenesChange={(nextScenes) =>
                      updateProject((prev) => ({ ...prev, storyScenes: nextScenes }))
                    }
                    onJumpToLocations={() => setStoryTab('storyLocations')}
                  />
                )}

                {storyTab === 'storyCast' && (
                  <StoryCastLocationsPanel
                    initialFocus="cast"
                    characters={storyCharacters}
                    scenes={storyScenes}
                    activeSceneIndex={safeStorySceneIndex}
                    onCharactersChange={(nextChars) =>
                      updateProject((prev) => ({ ...prev, storyCharacters: nextChars }), true)
                    }
                    onScenesChange={(nextScenes) =>
                      updateProject((prev) => ({ ...prev, storyScenes: nextScenes }), true)
                    }
                  />
                )}

                {storyTab === 'storyLocations' && (
                  <StoryCastLocationsPanel
                    initialFocus="locations"
                    characters={storyCharacters}
                    scenes={storyScenes}
                    activeSceneIndex={safeStorySceneIndex}
                    onCharactersChange={(nextChars) =>
                      updateProject((prev) => ({ ...prev, storyCharacters: nextChars }), true)
                    }
                    onScenesChange={(nextScenes) =>
                      updateProject((prev) => ({ ...prev, storyScenes: nextScenes }), true)
                    }
                  />
                )}

                {storyTab === 'storyAi' && (
                  <StoryAiGeneratorPanel
                    characters={storyCharacters}
                    onApplyGeneratedStory={(payload) => {
                      updateProject((prev) => {
                        const ensured = ensureStoryDataOnProject(prev);
                        return {
                          ...ensured,
                          studioMode: 'storyStudio',
                          storyTitle: payload.storyTitle,
                          storyScenes: payload.scenes,
                          storySettings: {
                            ...(ensured.storySettings ?? DEFAULT_STORY_CINEMA_SETTINGS),
                            endMoralTitle: payload.endMoralTitle,
                            endMoralSubtitle: payload.endMoralSubtitle,
                          },
                        };
                      }, true);
                      setActiveStorySceneIndex(0);
                      setStoryTab('scenes');
                    }}
                  />
                )}

                {storyTab === 'storyLook' && (
                  <StoryTemplateAudioPanel
                    storySettings={storySettings}
                    template={project.template}
                    audio={project.audio}
                    timing={project.timing}
                    onStorySettingsChange={(nextStorySettings) =>
                      updateProject((prev) => ({ ...prev, storySettings: nextStorySettings }))
                    }
                    onTemplateChange={(nextTemplate) =>
                      updateProject((prev) => ({ ...prev, template: nextTemplate }))
                    }
                    onAudioChange={(nextAudio) =>
                      updateProject((prev) => ({ ...prev, audio: nextAudio }), true)
                    }
                    onTimingChange={(nextTiming) =>
                      updateProject((prev) => ({ ...prev, timing: nextTiming }))
                    }
                  />
                )}

                {storyTab === 'youtube' && (
                  <YouTubePublishPanel
                    project={project}
                    publishKit={publishKit}
                    tagsInput={tagsInput}
                    onUpdatePublishKit={handleUpdatePublishKit}
                    onUpdateTagsInput={handleUpdateTagsInput}
                    onResetDefaultKit={handleResetDefaultKit}
                    ytConnected={ytConnected}
                    ytChannel={ytChannel}
                    ytEmail={ytEmail}
                    ytPlaylists={ytPlaylists}
                    selectedPlaylistId={selectedPlaylistId}
                    onSelectPlaylistId={setSelectedPlaylistId}
                    ytPrivacy={ytPrivacy}
                    onChangePrivacy={setYtPrivacy}
                    ytUseSchedule={ytUseSchedule}
                    onChangeUseSchedule={setYtUseSchedule}
                    ytScheduleLocal={ytScheduleLocal}
                    onChangeScheduleLocal={setYtScheduleLocal}
                    ytAutoPostComment={ytAutoPostComment}
                    onChangeAutoPostComment={setYtAutoPostComment}
                    isConnectingYt={isConnectingYt}
                    ytAuthError={ytAuthError}
                    onConnectYouTube={() => void handleConnectYouTube()}
                    onDisconnectYouTube={() => void handleDisconnectYouTube()}
                    onOpenExport={() => {
                      try {
                        soundEngine.getContext();
                      } catch {
                        // ignore
                      }
                      setIsExportOpen(true);
                    }}
                  />
                )}
              </>
            ) : (
              <>
                {activeTab === 'slides' && (
                  <SlidesEditorPanel
                    slides={project.slides}
                    activeIndex={activeSlideIndex}
                    aiVoiceName={project.preferredAiVoice ?? 'Kore'}
                    onAiVoiceChange={(voice) =>
                      updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
                    }
                    onSelectSlide={setActiveSlideIndex}
                    onUpdateSlide={handleUpdateSlide}
                    onAddSlide={handleAddSlide}
                    onDuplicateSlide={handleDuplicateSlide}
                    onDeleteSlide={handleDeleteSlide}
                    onReorderSlide={handleReorderSlide}
                    onUpdateAllSlides={handleUpdateAllSlides}
                  />
                )}

                {activeTab === 'ai' && (
                  <AiGeneratorPanel
                    voiceName={project.preferredAiVoice ?? 'Kore'}
                    existingQuestions={project.slides.map((s) => s.question)}
                    vaultRefreshTrigger={vaultRefreshTrigger}
                    initialContentType={aiInitialContentType}
                    onOpenLargeVault={() => setIsVaultOpen(true)}
                    onVoiceChange={(voice) =>
                      updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
                    }
                    onInsertSlides={(newSlides, mode, enableAutoSync, warningMessage, applyMathTheme) => {
                      const targetIdx = mode === 'replace' ? 0 : project.slides.length;
                      updateProject((prev) => {
                        const updatedSlides =
                          mode === 'replace' ? newSlides : [...prev.slides, ...newSlides];
                        return {
                          ...prev,
                          slides: updatedSlides,
                          template: applyMathTheme
                            ? applyChannelThemePreset(prev.template, 'channelMath')
                            : prev.template,
                          timing: enableAutoSync
                            ? { ...prev.timing, autoSyncWithAudio: true }
                            : prev.timing,
                        };
                      }, true);
                      setAiNotice(warningMessage ?? null);
                      setActiveSlideIndex(targetIdx);
                      setActiveTab('slides');
                    }}
                  />
                )}

                {activeTab === 'template' && (
                  <TemplateDesignPanel
                    template={project.template}
                    timing={project.timing}
                    aiVoiceName={project.preferredAiVoice ?? 'Kore'}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onChange={(nextTemplate, immediate = true) =>
                      updateProject((prev) => ({ ...prev, template: nextTemplate }), immediate)
                    }
                    onTimingChange={(nextTiming) =>
                      updateProject((prev) => ({ ...prev, timing: nextTiming }), true)
                    }
                  />
                )}

                {activeTab === 'audio' && (
                  <AudioTimingPanel
                    audio={project.audio}
                    timing={project.timing}
                    onAudioChange={(nextAudio) =>
                      updateProject((prev) => ({ ...prev, audio: nextAudio }), true)
                    }
                    onTimingChange={(nextTiming) =>
                      updateProject((prev) => ({ ...prev, timing: nextTiming }))
                    }
                  />
                )}

                {activeTab === 'import' && (
                  <BulkImportPanel
                    project={project}
                    onReplaceSlides={(newSlides) => {
                      updateProject((prev) => ({ ...prev, slides: newSlides }), true);
                      setActiveSlideIndex(0);
                    }}
                    onAppendSlides={(moreSlides) => {
                      updateProject(
                        (prev) => ({
                          ...prev,
                          slides: [...prev.slides, ...moreSlides],
                        }),
                        true
                      );
                    }}
                    onImportFullProject={(loaded) => {
                      updateProject(() => normalizeLoadedProject(loaded), true);
                      setActiveSlideIndex(0);
                      setActiveStorySceneIndex(0);
                    }}
                  />
                )}

                {activeTab === 'youtube' && (
                  <YouTubePublishPanel
                    project={project}
                    publishKit={publishKit}
                    tagsInput={tagsInput}
                    onUpdatePublishKit={handleUpdatePublishKit}
                    onUpdateTagsInput={handleUpdateTagsInput}
                    onResetDefaultKit={handleResetDefaultKit}
                    ytConnected={ytConnected}
                    ytChannel={ytChannel}
                    ytEmail={ytEmail}
                    ytPlaylists={ytPlaylists}
                    selectedPlaylistId={selectedPlaylistId}
                    onSelectPlaylistId={setSelectedPlaylistId}
                    ytPrivacy={ytPrivacy}
                    onChangePrivacy={setYtPrivacy}
                    ytUseSchedule={ytUseSchedule}
                    onChangeUseSchedule={setYtUseSchedule}
                    ytScheduleLocal={ytScheduleLocal}
                    onChangeScheduleLocal={setYtScheduleLocal}
                    ytAutoPostComment={ytAutoPostComment}
                    onChangeAutoPostComment={setYtAutoPostComment}
                    isConnectingYt={isConnectingYt}
                    ytAuthError={ytAuthError}
                    onConnectYouTube={() => void handleConnectYouTube()}
                    onDisconnectYouTube={() => void handleDisconnectYouTube()}
                    onOpenExport={() => {
                      try {
                        soundEngine.getContext();
                      } catch {
                        // ignore
                      }
                      setIsExportOpen(true);
                    }}
                  />
                )}
              </>
            )}
          </div>
        </section>

        {/* Live Stage (Docked Top on Mobile, Configurable Side on Desktop + Bottom Storyboard) */}
        <section
          className={`order-1 ${
            uiPrefs.stageSide === 'right' ? 'lg:order-1' : 'lg:order-2'
          } flex flex-col items-center justify-between bg-[var(--page)] overflow-hidden ${
            mobileStageMode === 'expanded'
              ? 'flex-1 min-h-0'
              : mobileStageMode === 'collapsed'
              ? 'shrink-0 lg:flex-1 lg:min-h-0'
              : 'h-[215px] sm:h-[260px] shrink-0 lg:h-auto lg:flex-1 lg:min-h-0'
          }`}
        >
          <div className="flex-1 w-full min-h-0 flex items-center justify-center overflow-hidden">
            <ShortsPreviewStage
              slides={project.slides}
              activeSlideIndex={activeSlideIndex}
              template={project.template}
              timing={project.timing}
              audio={project.audio}
              storyProject={isStoryStudio ? project : undefined}
              activeStorySceneIndex={safeStorySceneIndex}
              onActiveStorySceneChange={setActiveStorySceneIndex}
              isExporting={isExportOpen}
              mobileStageMode={mobileStageMode}
              onChangeMobileStageMode={setMobileStageMode}
              onToggleSafeGuides={() =>
                updateProject(
                  (prev) => ({
                    ...prev,
                    template: {
                      ...prev.template,
                      showSafeGuides: !prev.template.showSafeGuides,
                    },
                  }),
                  true
                )
              }
              onToggleAspectRatio={handleToggleAspectRatio}
              onCycleChannelTheme={handleCycleChannelTheme}
              onActiveSlideChange={setActiveSlideIndex}
              onUpdateTemplate={(nextTemplate) =>
                updateProject((prev) => ({ ...prev, template: nextTemplate }))
              }
            />
          </div>

          {uiPrefs.showStoryboard && (
            <div className="hidden lg:flex w-full justify-center px-3 pb-2.5 shrink-0">
              {isStoryStudio ? (
                <div className="w-full rounded-xl overflow-hidden border border-[var(--pline)]">
                  <StoryStoryboardBar
                    scenes={storyScenes}
                    characters={storyCharacters}
                    activeSceneIndex={safeStorySceneIndex}
                    timing={project.timing}
                    storySettings={storySettings}
                    template={project.template}
                    onSelectScene={setActiveStorySceneIndex}
                    onAddScene={handleAddStoryScene}
                    onDuplicateScene={handleDuplicateStoryScene}
                    onDeleteScene={handleDeleteStoryScene}
                  />
                </div>
              ) : (
                <StudioStoryboardBar
                  slides={project.slides}
                  activeSlideIndex={activeSlideIndex}
                  timing={project.timing}
                  audio={project.audio}
                  template={project.template}
                  onSelectSlide={setActiveSlideIndex}
                  onAddSlide={handleAddSlide}
                  onDuplicateSlide={handleDuplicateSlide}
                  onDeleteSlide={handleDeleteSlide}
                />
              )}
            </div>
          )}
        </section>
      </main>

      {/* Clean 5-Item Mobile Bottom Tab Bar (< lg) */}
      <nav
        aria-label="التنقل الرئيسي"
        className="lg:hidden grid grid-cols-5 border-t border-[var(--pline)] bg-[var(--panel)]/95 backdrop-blur-md shrink-0 pb-[env(safe-area-inset-bottom)]"
      >
        {(isStoryStudio
          ? ([
              { id: 'scenes', label: 'المشاهد', icon: Clapperboard, kind: 'storyTab' as const },
              { id: 'storyCast', label: 'الشخصيات', icon: Users, kind: 'storyTab' as const },
              { id: 'storyAi', label: 'تأليف AI', icon: Sparkles, kind: 'storyTab' as const },
              { id: 'export', label: 'التصدير', icon: Film, kind: 'export' as const },
              { id: 'more', label: 'المزيد', icon: Menu, kind: 'more' as const },
            ] as const)
          : ([
              { id: 'slides', label: 'المحتوى', icon: Layers, kind: 'tab' as const },
              { id: 'ai', label: 'ذكاء', icon: Sparkles, kind: 'tab' as const },
              { id: 'template', label: 'القالب', icon: Palette, kind: 'tab' as const },
              { id: 'export', label: 'التصدير', icon: Film, kind: 'export' as const },
              { id: 'more', label: 'المزيد', icon: Menu, kind: 'more' as const },
            ] as const)
        ).map((item) => {
          const Icon = item.icon;
          const active =
            item.kind === 'storyTab'
              ? storyTab === item.id && mobileStageMode !== 'expanded'
              : item.kind === 'tab'
                ? activeTab === item.id && mobileStageMode !== 'expanded'
                : item.kind === 'more'
                  ? isMobileDrawerOpen ||
                    (isStoryStudio
                      ? storyTab === 'storyLocations' ||
                        storyTab === 'storyLook' ||
                        storyTab === 'youtube'
                      : activeTab === 'audio' ||
                        activeTab === 'import' ||
                        activeTab === 'youtube')
                  : isExportOpen;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.kind === 'storyTab') {
                  setStoryTab(item.id);
                  if (mobileStageMode === 'expanded') {
                    setMobileStageMode('compact');
                  }
                } else if (item.kind === 'tab') {
                  navigateToTab(item.id);
                  if (mobileStageMode === 'expanded') {
                    setMobileStageMode('compact');
                  }
                } else if (item.kind === 'export') {
                  try {
                    soundEngine.getContext();
                  } catch {
                    // ignore
                  }
                  setIsExportOpen(true);
                } else {
                  setIsMobileDrawerOpen(true);
                }
              }}
              className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? isStoryStudio
                    ? 'text-amber-400'
                    : 'text-[#00B050] dark:text-[#6ee7b7]'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              {active && (
                <span
                  className={`absolute top-0 inset-x-3 h-0.5 rounded-b-full ${
                    isStoryStudio ? 'bg-amber-400' : 'bg-[#00B050]'
                  }`}
                />
              )}
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Slide-out Mobile Navigation Drawer ("المزيد") */}
      {isMobileDrawerOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex justify-start bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="قائمة أدوات الاستوديو"
          onClick={() => setIsMobileDrawerOpen(false)}
        >
          <div
            className="w-72 max-w-[82vw] h-full bg-[var(--panel)] border-l border-[var(--pline)] shadow-2xl flex flex-col justify-between overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1 p-3">
              <div className="flex items-center justify-between gap-2 pb-2.5 mb-1 border-b border-[var(--pline)]">
                <span className="font-display text-sm font-extrabold text-[var(--ptxt)]">
                  القائمة والأدوات
                </span>
                <button
                  type="button"
                  onClick={() => setIsMobileDrawerOpen(false)}
                  aria-label="إغلاق القائمة"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-[var(--pmuted)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mobile Studio Mode Switcher */}
              <div className="mb-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] p-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    switchStudioMode('storyStudio');
                    setIsMobileDrawerOpen(false);
                  }}
                  className={`min-h-[40px] flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-extrabold cursor-pointer ${
                    isStoryStudio
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-[var(--pmuted)]'
                  }`}
                >
                  <Clapperboard className="w-3.5 h-3.5" />
                  <span>القصص 3D</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    switchStudioMode('quiz');
                    setIsMobileDrawerOpen(false);
                  }}
                  className={`min-h-[40px] flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-extrabold cursor-pointer ${
                    !isStoryStudio
                      ? 'bg-[#00B050] text-white'
                      : 'text-[var(--pmuted)]'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>المسابقات</span>
                </button>
              </div>

              {isStoryStudio
                ? storyNavTabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = storyTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setStoryTab(tab.id);
                          if (mobileStageMode === 'expanded') {
                            setMobileStageMode('compact');
                          }
                          setIsMobileDrawerOpen(false);
                        }}
                        className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                          active
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-[var(--ptxt)] hover:bg-[var(--surface)]'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })
                : navTabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          navigateToTab(tab.id);
                          if (mobileStageMode === 'expanded') {
                            setMobileStageMode('compact');
                          }
                          setIsMobileDrawerOpen(false);
                        }}
                        className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#00B050] text-white'
                            : 'text-[var(--ptxt)] hover:bg-[var(--surface)]'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}

              <div className="my-2 border-t border-[var(--pline)]" />

              <button
                type="button"
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  setIsQuickStartOpen(true);
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-[var(--ptxt)] hover:bg-[var(--surface)] cursor-pointer"
              >
                <Wand2 className="w-4 h-4 text-[var(--gold)] shrink-0" />
                <span>البدء السريع</span>
              </button>

              {!isStoryStudio && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileDrawerOpen(false);
                    setIsVaultOpen(true);
                  }}
                  className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-[#00B050] dark:text-[#6ee7b7] hover:bg-[#00B050]/12 cursor-pointer"
                >
                  <Brain className="w-4 h-4 shrink-0" />
                  <span>بنك الذاكرة والأسئلة</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  setIsProjectsOpen(true);
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-[var(--ptxt)] hover:bg-[var(--surface)] cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-[var(--gold)] shrink-0" />
                <span>مكتبة المشاريع</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  setIsAppearanceOpen(true);
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-[var(--ptxt)] hover:bg-[var(--surface)] cursor-pointer"
              >
                <SlidersHorizontal className="w-4 h-4 text-[#00B050] shrink-0" />
                <span>مظهر وتخطيط الواجهة</span>
              </button>
            </div>

            <div className="flex flex-col gap-1 p-3 border-t border-[var(--pline)]">
              <PWAInstallButton
                variant="menuItem"
                onAction={() => setIsMobileDrawerOpen(false)}
              />
              <button
                type="button"
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  setIsLockModalOpen(true);
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold text-[var(--ptxt)] hover:bg-[var(--surface)] cursor-pointer"
              >
                <Lock className="w-4 h-4 text-[#00B050] shrink-0" />
                <span>قفل الخصوصية</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUiPrefs((p) => ({
                    ...p,
                    skin: p.skin === 'light' ? 'obsidian' : 'light',
                  }));
                  setIsMobileDrawerOpen(false);
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold text-[var(--ptxt)] hover:bg-[var(--surface)] cursor-pointer"
              >
                {studioDark ? (
                  <Sun className="w-4 h-4 text-[var(--gold)] shrink-0" />
                ) : (
                  <Moon className="w-4 h-4 text-[var(--gold)] shrink-0" />
                )}
                <span>{studioDark ? 'المظهر الفاتح' : 'المظهر الداكن'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Start Hub Modal (User-Triggered Only) */}
      <QuickStartModal
        isOpen={isQuickStartOpen}
        onClose={() => setIsQuickStartOpen(false)}
        currentProjectName={isStoryStudio ? project.storyTitle || project.name : project.name}
        onGoToAiTab={(contentType) => {
          if (isStoryStudio) {
            switchStudioMode('quiz');
          }
          setAiInitialContentType(contentType ?? 'general');
          navigateToTab('ai');
        }}
        onStartFormatProject={handleStartFormatProject}
        onStartStoryMode={(targetTab) => switchStudioMode('storyStudio', targetTab)}
        onOpenVault={() => setIsVaultOpen(true)}
        onOpenProjects={() => setIsProjectsOpen(true)}
        onCreateBlankProject={handleCreateBlankProject}
      />

      {/* Studio UI Appearance & Workspace Layout Modal */}
      <StudioAppearanceModal
        isOpen={isAppearanceOpen}
        onClose={() => setIsAppearanceOpen(false)}
        prefs={uiPrefs}
        onUpdatePrefs={setUiPrefs}
      />

      {/* Video Export Modal */}
      <ExportVideoModal
        isOpen={isExportOpen}
        project={project}
        onClose={() => setIsExportOpen(false)}
        publishKit={publishKit}
        tagsInput={tagsInput}
        onUpdatePublishKit={handleUpdatePublishKit}
        onUpdateTagsInput={handleUpdateTagsInput}
        ytConnected={ytConnected}
        ytChannel={ytChannel}
        ytEmail={ytEmail}
        ytPlaylists={ytPlaylists}
        selectedPlaylistId={selectedPlaylistId}
        onSelectPlaylistId={setSelectedPlaylistId}
        ytPrivacy={ytPrivacy}
        onChangePrivacy={setYtPrivacy}
        ytUseSchedule={ytUseSchedule}
        onChangeUseSchedule={setYtUseSchedule}
        ytScheduleLocal={ytScheduleLocal}
        onChangeScheduleLocal={setYtScheduleLocal}
        ytAutoPostComment={ytAutoPostComment}
        onChangeAutoPostComment={setYtAutoPostComment}
        isConnectingYt={isConnectingYt}
        ytAuthError={ytAuthError}
        onConnectYouTube={handleConnectYouTube}
        onDisconnectYouTube={handleDisconnectYouTube}
      />

      {/* Large Collapsible Question Bank & Nested Folders Vault */}
      <QuestionBankVaultModal
        isOpen={isVaultOpen}
        onClose={() => {
          setIsVaultOpen(false);
          setVaultRefreshTrigger((n) => n + 1);
        }}
        voiceName={project.preferredAiVoice ?? 'Kore'}
        onVoiceChange={(voice) =>
          updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
        }
        onInsertSlides={(newSlides, mode, enableAutoSync, warningMessage, applyMathTheme) => {
          const targetIdx = mode === 'replace' ? 0 : project.slides.length;
          updateProject((prev) => {
            const updatedSlides =
              mode === 'replace' ? newSlides : [...prev.slides, ...newSlides];
            return {
              ...prev,
              slides: updatedSlides,
              template: applyMathTheme
                ? applyChannelThemePreset(prev.template, 'channelMath')
                : prev.template,
              timing: enableAutoSync
                ? { ...prev.timing, autoSyncWithAudio: true }
                : prev.timing,
            };
          }, true);
          setAiNotice(warningMessage ?? null);
          setActiveSlideIndex(targetIdx);
          setActiveTab('slides');
        }}
      />

      {/* Multi-Project Library Modal */}
      <ProjectsModal
        isOpen={isProjectsOpen}
        currentProject={project}
        onClose={() => setIsProjectsOpen(false)}
        onSelectProject={(loaded) => {
          updateProject(() => normalizeLoadedProject(loaded), true);
          setActiveSlideIndex(0);
          setActiveStorySceneIndex(0);
          setAiNotice(null);
        }}
        onRenameCurrent={(name) =>
          updateProject((prev) => ({ ...prev, name }), true)
        }
      />

      {/* Personal Passcode Lock Management Modal */}
      <ManageLockModal
        isOpen={isLockModalOpen}
        onClose={() => setIsLockModalOpen(false)}
        onLockNow={() => setIsLocked(true)}
      />

      <OfflineIndicator />
    </div>
  );
}
