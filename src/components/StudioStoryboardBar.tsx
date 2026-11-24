import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Film,
  HelpCircle,
  ListOrdered,
  Plus,
  Sparkles,
  Swords,
  Trash2,
  Volume2,
} from 'lucide-react';
import {
  AudioSettings,
  QuestionSlide,
  SlideType,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
} from '../types/quiz';

interface StudioStoryboardBarProps {
  slides: QuestionSlide[];
  activeSlideIndex: number;
  timing: TimingSettings;
  audio: AudioSettings;
  template: TemplateSettings;
  onSelectSlide: (idx: number) => void;
  onAddSlide: (slideType?: SlideType) => void;
  onDuplicateSlide: (idx: number) => void;
  onDeleteSlide: (idx: number) => void;
}

const SLIDE_FORMAT_OPTIONS: {
  id: SlideType;
  label: string;
  short: string;
  desc: string;
}[] = [
  { id: 'multiple', label: 'اختيار من متعدد', short: '4 خيارات', desc: 'سؤال كلاسيكي بأربعة خيارات' },
  { id: 'story', label: 'مشهد قصصي متحرك', short: 'قصصي', desc: 'مشهد سردي بدون مؤقت أو خيارات خطأ' },
  { id: 'trueFalse', label: 'صح أم خطأ', short: 'صح/خطأ', desc: 'حكم سريع بين خيارين' },
  { id: 'versus', label: 'تحدي مقارنة VS', short: 'مقارنة', desc: 'مواجهة ثنائية وتصويت' },
  { id: 'clues', label: '3 تلميحات متدرجة', short: 'تلميحات', desc: 'كشف الإجابة بعد 3 أدلة' },
  { id: 'order', label: 'تحدي ترتيب تسلسلي', short: 'ترتيب', desc: 'ترتيب 4 عناصر بالتسلسل الصحيح' },
  { id: 'fillBlank', label: 'أكمل الفراغ', short: 'فراغ', desc: 'استنتاج الكلمة المفقودة' },
];

function getSlideShortLabel(type?: SlideType): string {
  return SLIDE_FORMAT_OPTIONS.find((f) => f.id === (type || 'multiple'))?.short || '4 خيارات';
}

function SlideTypeMiniIcon({ type }: { type?: SlideType }) {
  if (type === 'story') return <Film className="w-3.5 h-3.5 text-[var(--gold)] shrink-0" />;
  if (type === 'versus') return <Swords className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
  if (type === 'order') return <ListOrdered className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
  if (type === 'clues' || type === 'fillBlank') {
    return <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  }
  return <HelpCircle className="w-3.5 h-3.5 text-[#00B050] shrink-0" />;
}

export const StudioStoryboardBar: React.FC<StudioStoryboardBarProps> = ({
  slides,
  activeSlideIndex,
  timing,
  audio,
  template,
  onSelectSlide,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
}) => {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const schedules = computeProjectTimeline(slides, timing, audio, template);

  useEffect(() => {
    if (!isAddMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isAddMenuOpen]);

  return (
    <div className="w-full max-w-4xl bg-[var(--panel)] border border-[var(--pline)] rounded-xl px-2.5 py-2 flex items-center gap-2 shrink-0">
      {/* Multi-format Add Scene/Challenge Launcher */}
      <div className="relative shrink-0" ref={menuRef}>
        <div className="flex items-center rounded-lg overflow-hidden border border-[#00B050]/45 bg-[#00B050]/12">
          <button
            type="button"
            onClick={() => {
              const currType = slides[activeSlideIndex]?.slideType || 'multiple';
              onAddSlide(currType);
            }}
            title="إضافة شريحة بنفس النوع الحالي"
            className="h-9 px-2.5 flex items-center gap-1 text-xs font-bold text-[#00B050] dark:text-[#6ee7b7] hover:bg-[#00B050]/20 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAddMenuOpen((v) => !v)}
            title="اختيار نوع المشهد أو التحدي الجديد"
            aria-label="اختيار نوع الشريحة الجديدة"
            className="h-9 px-1.5 border-r border-[#00B050]/35 text-[#00B050] dark:text-[#6ee7b7] hover:bg-[#00B050]/20 transition-colors cursor-pointer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {isAddMenuOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl p-1.5 z-40 flex flex-col gap-0.5">
            <div className="px-2.5 py-1.5 text-[11px] font-bold text-[var(--pmuted)] border-b border-[var(--pline)] mb-1">
              اختر نوع المشهد أو التحدي
            </div>
            {SLIDE_FORMAT_OPTIONS.map((fmt) => (
              <button
                key={fmt.id}
                type="button"
                onClick={() => {
                  onAddSlide(fmt.id);
                  setIsAddMenuOpen(false);
                }}
                className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-right hover:bg-[var(--surface)] transition-colors cursor-pointer"
              >
                <div className="mt-0.5">
                  <SlideTypeMiniIcon type={fmt.id} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[var(--ptxt)]">{fmt.label}</div>
                  <div className="text-[10px] text-[var(--pmuted)] truncate">{fmt.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Horizontal Scene / Slide Strip */}
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
        {slides.map((s, idx) => {
          const isActive = idx === activeSlideIndex;
          const dur = schedules[idx]?.duration ?? 0;
          const hasVoice = Boolean(s.voiceover?.question || s.voiceover?.answer);
          return (
            <div
              key={s.id}
              onClick={() => onSelectSlide(idx)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectSlide(idx);
                }
              }}
              className={`group min-w-[144px] max-w-[180px] px-2.5 py-1.5 rounded-lg border transition-colors shrink-0 cursor-pointer flex flex-col gap-0.5 ${
                isActive
                  ? 'bg-[#00B050]/12 border-[#00B050] text-[var(--ptxt)]'
                  : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 min-w-0 text-[10px] font-bold text-[var(--pmuted)]">
                  <SlideTypeMiniIcon type={s.slideType} />
                  <span className="truncate">
                    {idx + 1} · {getSlideShortLabel(s.slideType)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {hasVoice && (
                    <Volume2 className="w-3 h-3 text-[#00B050]" aria-label="يحتوي تعليق صوتي" />
                  )}
                  <span className="font-mono-nums text-[10px] text-[var(--pmuted)]">
                    {dur.toFixed(1)}ث
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-[var(--ptxt)] truncate">
                  {s.question?.trim() || (s.slideType === 'story' ? 'مشهد جديد' : `سؤال ${idx + 1}`)}
                </span>
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateSlide(idx);
                    }}
                    title="تكرار"
                    aria-label={`تكرار الشريحة ${idx + 1}`}
                    className="p-0.5 rounded hover:bg-[var(--panel)] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {slides.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSlide(idx);
                      }}
                      title="حذف"
                      aria-label={`حذف الشريحة ${idx + 1}`}
                      className="p-0.5 rounded hover:bg-rose-500/15 text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
