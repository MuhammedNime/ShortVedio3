export type StudioUiSkin = 'obsidian' | 'midnight' | 'warm' | 'light';
export type StudioStageSide = 'left' | 'right';

export interface StudioUiPreferences {
  skin: StudioUiSkin;
  stageSide: StudioStageSide;
  cinemaFocus: boolean;
  showStoryboard: boolean;
}

export interface StudioSkinMeta {
  id: StudioUiSkin;
  label: string;
  subtitle: string;
  isDark: boolean;
  previewBg: string;
  previewPanel: string;
  previewAccent: string;
}

export const STUDIO_UI_SKINS: StudioSkinMeta[] = [
  {
    id: 'obsidian',
    label: 'أوبسيديان برو',
    subtitle: 'تصميم استوديو عصري داكن عالي التباين',
    isDark: true,
    previewBg: '#090b10',
    previewPanel: '#181c27',
    previewAccent: '#10b981',
  },
  {
    id: 'midnight',
    label: 'منتصف الليل الأزرق',
    subtitle: 'ألوان عميقة هادئة للمونتاج الطويل',
    isDark: true,
    previewBg: '#060a14',
    previewPanel: '#131e36',
    previewAccent: '#38bdf8',
  },
  {
    id: 'light',
    label: 'الوضع النهاري الصافي',
    subtitle: 'واجهة بيضاء مشرقة مريحة للعين نهاراً',
    isDark: false,
    previewBg: '#f1f5f9',
    previewPanel: '#ffffff',
    previewAccent: '#059669',
  },
  {
    id: 'warm',
    label: 'الكلاسيك الرملي',
    subtitle: 'الطابع الدافئ التقليدي لاستوديو القناة',
    isDark: true,
    previewBg: '#0c0c0c',
    previewPanel: '#221c12',
    previewAccent: '#d4a73a',
  },
];

const STORAGE_KEY = 'shorts_studio_ui_prefs_v1';

export const DEFAULT_STUDIO_UI_PREFS: StudioUiPreferences = {
  skin: 'obsidian',
  stageSide: 'left',
  cinemaFocus: false,
  showStoryboard: true,
};

export function loadStudioUiPreferences(): StudioUiPreferences {
  if (typeof window === 'undefined') return DEFAULT_STUDIO_UI_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STUDIO_UI_PREFS;
    const parsed = JSON.parse(raw) as Partial<StudioUiPreferences>;
    const validSkins: StudioUiSkin[] = ['obsidian', 'midnight', 'warm', 'light'];
    return {
      skin: parsed.skin && validSkins.includes(parsed.skin) ? parsed.skin : 'obsidian',
      stageSide: parsed.stageSide === 'right' ? 'right' : 'left',
      cinemaFocus: Boolean(parsed.cinemaFocus),
      showStoryboard: parsed.showStoryboard !== false,
    };
  } catch {
    return DEFAULT_STUDIO_UI_PREFS;
  }
}

export function saveStudioUiPreferences(prefs: StudioUiPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

export function applyStudioUiSkinToDom(skin: StudioUiSkin): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const meta = STUDIO_UI_SKINS.find((s) => s.id === skin) ?? STUDIO_UI_SKINS[0];
  root.setAttribute('data-studio-skin', meta.id);
  if (meta.isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
