import React, { useState } from 'react';
import { Film, Loader2, Sparkles, Volume2, Wand2 } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { BUILTIN_3D_CHARACTERS, BUILTIN_3D_LOCATIONS } from '../data/storyAssets';
import { generateStoryWithAi, generateTtsClip } from '../services/aiClient';
import { StoryCharacterProfile, StoryScene } from '../types/quiz';

interface StoryAiGeneratorPanelProps {
  characters: StoryCharacterProfile[];
  onApplyGeneratedStory: (payload: {
    storyTitle: string;
    endMoralTitle: string;
    endMoralSubtitle: string;
    scenes: StoryScene[];
  }) => void;
}

const STORY_PRESETS = [
  'قصة أمانة التاجر الصادق في السوق وإرجاع الحقوق لأصحابها',
  'قصة مؤثرة عن برّ الوالدين وكيف فتح الله لصاحبها أبواب الرزق',
  'حوار شيق في مجلس العلم عن الصدق وكظم الغيظ عند الشدائد',
  'قصة صحابي جليل في الإيثار والوفاء بالعهد في أصعب الظروف',
  'حوار شبابي معاصر في الاستوديو عن استثمار الوقت والابتعاد عن الإلهاء',
];

const STORY_TONES = [
  'قصة إسلامية هادفة ومؤثرة',
  'حكاية تاريخية وتراثية مشوقة',
  'حوار تربوي واجتماعي معاصر',
  'وثائقي قصصي تعليمي',
];

