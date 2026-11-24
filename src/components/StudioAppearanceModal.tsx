import React from 'react';
import {
  Check,
  Columns,
  Film,
  LayoutGrid,
  Maximize2,
  Monitor,
  Palette,
  X,
} from 'lucide-react';
import {
  STUDIO_UI_SKINS,
  StudioStageSide,
  StudioUiPreferences,
  StudioUiSkin,
} from '../utils/studioUiTheme';

interface StudioAppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefs: StudioUiPreferences;
  onUpdatePrefs: (next: StudioUiPreferences) => void;
}

export const StudioAppearanceModal: React.FC<StudioAppearanceModalProps> = ({
  isOpen,
  onClose,
  prefs,
  onUpdatePrefs,
}) => {
  if (!isOpen) return null;

  const setSkin = (skin: StudioUiSkin) => onUpdatePrefs({ ...prefs, skin });
  const setStageSide = (stageSide: StudioStageSide) => onUpdatePrefs({ ...prefs, stageSide });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appearance-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-[var(--pline)] bg-[var(--surface)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Palette className="w-5 h-5 text-[#00B050] shrink-0" />
            <div className="min-w-0">
              <h2
                id="appearance-title"
                className="font-display text-base sm:text-lg font-extrabold text-[var(--ptxt)] truncate"
              >
                مظهر وتخطيط الاستوديو
              </h2>
              <p className="text-[11px] text-[var(--pmuted)] truncate">
                اختر لون الواجهة وطريقة عرض مساحة العمل التي تناسبك
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة المظهر"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex flex-col gap-5">
          {/* 1. Studio Skins */}
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-extrabold text-[var(--ptxt)]">
              01. ثيم واجهة التطبيق
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {STUDIO_UI_SKINS.map((skin) => {
                const selected = prefs.skin === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    onClick={() => setSkin(skin.id)}
                    className={`min-h-[56px] flex items-center justify-between gap-3 p-3 rounded-xl border text-right transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#00B050]/12 border-[#00B050]'
                        : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[var(--gold)]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Mini visual UI swatch */}
                      <div
                        className="w-10 h-10 rounded-lg border border-black/20 flex overflow-hidden shrink-0 shadow-sm"
                        style={{ backgroundColor: skin.previewBg }}
                      >
                        <div
                          className="w-1/2 h-full"
                          style={{ backgroundColor: skin.previewPanel }}
                        />
                        <div className="flex-1 flex items-end justify-center p-1">
                          <span
                            className="w-3 h-3 rounded-full block"
                            style={{ backgroundColor: skin.previewAccent }}
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[var(--ptxt)] truncate">
                          {skin.label}
                        </div>
                        <div className="text-[11px] text-[var(--pmuted)] truncate">
                          {skin.subtitle}
                        </div>
                      </div>
                    </div>
                    {selected && (
                      <Check className="w-4 h-4 text-[#00B050] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Desktop Workspace Layout Options */}
          <div className="flex flex-col gap-2.5 pt-3 border-t border-[var(--pline)]">
            <h3 className="text-xs font-extrabold text-[var(--ptxt)]">
              02. تخطيط مساحة العمل (الشاشات الكبيرة)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setStageSide('left')}
                className={`min-h-[48px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                  prefs.stageSide === 'left'
                    ? 'bg-[#00B050]/12 border-[#00B050] text-[var(--ptxt)]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                <Columns className="w-4 h-4 text-[#00B050] shrink-0" />
                <span>المحرر يميناً · المعاينة يساراً</span>
              </button>
              <button
                type="button"
                onClick={() => setStageSide('right')}
                className={`min-h-[48px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                  prefs.stageSide === 'right'
                    ? 'bg-[#00B050]/12 border-[#00B050] text-[var(--ptxt)]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                <Monitor className="w-4 h-4 text-[var(--gold)] shrink-0" />
                <span>المعاينة يميناً · المحرر يساراً</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  onUpdatePrefs({ ...prefs, cinemaFocus: !prefs.cinemaFocus })
                }
                className={`min-h-[48px] flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                  prefs.cinemaFocus
                    ? 'bg-[#00B050]/12 border-[#00B050] text-[var(--ptxt)]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Maximize2 className="w-4 h-4 text-[#00B050] shrink-0" />
                  <span>تركيز شاشة المعاينة</span>
                </span>
                <span className="text-[11px] font-semibold text-[var(--pmuted)]">
                  {prefs.cinemaFocus ? 'مفعّل' : 'إيقاف'}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdatePrefs({ ...prefs, showStoryboard: !prefs.showStoryboard })
                }
                className={`min-h-[48px] flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                  prefs.showStoryboard
                    ? 'bg-[#00B050]/12 border-[#00B050] text-[var(--ptxt)]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-[var(--gold)] shrink-0" />
                  <span>شريط المشاهد السفلي</span>
                </span>
                <span className="text-[11px] font-semibold text-[var(--pmuted)]">
                  {prefs.showStoryboard ? 'ظاهر' : 'مخفي'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 text-[11px] text-[var(--pmuted)]">
            <span className="flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>يتم حفظ اختيارك تلقائياً على هذا الجهاز</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              تم
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
