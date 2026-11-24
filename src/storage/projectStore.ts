import {
  DEFAULT_AUDIO,
  DEFAULT_TEMPLATE,
  DEFAULT_TIMING,
  QuestionSlide,
  QuizProject,
  StoryCharacterProfile,
  StoryCinemaSettings,
  StoryDialogueLine,
  StoryScene,
  VideoAspectRatio,
  createDefaultProject,
} from '../types/quiz';
import {
  DEFAULT_STORY_CINEMA_SETTINGS,
  createDefaultStoryCharacters,
  createDefaultStoryScenes,
} from '../data/storyAssets';

const DB_NAME = 'shorts_quiz_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const ACTIVE_PROJECT_KEY = 'active_project_v1';
const LIBRARY_INDEX_KEY = 'projects_library_index_v1';
const ACTIVE_PROJECT_ID_KEY = 'active_project_id_v1';
const PROJECT_ITEM_PREFIX = 'project_item_';
const CURRENT_SCHEMA_VERSION = 9;

export interface ProjectSummary {
  id: string;
  name: string;
  slideCount: number;
  aspectRatio: VideoAspectRatio;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('IndexedDB open timeout'));
      }
    }, 1500);

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(request.error);
        }
      };
      request.onblocked = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('IndexedDB blocked'));
        }
      };
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      db.close();
      resolve(undefined);
    }, 1500);

    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        clearTimeout(timer);
        db.close();
        resolve(req.result as T | undefined);
      };
      req.onerror = () => {
        clearTimeout(timer);
        db.close();
        resolve(undefined);
      };
    } catch {
      clearTimeout(timer);
      db.close();
      resolve(undefined);
    }
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => {
        db.close();
        resolve();
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    } catch (err) {
      db.close();
      reject(err);
    }
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => {
        db.close();
        resolve();
      };
      req.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

function sanitizeSlide(raw: Partial<QuestionSlide> | null | undefined, idx: number): QuestionSlide {
  const slideType =
    raw?.slideType === 'trueFalse' ||
    raw?.slideType === 'clues' ||
    raw?.slideType === 'versus' ||
    raw?.slideType === 'order' ||
    raw?.slideType === 'fillBlank' ||
    raw?.slideType === 'story'
      ? raw.slideType
      : 'multiple';
  const rawOpts = Array.isArray(raw?.options) ? raw.options : [];
  const options: [string, string, string, string] = [
    typeof rawOpts[0] === 'string'
      ? rawOpts[0]
      : slideType === 'trueFalse'
        ? 'صح'
        : slideType === 'clues'
          ? 'التلميح الأول'
          : slideType === 'versus'
            ? 'الطرف الأول'
            : slideType === 'order'
              ? 'الخطوة / العنصر 1'
              : slideType === 'story'
                ? 'النقطة الأولى في القصة'
                : 'الخيار الأول',
    typeof rawOpts[1] === 'string'
      ? rawOpts[1]
      : slideType === 'trueFalse'
        ? 'خطأ'
        : slideType === 'clues'
          ? 'التلميح الثاني'
          : slideType === 'versus'
            ? 'الطرف الثاني'
            : slideType === 'order'
              ? 'الخطوة / العنصر 2'
              : slideType === 'story'
                ? 'النقطة الثانية في القصة'
                : 'الخيار الثاني',
    typeof rawOpts[2] === 'string'
      ? rawOpts[2]
      : slideType === 'trueFalse' || slideType === 'versus'
        ? ''
        : slideType === 'clues'
          ? 'التلميح الثالث'
          : slideType === 'order'
            ? 'الخطوة / العنصر 3'
            : slideType === 'story'
              ? 'النقطة الثالثة في القصة'
              : 'الخيار الثالث',
    typeof rawOpts[3] === 'string'
      ? rawOpts[3]
      : slideType === 'trueFalse' || slideType === 'versus'
        ? ''
        : slideType === 'clues'
          ? 'الإجابة الصحيحة'
          : slideType === 'order'
            ? 'الخطوة / العنصر 4'
            : slideType === 'story'
              ? ''
              : 'الخيار الرابع',
  ];
  const rawIdx = Number(raw?.correctIndex);
  const maxOptIdx = slideType === 'trueFalse' || slideType === 'versus' ? 1 : 3;
  const correctIndex =
    slideType === 'clues'
      ? 3
      : (Math.max(0, Math.min(maxOptIdx, Math.round(Number.isFinite(rawIdx) ? rawIdx : 0))) as
          | 0
          | 1
          | 2
          | 3);

  const imageChallengeMode =
    raw?.imageChallengeMode === 'blurToClear' ||
    raw?.imageChallengeMode === 'gradualClear' ||
    raw?.imageChallengeMode === 'pixelate'
      ? raw.imageChallengeMode
      : 'normal';
  const rawBlur = Number(raw?.imageBlurStrength);
  const imageBlurStrength = Number.isFinite(rawBlur)
    ? Math.max(10, Math.min(50, Math.round(rawBlur)))
    : undefined;

  const difficulty =
    raw?.difficulty === 'easy' || raw?.difficulty === 'medium' || raw?.difficulty === 'hard'
      ? raw.difficulty
      : 'none';

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `slide-${Date.now()}-${idx}`,
    slideType,
    difficulty,
    badgeText: typeof raw?.badgeText === 'string' ? raw.badgeText : `السؤال ${idx + 1}`,
    question: typeof raw?.question === 'string' ? raw.question : 'اكتب نص السؤال هنا',
    imageDataUrl: typeof raw?.imageDataUrl === 'string' ? raw.imageDataUrl : undefined,
    imageName: typeof raw?.imageName === 'string' ? raw.imageName : undefined,
    imageChallengeMode,
    imageBlurStrength,
    options,
    correctIndex,
    explanationText: typeof raw?.explanationText === 'string' ? raw.explanationText : '',
    voiceover: raw?.voiceover,
  };
}