export const StoryAiGeneratorPanel: React.FC<StoryAiGeneratorPanelProps> = ({
  characters,
  onApplyGeneratedStory,
}) => {
  const roster = characters.length > 0 ? characters : BUILTIN_3D_CHARACTERS;
  const [topic, setTopic] = useState(STORY_PRESETS[0]);
  const [tone, setTone] = useState(STORY_TONES[0]);
  const [sceneCount, setSceneCount] = useState(3);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>(() =>
    roster.slice(0, 4).map((c) => c.id)
  );
  const [autoGenerateVoices, setAutoGenerateVoices] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const toggleCharacter = (id: string) => {
    setSelectedCharIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 2) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const handleGenerate = async () => {
    if (!topic.trim() || isGenerating) return;
    setErrorMsg('');
    setIsGenerating(true);
    setStatusMsg('جارٍ تأليف مشاهد القصة وتوزيع الحوارات على الشخصيات...');

    try {
      const chosenChars = roster.filter((c) => selectedCharIds.includes(c.id));
      const effectiveChars = chosenChars.length > 0 ? chosenChars : roster;

      const generated = await generateStoryWithAi({
        topic: topic.trim(),
        tone,
        sceneCount,
        characters: effectiveChars.map((c) => ({
          id: c.id,
          name: c.name,
          roleTitle: c.roleTitle,
        })),
        locations: BUILTIN_3D_LOCATIONS.map((l) => ({
          id: l.id,
          label: l.label,
          subtitle: l.subtitle,
        })),
      });

      let finalScenes = generated.scenes;

      if (autoGenerateVoices) {
        try {
          soundEngine.getContext();
        } catch {
          // ignore audio ctx init warning
        }
        const totalLines = finalScenes.reduce((sum, sc) => sum + sc.lines.length, 0);
        let doneLines = 0;

        for (let sIdx = 0; sIdx < finalScenes.length; sIdx++) {
          const sc = finalScenes[sIdx];
          for (let lIdx = 0; lIdx < sc.lines.length; lIdx++) {
            const ln = sc.lines[lIdx];
            doneLines += 1;
            const speaker = roster.find((c) => c.id === ln.speakerId) ?? roster[0];
            setStatusMsg(
              `تم تأليف القصة! جارٍ توليد صوت "${speaker.name}" (${doneLines}/${totalLines})...`
            );
            try {
              const clip = await generateTtsClip(
                ln.text,
                speaker.voiceName,
                `ai-story-${sIdx + 1}-${lIdx + 1}.wav`,
                speaker.id === 'wise_narrator'
                  ? 'Warm, cinematic Arabic storyteller voice; read only the exact text'
                  : 'Expressive Arabic dialogue character voice; read only the exact text cleanly'
              );
              sc.lines[lIdx] = { ...ln, voiceClip: clip };
            } catch {
              // Keep scene text intact even if one TTS line quota fails
            }
          }
        }
      }

      onApplyGeneratedStory({
        storyTitle: generated.storyTitle,
        endMoralTitle: generated.endMoralTitle,
        endMoralSubtitle: generated.endMoralSubtitle,
        scenes: finalScenes,
      });
      setStatusMsg('تم إنشاء القصة وتجهيز جميع المشاهد داخل الاستوديو بنجاح!');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر توليد القصة الآن.');
      setStatusMsg('');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="p-3.5 rounded-xl bg-[#00B050]/10 border border-[#00B050]/35 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[#00B050] dark:text-[#6ee7b7]">
          <Wand2 className="w-4 h-4" />
          <span>مؤلف القصص والحوارات السينمائية بالذكاء الاصطناعي</span>
        </div>
        <p className="text-[11px] text-[var(--pmuted)] leading-relaxed">
          اكتب فكرة القصة أو الموقف الأخلاقي ليقوم الذكاء الاصطناعي بكتابة المشاهد، اختيار
          الأماكن 3D، توزيع الحوارات على الشخصيات، وتوليد أصواتهم تلقائياً.
        </p>
      </div>

      {/* Topic Presets */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-[var(--ptxt)]">أفكار قصصية جاهزة</span>
        <div className="flex flex-wrap gap-1.5">
          {STORY_PRESETS.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setTopic(p)}
              className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer text-right ${
                topic === p
                  ? 'bg-[#00B050]/15 border-[#00B050] text-[var(--ptxt)]'
                  : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--pmuted)] hover:border-[var(--gold)]'
              }`}
            >
              {p.slice(0, 44)}...
            </button>
          ))}
        </div>
      </div>

      {/* Topic Input */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-[var(--ptxt)]">موضوع القصة أو الحوار المطلوب</span>
        <textarea
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="مثال: قصة حوارية بين تاجر أمين وشاب يتعلم قيمة الصدق..."
          className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-sm text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none resize-y"
        />
      </label>

      {/* Tone + Scene Count */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-[var(--pmuted)]">الأسلوب الدرامي</span>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)]"
          >
            {STORY_TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-[var(--pmuted)]">عدد المشاهد</span>
          <select
            value={sceneCount}
            onChange={(e) => setSceneCount(parseInt(e.target.value, 10))}
            className="px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)]"
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} مشاهد متسلسلة
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Participating Characters */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold text-[var(--pmuted)]">
          الشخصيات المشاركة في تأليف القصة
        </span>
        <div className="flex flex-wrap gap-2">
          {roster.map((ch) => {
            const active = selectedCharIds.includes(ch.id);
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => toggleCharacter(ch.id)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                  active
                    ? 'bg-[#00B050]/15 border-[#00B050] text-[var(--ptxt)]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--pmuted)]'
                }`}
              >
                <img
                  src={ch.avatarUrl}
                  alt={ch.name}
                  className="w-6 h-6 rounded-full object-cover"
                />
                <span>{ch.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Auto TTS Toggle */}
      <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] cursor-pointer">
        <input
          type="checkbox"
          checked={autoGenerateVoices}
          onChange={(e) => setAutoGenerateVoices(e.target.checked)}
          className="w-4 h-4 accent-[#00B050]"
        />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-[var(--ptxt)] flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-[#00B050]" />
            <span>توليد أصوات الشخصيات تلقائياً بعد كتابة السيناريو</span>
          </span>
          <span className="text-[11px] text-[var(--pmuted)]">
            يتحدث كل ممثل 3D بصوته المخصص فوراً داخل المشهد
          </span>
        </div>
      </label>

      {statusMsg && (
        <div className="px-3 py-2.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40 text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
          {statusMsg}
        </div>
      )}

      {errorMsg && (
        <div className="px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/35 text-xs text-rose-500">
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        disabled={isGenerating || !topic.trim()}
        onClick={() => void handleGenerate()}
        className="w-full py-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-55 text-white text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer min-h-[46px]"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>جارٍ تأليف وإخراج القصة 3D...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            <Film className="w-4 h-4" />
            <span>إنشاء القصة كاملة بالذكاء الاصطناعي</span>
          </>
        )}
      </button>
    </div>
  );
};
