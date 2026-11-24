import React, { useRef } from 'react';
import {
  Layout,
  Music,
  Play,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { readFileAsDataUrl } from '../storage/projectStore';
import {
  AudioSettings,
  StoryCinemaSettings,
  StoryDialogueStyle,
  StoryPortraitFrameStyle,
  TemplateSettings,
  TimingSettings,
} from '../types/quiz';

const STORY_FONT_OPTIONS: { id: TemplateSettings['fontFamily']; label: string }[] = [
  { id: 'Cairo', label: 'Cairo (عصري وواضح)' },
  { id: 'Tajawal', label: 'Tajawal (أنيق ومقروء)' },
  { id: 'Amiri', label: 'Amiri (كلاسيكي وتراثي)' },
];

interface StoryTemplateAudioPanelProps {
  storySettings: StoryCinemaSettings;
  template: TemplateSettings;
  audio: AudioSettings;
  timing: TimingSettings;
  onStorySettingsChange: (next: StoryCinemaSettings) => void;
  onTemplateChange: (next: TemplateSettings) => void;
  onAudioChange: (next: AudioSettings) => void;
  onTimingChange: (next: TimingSettings) => void;
}

const DIALOGUE_STYLES: { id: StoryDialogueStyle; label: string }[] = [
  { id: 'cinematicBar', label: 'شريط سينمائي داكن مع اسم المتحدث' },
  { id: 'speechBubble', label: 'فقاعة حوار عائمة فوق المتحدث' },
  { id: 'subtitleMinimal', label: 'ترجمة سفلية صافية للمشاهد' },
];

const FRAME_STYLES: { id: StoryPortraitFrameStyle; label: string }[] = [
  { id: 'arch', label: 'قوس عربي مضيء (3D Arch)' },
  { id: 'portraitCard', label: 'بطاقة بورتريه سينمائية' },
  { id: 'roundedCine', label: 'إطار مستدير حديث' },
  { id: 'circle', label: 'دائرة مركزة' },
];

export const StoryTemplateAudioPanel: React.FC<StoryTemplateAudioPanelProps> = ({
  storySettings,
  template,
  audio,
  timing,
  onStorySettingsChange,
  onTemplateChange,
  onAudioChange,
  onTimingChange,
}) => {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const bgMusicInputRef = useRef<HTMLInputElement | null>(null);

  const patchStory = (partial: Partial<StoryCinemaSettings>) => {
    onStorySettingsChange({ ...storySettings, ...partial });
  };

  const patchTemplate = (partial: Partial<TemplateSettings>) => {
    onTemplateChange({ ...template, ...partial });
  };

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    patchTemplate({ brandLogoDataUrl: dataUrl });
  };

  const handleUploadBgMusic = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const duration = await soundEngine.getAudioDuration(dataUrl);
    onAudioChange({
      ...audio,
      bgMusic: {
        ...audio.bgMusic,
        sourceType: 'custom',
        customFileName: file.name,
        customDataUrl: dataUrl,
        duration,
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleUploadLogo(e)}
      />
      <input
        ref={bgMusicInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleUploadBgMusic(e)}
      />

      {/* Format & Font */}
      <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--ptxt)]">
          <Layout className="w-4 h-4 text-[#00B050]" />
          <span>أبعاد الفيديو والخط العربي</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: '9:16', label: 'طولي شورتس / ريلز (9:16)' },
              { id: '16:9', label: 'أفقي يوتيوب سينما (16:9)' },
            ] as const
          ).map((ratio) => (
            <button
              key={ratio.id}
              type="button"
              onClick={() => patchTemplate({ aspectRatio: ratio.id })}
              className={`py-2 px-2.5 rounded-lg border text-xs font-bold cursor-pointer ${
                template.aspectRatio === ratio.id
                  ? 'bg-[#00B050] border-[#00B050] text-white'
                  : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--ptxt)]'
              }`}
            >
              {ratio.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-[var(--pmuted)] flex items-center gap-1">
            <Type className="w-3.5 h-3.5 text-[var(--gold)]" />
            <span>الخط الرئيسي للقصة</span>
          </span>
          <select
            value={template.fontFamily}
            onChange={(e) => {
              const font = e.target.value as TemplateSettings['fontFamily'];
              patchTemplate({ fontFamily: font });
            }}
            className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)]"
          >
            {STORY_FONT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Character & Dialogue Framing */}
      <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--ptxt)]">
          <Sparkles className="w-4 h-4 text-[var(--gold)]" />
          <span>إطار الشخصيات 3D وصندوق الحوار</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">شكل ظهور الشخصية</span>
            <select
              value={storySettings.portraitFrameStyle}
              onChange={(e) =>
                patchStory({ portraitFrameStyle: e.target.value as StoryPortraitFrameStyle })
              }
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
            >
              {FRAME_STYLES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">نمط صندوق الحوار</span>
            <select
              value={storySettings.dialogueStyle}
              onChange={(e) =>
                patchStory({ dialogueStyle: e.target.value as StoryDialogueStyle })
              }
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
            >
              {DIALOGUE_STYLES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          {[
            { key: 'showSceneHeader' as const, label: 'إظهار شريط عنوان المكان أعلى الشاشة' },
            { key: 'showCastNames' as const, label: 'إظهار أسماء الشخصيات تحت الإطار' },
            { key: 'showWaveform' as const, label: 'تفعيل نبض الصوت التفاعلي للمتحدث' },
            { key: 'dimInactiveSpeakers' as const, label: 'تركيز الإضاءة على المتحدث الحالي' },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2 p-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-semibold cursor-pointer"
            >
              <input
                type="checkbox"
                checked={storySettings[item.key]}
                onChange={(e) => patchStory({ [item.key]: e.target.checked })}
                className="w-4 h-4 accent-[#00B050]"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Intro Hook & End Moral Card */}
      <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-3">
        <span className="text-xs font-extrabold text-[var(--ptxt)]">
          بطاقة البداية والخاتمة (العبرة + الدعوة للاشتراك)
        </span>

        <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(template.showIntroHook)}
            onChange={(e) => patchTemplate({ showIntroHook: e.target.checked })}
            className="w-4 h-4 accent-[#00B050]"
          />
          <span>تفعيل شاشة تشويق افتتاحية قبل المشهد الأول</span>
        </label>

        {template.showIntroHook && (
          <input
            type="text"
            value={template.introHookText ?? ''}
            onChange={(e) => patchTemplate({ introHookText: e.target.value })}
            placeholder="مثال: قصة قصيرة عن الأمانة ستغيّر يومك..."
            className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
          />
        )}

        <div className="grid grid-cols-1 gap-2.5 pt-1">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">عبارة العبرة الختامية</span>
            <input
              type="text"
              value={storySettings.endMoralTitle}
              onChange={(e) => patchStory({ endMoralTitle: e.target.value })}
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">رسالة الدعوة للتفاعل (CTA)</span>
            <input
              type="text"
              value={storySettings.endMoralSubtitle}
              onChange={(e) => patchStory({ endMoralSubtitle: e.target.value })}
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
            />
          </label>
        </div>
      </section>

      {/* Channel Watermark & Background Music */}
      <section className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--ptxt)]">
          <Music className="w-4 h-4 text-[#00B050]" />
          <span>شعار القناة والموسيقى التصويرية</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">اسم / معرّف القناة</span>
            <input
              type="text"
              value={template.brandHandleText ?? ''}
              onChange={(e) => patchTemplate({ brandHandleText: e.target.value })}
              placeholder="@YourChannel"
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">شعار القناة (Watermark)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-xs font-bold cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{template.brandLogoDataUrl ? 'تغيير الشعار' : 'رفع شعار'}</span>
              </button>
              {template.brandLogoDataUrl && (
                <button
                  type="button"
                  onClick={() => patchTemplate({ brandLogoDataUrl: undefined })}
                  className="p-2 rounded-lg bg-[var(--panel)] border border-rose-500/35 text-rose-500 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Background Music */}
        <div className="p-3 rounded-lg bg-[var(--panel)] border border-[var(--pline)] flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[var(--ptxt)]">الموسيقى / الخلفية الصوتية للقصة</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => bgMusicInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050] text-white text-[11px] font-bold cursor-pointer"
              >
                <Upload className="w-3 h-3" />
                <span>رفع موسيقى / نشيد</span>
              </button>
              {audio.bgMusic.customDataUrl && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.getContext();
                      void soundEngine.playSlot(audio.bgMusic);
                    }}
                    className="p-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[#00B050] cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAudioChange({
                        ...audio,
                        bgMusic: {
                          ...audio.bgMusic,
                          sourceType: 'builtin',
                          builtinId: 'none',
                          customDataUrl: undefined,
                          customFileName: undefined,
                        },
                      })
                    }
                    className="p-1.5 rounded-lg bg-[var(--surface)] border border-rose-500/35 text-rose-500 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          </div>

          {audio.bgMusic.customFileName && (
            <span className="text-[11px] text-[#00B050] truncate">
              الملف الحالي: {audio.bgMusic.customFileName}
            </span>
          )}

          <label className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-[var(--pmuted)] font-bold">
              مستوى الخلفية ({Math.round((audio.bgMusic.volume ?? 0.25) * 100)}%)
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={audio.bgMusic.volume}
              onChange={(e) =>
                onAudioChange({
                  ...audio,
                  bgMusic: { ...audio.bgMusic, volume: parseFloat(e.target.value) },
                })
              }
              className="w-36 accent-[#00B050]"
            />
          </label>

          <label className="flex items-center gap-2 text-[11px] font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={timing.autoDuckMusic !== false}
              onChange={(e) => onTimingChange({ ...timing, autoDuckMusic: e.target.checked })}
              className="accent-[#00B050]"
            />
            <span>خفض الموسيقى تلقائياً أثناء حديث الشخصيات (Auto-Ducking)</span>
          </label>
        </div>
      </section>
    </div>
  );
};