function sanitizeNumber(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeStoryCharacter(
  raw: Partial<StoryCharacterProfile> | null | undefined,
  idx: number
): StoryCharacterProfile {
  const defaults = createDefaultStoryCharacters();
  const fb = defaults[idx % defaults.length];
  const validVoice =
    raw?.voiceName === 'Kore' ||
    raw?.voiceName === 'Puck' ||
    raw?.voiceName === 'Charon' ||
    raw?.voiceName === 'Fenrir' ||
    raw?.voiceName === 'Zephyr'
      ? raw.voiceName
      : fb.voiceName;
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `char-${Date.now()}-${idx}`,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : fb.name,
    roleTitle: typeof raw?.roleTitle === 'string' ? raw.roleTitle : fb.roleTitle,
    avatarUrl: typeof raw?.avatarUrl === 'string' && raw.avatarUrl ? raw.avatarUrl : fb.avatarUrl,
    voiceName: validVoice,
    accentColor: typeof raw?.accentColor === 'string' && raw.accentColor ? raw.accentColor : fb.accentColor,
  };
}

function sanitizeStoryLine(
  raw: Partial<StoryDialogueLine> | null | undefined,
  idx: number
): StoryDialogueLine {
  const pos =
    raw?.position === 'left' || raw?.position === 'center' ? raw.position : 'right';
  const expr =
    raw?.expression === 'happy' ||
    raw?.expression === 'serious' ||
    raw?.expression === 'surprised'
      ? raw.expression
      : 'calm';
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `line-${Date.now()}-${idx}`,
    speakerId: typeof raw?.speakerId === 'string' && raw.speakerId ? raw.speakerId : 'wise_narrator',
    position: pos,
    expression: expr,
    text: typeof raw?.text === 'string' ? raw.text : '',
    durationSec:
      typeof raw?.durationSec === 'number' && Number.isFinite(raw.durationSec)
        ? Math.max(0.8, Math.min(20, raw.durationSec))
        : undefined,
    voiceClip: raw?.voiceClip?.dataUrl ? raw.voiceClip : undefined,
  };
}

