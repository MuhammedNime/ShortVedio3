import type {
  StoryCharacterProfile,
  StoryCinemaSettings,
  StoryScene,
} from '../types/quiz';

function withBasePath(relPath: string): string {
  const base =
    (import.meta as unknown as { env?: { BASE_URL?: string } })?.env?.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relPath.replace(/^\/+/, '')}`;
}

export interface BuiltInStoryLocation {
  id: string;
  label: string;
  subtitle: string;
  category: 'islamic' | 'historical' | 'nature' | 'modern';
  src: string;
  defaultAtmosphere: 'none' | 'goldenDust' | 'starlight' | 'lanternGlow' | 'rain';
  accentColor: string;
}

export const BUILTIN_3D_CHARACTERS: StoryCharacterProfile[] = [
  {
    id: 'wise_narrator',
    name: 'الراوي الحكيم',
    roleTitle: 'راوي القصص والتاريخ',
    avatarUrl: withBasePath('src/assets/images/char_wise_narrator_1795548807641.jpg'),
    voiceName: 'Fenrir',
    accentColor: '#f59e0b',
  },
  {
    id: 'elder_scholar',
    name: 'الشيخ أبو الفضل',
    roleTitle: 'تاجر أمين وعالم',
    avatarUrl: withBasePath('src/assets/images/char_elder_scholar_1795548805147.jpg'),
    voiceName: 'Charon',
    accentColor: '#eab308',
  },
  {
    id: 'honest_merchant',
    name: 'طارق الأمين',
    roleTitle: 'الشاب التاجر الصادق',
    avatarUrl: withBasePath('src/assets/images/char_honest_merchant_1795548805145.jpg'),
    voiceName: 'Kore',
    accentColor: '#10b981',
  },
  {
    id: 'young_seeker',
    name: 'زيد المتعلم',
    roleTitle: 'الفتى الباحث عن الحكمة',
    avatarUrl: withBasePath('src/assets/images/char_young_seeker_1795548824885.jpg'),
    voiceName: 'Puck',
    accentColor: '#38bdf8',
  },
  {
    id: 'modern_mentor',
    name: 'د. سليم',
    roleTitle: 'المحاور التربوي المعاصر',
    avatarUrl: withBasePath('src/assets/images/char_modern_mentor_1795548808153.jpg'),
    voiceName: 'Zephyr',
    accentColor: '#22d3ee',
  },
];

export const BUILTIN_3D_LOCATIONS: BuiltInStoryLocation[] = [
  {
    id: 'loc_ancient_souq',
    label: 'سوق المدينة والميزان',
    subtitle: 'سوق تراثي مضيء بالشمس وميزان الأمانة للتجارة والبيع',
    category: 'islamic',
    src: withBasePath('src/assets/images/loc_ancient_souq_1795548807869.jpg'),
    defaultAtmosphere: 'goldenDust',
    accentColor: '#f59e0b',
  },
  {
    id: 'loc_historic_mosque',
    label: 'رحاب المسجد التراثي',
    subtitle: 'صحن مسجد وأقواس حجرية وفوانيس عند الغروب',
    category: 'islamic',
    src: withBasePath('src/assets/images/loc_historic_mosque_1795548808507.jpg'),
    defaultAtmosphere: 'lanternGlow',
    accentColor: '#eab308',
  },
  {
    id: 'loc_scholar_majlis',
    label: 'مجلس العلم والمخطوطات',
    subtitle: 'غرفة علم دافئة بالشموع والكتب التراثية',
    category: 'historical',
    src: withBasePath('src/assets/images/loc_scholar_majlis_1795548808237.jpg'),
    defaultAtmosphere: 'lanternGlow',
    accentColor: '#fbbf24',
  },
  {
    id: 'loc_desert_caravan',
    label: 'الواحة والقافلة ليلاً',
    subtitle: 'كثبان الصحراء تحت الهلال وضوء المخيم الدافئ',
    category: 'nature',
    src: withBasePath('src/assets/images/loc_desert_caravan_1795548809874.jpg'),
    defaultAtmosphere: 'starlight',
    accentColor: '#38bdf8',
  },
  {
    id: 'loc_modern_studio',
    label: 'استوديو الحوار الحديث',
    subtitle: 'استوديو خشبي دافئ للحوارات التربوية المعاصرة',
    category: 'modern',
    src: withBasePath('src/assets/images/loc_modern_studio_1795548810383.jpg'),
    defaultAtmosphere: 'none',
    accentColor: '#22d3ee',
  },
];

export const DEFAULT_STORY_CINEMA_SETTINGS: StoryCinemaSettings = {
  dialogueStyle: 'cinematicBar',
  showSceneHeader: true,
  showCastNames: true,
  showWaveform: true,
  dimInactiveSpeakers: true,
  portraitFrameStyle: 'arch',
  endMoralTitle: 'الأمانةُ ترفعُ صاحبَها في الدنيا والآخرة',
  endMoralSubtitle: 'شاركنا رأيك في التعليقات واشترك لمزيد من القصص الهادفة',
  endCardDuration: 2.2,
  sceneTitleHold: 0.35,
  lineGap: 0.2,
};

export function createDefaultStoryCharacters(): StoryCharacterProfile[] {
  return BUILTIN_3D_CHARACTERS.map((c) => ({ ...c }));
}

export function createDefaultStoryScenes(): StoryScene[] {
  return [
    {
      id: 'story-scene-1',
      title: 'السوق والميزان',
      locationId: 'loc_ancient_souq',
      cameraMotion: 'zoomIn',
      atmosphere: 'goldenDust',
      sceneBannerText: 'سوق المدينة المنورة · درس في الأمانة',
      characterIds: ['honest_merchant', 'elder_scholar'],
      transition: 'fade',
      lines: [
        {
          id: 'line-1-1',
          speakerId: 'wise_narrator',
          position: 'center',
          expression: 'calm',
          text: 'في سوقٍ يعجّ بالتجار، وقف الشاب طارق أمام شيخه يزن البضاعة بدقةٍ متناهية.',
        },
        {
          id: 'line-1-2',
          speakerId: 'elder_scholar',
          position: 'left',
          expression: 'happy',
          text: 'أراك تزيد في الميزان شيئاً يسيراً يا طارق، فما سرّ حرصك هذا؟',
        },
        {
          id: 'line-1-3',
          speakerId: 'honest_merchant',
          position: 'right',
          expression: 'serious',
          text: 'أخشى أن أبخس الناس حقهم يا شيخي، فالأمانةُ رأس مال المسلم قبل الدرهم والدينار.',
        },
      ],
    },
    {
      id: 'story-scene-2',
      title: 'حوار في رحاب المسجد',
      locationId: 'loc_historic_mosque',
      cameraMotion: 'panRight',
      atmosphere: 'lanternGlow',
      sceneBannerText: 'رحاب المسجد التراثي · عند الغروب',
      characterIds: ['elder_scholar', 'young_seeker'],
      transition: 'zoomFade',
      lines: [
        {
          id: 'line-2-1',
          speakerId: 'young_seeker',
          position: 'right',
          expression: 'surprised',
          text: 'يا شيخنا، كيف يكسب الصادق ثقة الناس في زمنٍ يظن البعض فيه أن التحايل شطارة؟',
        },
        {
          id: 'line-2-2',
          speakerId: 'elder_scholar',
          position: 'left',
          expression: 'calm',
          text: 'اسمع يا بنيّ؛ من اتّقى الله في سرّه وعلانيته، بارك الله له في رزقه ووضع له القبول في الأرض.',
        },
      ],
    },
    {
      id: 'story-scene-3',
      title: 'الوصية الخالدة',
      locationId: 'loc_scholar_majlis',
      cameraMotion: 'breathing',
      atmosphere: 'lanternGlow',
      sceneBannerText: 'مجلس العلم · خلاصة القصة',
      characterIds: ['honest_merchant', 'young_seeker', 'wise_narrator'],
      transition: 'wipeGold',
      lines: [
        {
          id: 'line-3-1',
          speakerId: 'honest_merchant',
          position: 'center',
          expression: 'happy',
          text: 'لقد جربتُ الصدق في كل بيعة، فما عاد إليّ إلا بالبركة وطمأنينة القلب.',
        },
        {
          id: 'line-3-2',
          speakerId: 'wise_narrator',
          position: 'left',
          expression: 'calm',
          text: 'فاجعل الأمانة شعارك في قولك وعملك؛ فالمكسب الحقيقي ما بارك الله فيه.',
        },
      ],
    },
  ];
}

export function resolveStoryLocationInfo(
  locationId: string,
  customLocationUrl?: string
): BuiltInStoryLocation {
  const found = BUILTIN_3D_LOCATIONS.find((l) => l.id === locationId) ?? BUILTIN_3D_LOCATIONS[0];
  if (customLocationUrl) {
    return {
      ...found,
      src: customLocationUrl,
    };
  }
  return found;
}