function sanitizeStoryScene(
  raw: Partial<StoryScene> | null | undefined,
  idx: number
): StoryScene {
  const cam =
    raw?.cameraMotion === 'zoomOut' ||
    raw?.cameraMotion === 'panLeft' ||
    raw?.cameraMotion === 'panRight' ||
    raw?.cameraMotion === 'breathing'
      ? raw.cameraMotion
      : 'zoomIn';
  const atmo =
    raw?.atmosphere === 'goldenDust' ||
    raw?.atmosphere === 'starlight' ||
    raw?.atmosphere === 'lanternGlow' ||
    raw?.atmosphere === 'rain'
      ? raw.atmosphere
      : 'none';
  const lines =
    Array.isArray(raw?.lines) && raw.lines.length > 0
      ? raw.lines.map((l, li) => sanitizeStoryLine(l, li))
      : [sanitizeStoryLine({ speakerId: 'wise_narrator', text: 'مشهد قصصي جديد...' }, 0)];
  const characterIds = Array.isArray(raw?.characterIds)
    ? raw.characterIds.filter((c): c is string => typeof c === 'string' && Boolean(c)).slice(0, 3)
    : ['honest_merchant', 'elder_scholar'];

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `scene-${Date.now()}-${idx}`,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title : `المشهد ${idx + 1}`,
    locationId:
      typeof raw?.locationId === 'string' && raw.locationId ? raw.locationId : 'loc_ancient_souq',
    customLocationUrl:
      typeof raw?.customLocationUrl === 'string' ? raw.customLocationUrl : undefined,
    customLocationName:
      typeof raw?.customLocationName === 'string' ? raw.customLocationName : undefined,
    cameraMotion: cam,
    atmosphere: atmo,
    sceneBannerText: typeof raw?.sceneBannerText === 'string' ? raw.sceneBannerText : '',
    characterIds,
    lines,
    transition: raw?.transition || 'fade',
  };
}

export function ensureStoryDataOnProject(project: QuizProject): QuizProject {
  if (
    Array.isArray(project.storyCharacters) &&
    project.storyCharacters.length > 0 &&
    Array.isArray(project.storyScenes) &&
    project.storyScenes.length > 0 &&
    project.storySettings
  ) {
    return project;
  }
  return {
    ...project,
    storyTitle: project.storyTitle || 'ميزان الأمانة · قصة التاجر الصادق',
    storyCharacters:
      Array.isArray(project.storyCharacters) && project.storyCharacters.length > 0
        ? project.storyCharacters
        : createDefaultStoryCharacters(),
    storyScenes:
      Array.isArray(project.storyScenes) && project.storyScenes.length > 0
        ? project.storyScenes
        : createDefaultStoryScenes(),
    storySettings: {
      ...DEFAULT_STORY_CINEMA_SETTINGS,
      ...(project.storySettings ?? {}),
    },
  };
}

export function createDefaultStoryProject(customName?: string): QuizProject {
  const base = ensureStoryDataOnProject(createDefaultProject());
  return {
    ...base,
    id: `story-proj-${Date.now()}`,
    name: customName || 'مشروع قصة وحوار 3D',
    studioMode: 'storyStudio',
    storyTitle: customName || 'ميزان الأمانة · قصة التاجر الصادق',
    updatedAt: Date.now(),
  };
}

export function normalizeLoadedProject(
  result: Partial<QuizProject> | null | undefined
): QuizProject {
  const base = ensureStoryDataOnProject(createDefaultProject());
  if (!result || (!Array.isArray(result.slides) && !Array.isArray(result.storyScenes))) {
    return base;
  }
  const safeRawSlides =
    Array.isArray(result.slides) && result.slides.length > 0 ? result.slides : base.slides;

  let mergedTemplate = {
    ...DEFAULT_TEMPLATE,
    ...(result.template && typeof result.template === 'object' ? result.template : {}),
  };

  if (!result.schemaVersion || result.schemaVersion < 4) {
    if (result.template?.backgroundType === 'custom' && result.template?.customBgDataUrl) {
      mergedTemplate = {
        ...DEFAULT_TEMPLATE,
        ...result.template,
        backgroundType: 'custom',
        customBgDataUrl: result.template.customBgDataUrl,
        customBgName: result.template.customBgName,
      };
    } else {
      mergedTemplate = { ...DEFAULT_TEMPLATE };
    }
  } else if (result.schemaVersion < 5) {
    mergedTemplate = {
      ...mergedTemplate,
      timerMatchBackground: result.template?.timerMatchBackground ?? true,
    };
    if (
      (mergedTemplate.presetId === 'channelNavy' ||
        mergedTemplate.presetId === 'channelEmerald') &&
      mergedTemplate.timerColor?.toLowerCase() === '#000000'
    ) {
      mergedTemplate.timerColor = '#FFFFFF';
      mergedTemplate.timerBgColor =
        mergedTemplate.presetId === 'channelNavy' ? '#131d42' : '#0e3b2f';
    }
  }

  if ((result.schemaVersion ?? 0) < 8) {
    const looksLikeLegacyChannelDefaults =
      Math.abs((mergedTemplate.questionY ?? 36) - 36) < 0.5 &&
      Math.abs((mergedTemplate.timerY ?? 61) - 61) < 0.5 &&
      Math.abs((mergedTemplate.optionsStartY ?? 51.7) - 51.7) < 0.6;
    if (looksLikeLegacyChannelDefaults) {
      mergedTemplate.questionY = DEFAULT_TEMPLATE.questionY;
      mergedTemplate.questionWidth = DEFAULT_TEMPLATE.questionWidth;
      mergedTemplate.questionHeightPct = DEFAULT_TEMPLATE.questionHeightPct;
      mergedTemplate.questionFontSize = DEFAULT_TEMPLATE.questionFontSize;
      mergedTemplate.questionBorderRadius = DEFAULT_TEMPLATE.questionBorderRadius;
      mergedTemplate.timerY = DEFAULT_TEMPLATE.timerY;
      mergedTemplate.optionsStartY = DEFAULT_TEMPLATE.optionsStartY;
      mergedTemplate.optionsWidth = DEFAULT_TEMPLATE.optionsWidth;
      mergedTemplate.optionHeight = DEFAULT_TEMPLATE.optionHeight;
      mergedTemplate.optionFontSize = DEFAULT_TEMPLATE.optionFontSize;
    } else if ((mergedTemplate.timerY ?? 43) >= (mergedTemplate.optionsStartY ?? 51)) {
      // Ensure timer stays cleanly above option boxes
      mergedTemplate.timerY = Math.max(
        20,
        Math.min(DEFAULT_TEMPLATE.timerY, (mergedTemplate.optionsStartY ?? 51) - 8)
      );
    }
  }

  mergedTemplate = {
    ...DEFAULT_TEMPLATE,
    ...mergedTemplate,
    aspectRatio: mergedTemplate.aspectRatio === '16:9' ? '16:9' : '9:16',
    timerMatchBackground: mergedTemplate.timerMatchBackground ?? true,
    useTimerVideo: mergedTemplate.useTimerVideo ?? true,
    boxGloss: mergedTemplate.boxGloss ?? true,
    enhanceAppearance: mergedTemplate.enhanceAppearance ?? true,
    wrongColor: mergedTemplate.wrongColor || DEFAULT_TEMPLATE.wrongColor,
    showEndCard: mergedTemplate.showEndCard ?? true,
    endCardText: mergedTemplate.endCardText || DEFAULT_TEMPLATE.endCardText,
    endCtaText: mergedTemplate.endCtaText ?? '',
    autoFitText: Boolean(mergedTemplate.autoFitText),
    timerColor: mergedTemplate.timerColor || DEFAULT_TEMPLATE.timerColor,
    timerBgColor: mergedTemplate.timerBgColor || DEFAULT_TEMPLATE.timerBgColor,
    brandLogoAnim: mergedTemplate.brandLogoAnim || 'pulse',
    brandLogoSize: sanitizeNumber(mergedTemplate.brandLogoSize, DEFAULT_TEMPLATE.brandLogoSize),
    brandLogoPosition: mergedTemplate.brandLogoPosition || 'topRight',
    brandHandleText: mergedTemplate.brandHandleText ?? '',
    brandOpacity: sanitizeNumber(mergedTemplate.brandOpacity, DEFAULT_TEMPLATE.brandOpacity),
    showProgressCounter: mergedTemplate.showProgressCounter ?? false,

    boxStyle: mergedTemplate.boxStyle || 'flat',
    borderStyle: mergedTemplate.borderStyle || 'solid',
    freeLayoutMode: Boolean(mergedTemplate.freeLayoutMode),
    themeApplyMode: mergedTemplate.themeApplyMode === 'full' ? 'full' : 'bgOnly',
    badgeX: sanitizeNumber(mergedTemplate.badgeX, DEFAULT_TEMPLATE.badgeX ?? 50),
    badgeBorderRadius: sanitizeNumber(mergedTemplate.badgeBorderRadius, DEFAULT_TEMPLATE.badgeBorderRadius ?? 33),
    questionX: sanitizeNumber(mergedTemplate.questionX, DEFAULT_TEMPLATE.questionX ?? 50),
    questionTextAlign: mergedTemplate.questionTextAlign || 'center',
    optionsX: sanitizeNumber(mergedTemplate.optionsX, DEFAULT_TEMPLATE.optionsX ?? 50),
    optionsColGap: sanitizeNumber(mergedTemplate.optionsColGap, 0),
    timerPlacement: mergedTemplate.timerPlacement || 'aboveOptions',
    timerX: sanitizeNumber(mergedTemplate.timerX, 50),
    timerVisibilityMode: mergedTemplate.timerVisibilityMode || 'afterOptionsBeforeAnswer',
    timerUrgentPulse: mergedTemplate.timerUrgentPulse ?? true,
    timerUrgentThreshold: sanitizeNumber(mergedTemplate.timerUrgentThreshold, 3),
    timerUrgentColor: mergedTemplate.timerUrgentColor || '#EF4444',
    timerUnitSuffix: mergedTemplate.timerUnitSuffix ?? '',
    timerOpacity: sanitizeNumber(mergedTemplate.timerOpacity, 1),
    timerBorderColor: mergedTemplate.timerBorderColor ?? '',
    timerBorderWidth: sanitizeNumber(mergedTemplate.timerBorderWidth, -1),
    questionToOptionsGap: sanitizeNumber(mergedTemplate.questionToOptionsGap, 0),
    optionsCenterGap: sanitizeNumber(mergedTemplate.optionsCenterGap, 24),
    explanationBgColor: mergedTemplate.explanationBgColor ?? '',
    explanationTextColor: mergedTemplate.explanationTextColor || '#FFFFFF',
    explanationOffsetY: sanitizeNumber(mergedTemplate.explanationOffsetY, 0),
    brandLogoX: sanitizeNumber(mergedTemplate.brandLogoX, 88),
    brandLogoY: sanitizeNumber(mergedTemplate.brandLogoY, 10),
    shadowIntensity: sanitizeNumber(mergedTemplate.shadowIntensity, 1),
    glowIntensity: sanitizeNumber(mergedTemplate.glowIntensity, 0),
    globalScale: sanitizeNumber(mergedTemplate.globalScale, 1),
    timerScale: sanitizeNumber(mergedTemplate.timerScale, 1),
    badgeScale: sanitizeNumber(mergedTemplate.badgeScale, 1),
    bgMotion: mergedTemplate.bgMotion || 'none',
    revealConfetti: mergedTemplate.revealConfetti ?? false,
    highlightSpokenOption: mergedTemplate.highlightSpokenOption ?? false,
    showIntroHook: mergedTemplate.showIntroHook ?? false,
    introHookText: mergedTemplate.introHookText ?? DEFAULT_TEMPLATE.introHookText,
    introHookDuration: sanitizeNumber(mergedTemplate.introHookDuration, 1.2),
    introHookAudio: mergedTemplate.introHookAudio?.dataUrl ? mergedTemplate.introHookAudio : undefined,
    introHookSfx: mergedTemplate.introHookSfx || 'whoosh',
    showEndSubscribeCta: mergedTemplate.showEndSubscribeCta ?? false,
    showPrizeLadder: mergedTemplate.showPrizeLadder ?? false,
    prizeLadderStyle: mergedTemplate.prizeLadderStyle || 'topStrip',
    prizeLadderTitle: mergedTemplate.prizeLadderTitle ?? 'الجائزة',
    prizeLadderAmounts:
      Array.isArray(mergedTemplate.prizeLadderAmounts) && mergedTemplate.prizeLadderAmounts.length > 0
        ? mergedTemplate.prizeLadderAmounts
        : DEFAULT_TEMPLATE.prizeLadderAmounts,
    slideTransition: mergedTemplate.slideTransition || 'fade',
    optionsAppearMode: mergedTemplate.optionsAppearMode || 'stagger',
    optionTextAlign: mergedTemplate.optionTextAlign || 'auto',
    optionsRtlColumns: mergedTemplate.optionsRtlColumns ?? true,
    animatedMotionBg: mergedTemplate.animatedMotionBg || 'none',
    showAutoCaptions: Boolean(mergedTemplate.showAutoCaptions),
    ctaOverlayText: typeof mergedTemplate.ctaOverlayText === 'string' ? mergedTemplate.ctaOverlayText : '',
  };

  const sanitizedSlides = safeRawSlides.map((s, i) => sanitizeSlide(s, i));
  const rawTiming = result.timing && typeof result.timing === 'object' ? result.timing : undefined;

  const mergedTiming = {
    autoSyncWithAudio: rawTiming?.autoSyncWithAudio ?? DEFAULT_TIMING.autoSyncWithAudio,
    audioEndGap: sanitizeNumber(rawTiming?.audioEndGap, DEFAULT_TIMING.audioEndGap),
    autoDuckMusic: rawTiming?.autoDuckMusic ?? DEFAULT_TIMING.autoDuckMusic,
    bgMusicDuckRatio: sanitizeNumber(rawTiming?.bgMusicDuckRatio, DEFAULT_TIMING.bgMusicDuckRatio),
    introHold: sanitizeNumber(rawTiming?.introHold, DEFAULT_TIMING.introHold),
    questionReadDelay: sanitizeNumber(
      rawTiming?.questionReadDelay,
      DEFAULT_TIMING.questionReadDelay
    ),
    optionStaggerDelay: sanitizeNumber(
      rawTiming?.optionStaggerDelay,
      DEFAULT_TIMING.optionStaggerDelay
    ),
    thinkingDuration: sanitizeNumber(
      rawTiming?.thinkingDuration,
      DEFAULT_TIMING.thinkingDuration
    ),
    suspenseDuration: sanitizeNumber(
      rawTiming?.suspenseDuration,
      DEFAULT_TIMING.suspenseDuration
    ),
    revealHoldDuration: sanitizeNumber(
      rawTiming?.revealHoldDuration,
      DEFAULT_TIMING.revealHoldDuration
    ),
    transitionGap: sanitizeNumber(rawTiming?.transitionGap, DEFAULT_TIMING.transitionGap),
  };

  if (!result.schemaVersion || result.schemaVersion < 4) {
    mergedTiming.thinkingDuration = 5;
  }
  if (!result.schemaVersion || result.schemaVersion < 6) {
    if (Math.abs((mergedTiming.introHold ?? 0.25) - 0.25) < 0.01) {
      mergedTiming.introHold = 0;
    }
  }

  const rawAudio = result.audio && typeof result.audio === 'object' ? result.audio : undefined;
  const sanitizedStoryChars =
    Array.isArray(result.storyCharacters) && result.storyCharacters.length > 0
      ? result.storyCharacters.map((c, idx) => sanitizeStoryCharacter(c, idx))
      : createDefaultStoryCharacters();
  const sanitizedStoryScenes =
    Array.isArray(result.storyScenes) && result.storyScenes.length > 0
      ? result.storyScenes.map((sc, idx) => sanitizeStoryScene(sc, idx))
      : createDefaultStoryScenes();
  const mergedStorySettings: StoryCinemaSettings = {
    ...DEFAULT_STORY_CINEMA_SETTINGS,
    ...(result.storySettings && typeof result.storySettings === 'object'
      ? result.storySettings
      : {}),
  };

  return {
    ...base,
    ...result,
    id: typeof result.id === 'string' && result.id ? result.id : base.id,
    name: typeof result.name === 'string' && result.name ? result.name : base.name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    studioMode: result.studioMode === 'storyStudio' ? 'storyStudio' : 'quiz',
    preferredAiVoice: result.preferredAiVoice ?? 'Kore',
    slides: sanitizedSlides,
    storyTitle:
      typeof result.storyTitle === 'string' && result.storyTitle.trim()
        ? result.storyTitle
        : base.storyTitle,
    storyCharacters: sanitizedStoryChars,
    storyScenes: sanitizedStoryScenes,
    storySettings: mergedStorySettings,
    template: mergedTemplate,
    timing: mergedTiming,
    audio: {
      questionEnter: {
        ...DEFAULT_AUDIO.questionEnter,
        ...(rawAudio?.questionEnter ?? {}),
      },
      optionEnter: {
        ...DEFAULT_AUDIO.optionEnter,
        ...(rawAudio?.optionEnter ?? {}),
      },
      countdownTick: {
        ...DEFAULT_AUDIO.countdownTick,
        ...(rawAudio?.countdownTick ?? {}),
      },
      suspense: {
        ...DEFAULT_AUDIO.suspense,
        ...(rawAudio?.suspense ?? {}),
      },
      correctReveal: {
        ...DEFAULT_AUDIO.correctReveal,
        ...(rawAudio?.correctReveal ?? {}),
      },
      bgMusic: {
        ...DEFAULT_AUDIO.bgMusic,
        ...(rawAudio?.bgMusic ?? {}),
      },
    },
  };
}

function toSummary(project: QuizProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name || 'مشروع بدون اسم',
    slideCount:
      project.studioMode === 'storyStudio'
        ? (project.storyScenes?.length ?? 1)
        : project.slides.length,
    aspectRatio: project.template.aspectRatio === '16:9' ? '16:9' : '9:16',
    updatedAt: project.updatedAt || Date.now(),
  };
}

export async function listProjectsFromStore(): Promise<ProjectSummary[]> {
  try {
    const index = await idbGet<ProjectSummary[]>(LIBRARY_INDEX_KEY);
    if (Array.isArray(index) && index.length > 0) {
      return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
    }
  } catch {
    // ignore
  }
  return [];
}

export async function loadProjectById(projectId: string): Promise<QuizProject | null> {
  try {
    const raw = await idbGet<Partial<QuizProject>>(`${PROJECT_ITEM_PREFIX}${projectId}`);
    if (!raw) return null;
    const normalized = normalizeLoadedProject(raw);
    await idbSet(ACTIVE_PROJECT_ID_KEY, normalized.id);
    await idbSet(ACTIVE_PROJECT_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export async function deleteProjectFromStore(projectId: string): Promise<ProjectSummary[]> {
  try {
    await idbDelete(`${PROJECT_ITEM_PREFIX}${projectId}`);
    const existing = await listProjectsFromStore();
    const filtered = existing.filter((p) => p.id !== projectId);
    await idbSet(LIBRARY_INDEX_KEY, filtered);
    return filtered;
  } catch {
    return [];
  }
}

export async function loadProjectFromStore(): Promise<QuizProject> {
  try {
    const activeId = await idbGet<string>(ACTIVE_PROJECT_ID_KEY);
    if (activeId) {
      const byId = await idbGet<Partial<QuizProject>>(`${PROJECT_ITEM_PREFIX}${activeId}`);
      if (byId) {
        return normalizeLoadedProject(byId);
      }
    }

    const legacy = await idbGet<Partial<QuizProject>>(ACTIVE_PROJECT_KEY);
    const normalized = normalizeLoadedProject(legacy);
    await saveProjectToStore(normalized);
    return normalized;
  } catch {
    return createDefaultProject();
  }
}

export async function saveProjectToStore(project: QuizProject): Promise<void> {
  try {
    const stamped: QuizProject = {
      ...project,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: Date.now(),
    };
    await idbSet(`${PROJECT_ITEM_PREFIX}${stamped.id}`, stamped);
    await idbSet(ACTIVE_PROJECT_ID_KEY, stamped.id);
    await idbSet(ACTIVE_PROJECT_KEY, stamped);

    const existing = (await idbGet<ProjectSummary[]>(LIBRARY_INDEX_KEY)) ?? [];
    const summary = toSummary(stamped);
    const nextIndex = [
      summary,
      ...existing.filter((item) => item.id !== stamped.id),
    ].slice(0, 30);
    await idbSet(LIBRARY_INDEX_KEY, nextIndex);
  } catch {
    // Ignore storage quota or private browsing errors gracefully
  }
}

export async function clearProjectStore(): Promise<void> {
  try {
    await idbDelete(ACTIVE_PROJECT_KEY);
    await idbDelete(ACTIVE_PROJECT_ID_KEY);
  } catch {
    // ignore
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
