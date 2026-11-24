import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  Film,
  Loader2,
  MapPin,
  Mic,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Volume2,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { BUILTIN_3D_CHARACTERS, BUILTIN_3D_LOCATIONS } from '../data/storyAssets';
import { generateTtsClip } from '../services/aiClient';
import { readFileAsDataUrl } from '../storage/projectStore';
import {
  StoryAtmosphere,
  StoryCameraMotion,
  StoryCharacterExpression,
  StoryCharacterPosition,
  StoryCharacterProfile,
  StoryDialogueLine,
  StoryScene,
  computeStoryLineDuration,
} from '../types/quiz';

interface StoryScenesPanelProps {
  storyTitle: string;
  scenes: StoryScene[];
  characters: StoryCharacterProfile[];
  activeSceneIndex: number;
  onStoryTitleChange: (title: string) => void;
  onSelectScene: (idx: number) => void;
  onScenesChange: (nextScenes: StoryScene[]) => void;
  onJumpToLocations?: () => void;
}

const CAMERA_MOTION_OPTIONS: { id: StoryCameraMotion; label: string }[] = [
  { id: 'zoomIn', label: 'تقريب سينمائي تدريجي' },
  { id: 'zoomOut', label: 'تبعيد واسع للمشهد' },
  { id: 'panRight', label: 'تحريك الكاميرا يميناً' },
  { id: 'panLeft', label: 'تحريك الكاميرا يساراً' },
  { id: 'breathing', label: 'تنفّس هادئ (حوار)' },
];

const ATMOSPHERE_OPTIONS: { id: StoryAtmosphere; label: string }[] = [
  { id: 'goldenDust', label: 'غبار ذهبي دافئ' },
  { id: 'lanternGlow', label: 'وهج فوانيس تراثي' },
  { id: 'starlight', label: 'نجوم ليل متلألئة' },
  { id: 'rain', label: 'مطر خفيف' },
  { id: 'none', label: 'إضاءة صافية بدون مؤثرات' },
];

const POSITION_OPTIONS: { id: StoryCharacterPosition; label: string }[] = [
  { id: 'right', label: 'يمين' },
  { id: 'center', label: 'وسط' },
  { id: 'left', label: 'يسار' },
];

const EXPRESSION_OPTIONS: { id: StoryCharacterExpression; label: string }[] = [
  { id: 'calm', label: 'هادئ / متزن' },
  { id: 'happy', label: 'مبتسم / متفائل' },
  { id: 'serious', label: 'جاد / حازم' },
  { id: 'surprised', label: 'متعجب / متأثر' },
];

export const StoryScenesPanel: React.FC<StoryScenesPanelProps> = ({
  storyTitle,
  scenes,
  characters,
  activeSceneIndex,
  onStoryTitleChange,
  onSelectScene,
  onScenesChange,
  onJumpToLocations,
}) => {
  const [generatingLineId, setGeneratingLineId] = useState<string | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgressText, setBatchProgressText] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const audioUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetLineId, setUploadTargetLineId] = useState<string | null>(null);

  const roster = characters.length > 0 ? characters : BUILTIN_3D_CHARACTERS;
  const safeIdx = Math.max(0, Math.min(scenes.length - 1, activeSceneIndex));
  const activeScene = scenes[safeIdx];

  const patchActiveScene = (updater: (scene: StoryScene) => StoryScene) => {
    if (!activeScene) return;
    onScenesChange(scenes.map((sc, idx) => (idx === safeIdx ? updater(sc) : sc)));
  };

  const handleAddScene = () => {
    const stamp = Date.now();
    const defaultLoc = BUILTIN_3D_LOCATIONS[scenes.length % BUILTIN_3D_LOCATIONS.length];
    const cast = roster.slice(0, 2).map((c) => c.id);
    const newScene: StoryScene = {
      id: `story-scene-${stamp}`,
      title: `المشهد ${scenes.length + 1}`,
      locationId: defaultLoc.id,
      cameraMotion: 'zoomIn',
      atmosphere: defaultLoc.defaultAtmosphere,
      sceneBannerText: `${defaultLoc.label}`,
      characterIds: cast,
      transition: 'fade',
      lines: [
        {
          id: `line-${stamp}-1`,
          speakerId: cast[0] || 'wise_narrator',
          position: 'right',
          expression: 'calm',
          text: 'اكتب هنا السطر الحواري أو السردي الأول لهذا المشهد...',
        },
        {
          id: `line-${stamp}-2`,
          speakerId: cast[1] || cast[0] || 'elder_scholar',
          position: 'left',
          expression: 'happy',
          text: 'واكتب هنا رد الشخصية الثانية بأسلوب مؤثر وواضح.',
        },
      ],
    };
    const next = [...scenes, newScene];
    onScenesChange(next);
    onSelectScene(next.length - 1);
  };

  const handleDuplicateScene = (idx: number) => {
    const src = scenes[idx];
    if (!src) return;
    const stamp = Date.now();
    const copy: StoryScene = {
      ...src,
      id: `story-scene-${stamp}`,
      title: `${src.title} (نسخة)`,
      lines: src.lines.map((ln, lIdx) => ({
        ...ln,
        id: `line-${stamp}-${lIdx}`,
      })),
    };
    const next = [...scenes.slice(0, idx + 1), copy, ...scenes.slice(idx + 1)];
    onScenesChange(next);
    onSelectScene(idx + 1);
  };

  const handleDeleteScene = (idx: number) => {
    if (scenes.length <= 1) return;
    const next = scenes.filter((_, i) => i !== idx);
    onScenesChange(next);
    onSelectScene(Math.max(0, Math.min(next.length - 1, idx)));
  };

  const handleMoveScene = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    onScenesChange(next);
    onSelectScene(target);
  };

  const handleToggleCast = (charId: string) => {
    if (!activeScene) return;
    const exists = activeScene.characterIds.includes(charId);
    if (exists) {
      if (activeScene.characterIds.length <= 1) return;
      patchActiveScene((sc) => ({
        ...sc,
        characterIds: sc.characterIds.filter((id) => id !== charId),
      }));
    } else {
      const nextCast = [...activeScene.characterIds.slice(-2), charId];
      patchActiveScene((sc) => ({
        ...sc,
        characterIds: nextCast,
      }));
    }
  };

  const updateLine = (lineId: string, partial: Partial<StoryDialogueLine>) => {
    patchActiveScene((sc) => ({
      ...sc,
      lines: sc.lines.map((ln) => (ln.id === lineId ? { ...ln, ...partial } : ln)),
    }));
  };

  const handleAddLine = () => {
    if (!activeScene) return;
    const cast = activeScene.characterIds.length > 0 ? activeScene.characterIds : [roster[0].id];
    const lastLine = activeScene.lines[activeScene.lines.length - 1];
    const nextSpeaker =
      cast.find((id) => id !== lastLine?.speakerId) ?? cast[0] ?? roster[0].id;
    const nextPos: StoryCharacterPosition =
      lastLine?.position === 'right' ? 'left' : lastLine?.position === 'left' ? 'center' : 'right';

    const newLine: StoryDialogueLine = {
      id: `line-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      speakerId: nextSpeaker,
      position: nextPos,
      expression: 'calm',
      text: '',
    };
    patchActiveScene((sc) => ({
      ...sc,
      lines: [...sc.lines, newLine],
    }));
  };

  const handleDeleteLine = (lineId: string) => {
    if (!activeScene || activeScene.lines.length <= 1) return;
    patchActiveScene((sc) => ({
      ...sc,
      lines: sc.lines.filter((ln) => ln.id !== lineId),
    }));
  };

  const handleMoveLine = (idx: number, dir: -1 | 1) => {
    if (!activeScene) return;
    const target = idx + dir;
    if (target < 0 || target >= activeScene.lines.length) return;
    patchActiveScene((sc) => {
      const next = [...sc.lines];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return { ...sc, lines: next };
    });
  };

  const handleGenerateLineVoice = async (line: StoryDialogueLine) => {
    if (!line.text.trim() || generatingLineId || isBatchGenerating) return;
    setVoiceError('');
    setGeneratingLineId(line.id);
    try {
      soundEngine.getContext();
      const speaker = roster.find((c) => c.id === line.speakerId) ?? roster[0];
      const voice = speaker?.voiceName || 'Kore';
      const styleHint =
        speaker?.id === 'wise_narrator'
          ? 'Warm, dramatic Arabic storyteller voice with rich cinematic pacing; read only the exact text'
          : 'Expressive, natural, semi-realistic Arabic dialogue actor matching the character emotion; read only the exact text cleanly';
      const clip = await generateTtsClip(
        line.text,
        voice,
        `story-${speaker?.id || 'char'}-${Date.now()}.wav`,
        styleHint
      );
      updateLine(line.id, { voiceClip: clip });
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'تعذر توليد الصوت لهذا السطر.');
    } finally {
      setGeneratingLineId(null);
    }
  };

  const handleGenerateAllSceneVoices = async () => {
    if (!activeScene || isBatchGenerating || generatingLineId) return;
    const validLines = activeScene.lines.filter((ln) => ln.text.trim().length > 0);
    if (validLines.length === 0) return;
    setVoiceError('');
    setIsBatchGenerating(true);
    try {
      soundEngine.getContext();
      const updatedLines = [...activeScene.lines];
      for (let i = 0; i < updatedLines.length; i++) {
        const ln = updatedLines[i];
        if (!ln.text.trim()) continue;
        const speaker = roster.find((c) => c.id === ln.speakerId) ?? roster[0];
        setBatchProgressText(
          `جارٍ توليد صوت "${speaker?.name || 'الشخصية'}" (${i + 1}/${updatedLines.length})...`
        );
        const clip = await generateTtsClip(
          ln.text,
          speaker?.voiceName || 'Kore',
          `story-${speaker?.id || 'char'}-${Date.now()}-${i}.wav`,
          speaker?.id === 'wise_narrator'
            ? 'Warm, dramatic Arabic storyteller voice; read only the exact text'
            : 'Expressive Arabic dialogue actor voice; read only the exact text cleanly'
        );
        updatedLines[i] = { ...ln, voiceClip: clip };
        patchActiveScene((sc) => ({
          ...sc,
          lines: sc.lines.map((orig) => (orig.id === ln.id ? updatedLines[i] : orig)),
        }));
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'توقف توليد الأصوات.');
    } finally {
      setIsBatchGenerating(false);
      setBatchProgressText('');
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const lineId = uploadTargetLineId;
    e.target.value = '';
    setUploadTargetLineId(null);
    if (!file || !lineId) return;
    const dataUrl = await readFileAsDataUrl(file);
    const duration = await soundEngine.getAudioDuration(dataUrl);
    updateLine(lineId, {
      voiceClip: {
        fileName: file.name,
        dataUrl,
        duration: duration > 0 ? duration : 2.0,
      },
    });
  };

  if (!activeScene) return null;

  const activeLocation =
    BUILTIN_3D_LOCATIONS.find((l) => l.id === activeScene.locationId) ?? BUILTIN_3D_LOCATIONS[0];

  return (
    <div className="flex flex-col gap-5">
      <input
        ref={audioUploadInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleAudioFileUpload(e)}
      />

      {/* Story Title */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-bold text-[var(--ptxt)]">عنوان القصة / العمل 3D</label>
        <input
          type="text"
          value={storyTitle}
          onChange={(e) => onStoryTitleChange(e.target.value)}
          placeholder="مثال: ميزان الأمانة · قصة التاجر الصادق"
          className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-sm font-bold text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
        />
      </div>

      {/* Scenes Strip Header */}
      <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-[var(--gold)]" />
            <span className="text-xs font-extrabold text-[var(--ptxt)]">
              مشاهد القصة ({scenes.length})
            </span>
          </div>
          <button
            type="button"
            onClick={handleAddScene}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer min-h-[36px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>مشهد جديد</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {scenes.map((sc, idx) => {
            const selected = idx === safeIdx;
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => onSelectScene(idx)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                  selected
                    ? 'bg-[#00B050] border-[#00B050] text-white'
                    : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                <span className="font-mono-nums">{idx + 1}.</span>
                <span className="max-w-[130px] truncate">{sc.title || `مشهد ${idx + 1}`}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--pline)]/70">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleMoveScene(safeIdx, -1)}
              disabled={safeIdx === 0}
              className="px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
              title="تقديم المشهد"
            >
              <ArrowUp className="w-3 h-3" />
              <span>أعلى</span>
            </button>
            <button
              type="button"
              onClick={() => handleMoveScene(safeIdx, 1)}
              disabled={safeIdx >= scenes.length - 1}
              className="px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
              title="تأخير المشهد"
            >
              <ArrowDown className="w-3 h-3" />
              <span>أسفل</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleDuplicateScene(safeIdx)}
              className="px-2.5 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-semibold cursor-pointer flex items-center gap-1"
            >
              <Copy className="w-3 h-3" />
              <span>نسخ</span>
            </button>
            <button
              type="button"
              onClick={() => handleDeleteScene(safeIdx)}
              disabled={scenes.length <= 1}
              className="px-2.5 py-1 rounded-md bg-[var(--panel)] border border-rose-500/35 text-rose-500 hover:bg-rose-500/10 text-[11px] font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>حذف</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Scene Staging: Location + Camera + Cast */}
      <div className="flex flex-col gap-3.5 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">عنوان المشهد الحالي</span>
            <input
              type="text"
              value={activeScene.title}
              onChange={(e) => patchActiveScene((sc) => ({ ...sc, title: e.target.value }))}
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)]">شريط المكان العلوي (في الفيديو)</span>
            <input
              type="text"
              value={activeScene.sceneBannerText ?? ''}
              onChange={(e) =>
                patchActiveScene((sc) => ({ ...sc, sceneBannerText: e.target.value }))
              }
              placeholder={activeLocation.label}
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            />
          </label>
        </div>

        {/* Location Picker */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[var(--pmuted)] flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[var(--gold)]" />
              <span>مكان المشهد 3D</span>
            </span>
            {onJumpToLocations && (
              <button
                type="button"
                onClick={onJumpToLocations}
                className="text-[11px] font-bold text-[#00B050] hover:underline cursor-pointer"
              >
                استعراض أو رفع خلفية خاصة ←
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {BUILTIN_3D_LOCATIONS.map((loc) => {
              const selected = activeScene.locationId === loc.id && !activeScene.customLocationUrl;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() =>
                    patchActiveScene((sc) => ({
                      ...sc,
                      locationId: loc.id,
                      customLocationUrl: undefined,
                      atmosphere: loc.defaultAtmosphere,
                      sceneBannerText: sc.sceneBannerText || loc.label,
                    }))
                  }
                  className={`flex flex-col rounded-lg overflow-hidden border transition-all cursor-pointer text-right ${
                    selected
                      ? 'border-[#00B050] ring-2 ring-[#00B050]/40'
                      : 'border-[var(--pline)] hover:border-[var(--gold)]'
                  }`}
                >
                  <img
                    src={loc.src}
                    alt={loc.label}
                    className="w-full h-14 object-cover"
                  />
                  <span className="px-1.5 py-1 text-[10px] font-bold text-[var(--ptxt)] bg-[var(--panel)] truncate w-full">
                    {loc.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Camera Motion + Atmosphere */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)] flex items-center gap-1">
              <Camera className="w-3.5 h-3.5 text-[#00B050]" />
              <span>حركة الكاميرا</span>
            </span>
            <select
              value={activeScene.cameraMotion}
              onChange={(e) =>
                patchActiveScene((sc) => ({
                  ...sc,
                  cameraMotion: e.target.value as StoryCameraMotion,
                }))
              }
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              {CAMERA_MOTION_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-[var(--pmuted)] flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-[var(--gold)]" />
              <span>الجو والمؤثرات البصرية</span>
            </span>
            <select
              value={activeScene.atmosphere}
              onChange={(e) =>
                patchActiveScene((sc) => ({
                  ...sc,
                  atmosphere: e.target.value as StoryAtmosphere,
                }))
              }
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              {ATMOSPHERE_OPTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Scene Cast Selector (up to 3 characters) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-[var(--pmuted)] flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-[#00B050]" />
            <span>الشخصيات الحاضرة في هذا المشهد (حتى 3 شخصيات 3D)</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {roster.map((ch) => {
              const active = activeScene.characterIds.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => handleToggleCast(ch.id)}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#00B050]/15 border-[#00B050] text-[var(--ptxt)]'
                      : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--pmuted)] hover:border-[var(--gold)]'
                  }`}
                >
                  <img
                    src={ch.avatarUrl}
                    alt={ch.name}
                    className="w-7 h-7 rounded-full object-cover border border-white/20"
                  />
                  <span>{ch.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Multi-Speaker Dialogue Lines */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-[#00B050]" />
            <span className="text-xs font-extrabold text-[var(--ptxt)]">
              حوارات وأصوات المشهد ({activeScene.lines.length} سطر)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isBatchGenerating || Boolean(generatingLineId)}
              onClick={() => void handleGenerateAllSceneVoices()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-55 text-white text-xs font-bold cursor-pointer min-h-[36px]"
            >
              {isBatchGenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
              <span>
                {isBatchGenerating ? 'جارٍ التوليد...' : 'توليد أصوات جميع أسطر المشهد'}
              </span>
            </button>
          </div>
        </div>

        {batchProgressText && (
          <div className="px-3 py-2 rounded-lg bg-[#00B050]/12 border border-[#00B050]/35 text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
            {batchProgressText}
          </div>
        )}

        {voiceError && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-xs text-rose-500 dark:text-rose-300">
            {voiceError}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {activeScene.lines.map((line, lIdx) => {
            const speaker = roster.find((c) => c.id === line.speakerId) ?? roster[0];
            const isGen = generatingLineId === line.id;
            const estDur = computeStoryLineDuration(line);

            return (
              <div
                key={line.id}
                className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]"
              >
                {/* Line top controls */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={speaker.avatarUrl}
                      alt={speaker.name}
                      className="w-9 h-9 rounded-full object-cover border-2 shrink-0"
                      style={{ borderColor: speaker.accentColor || '#00B050' }}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={line.speakerId}
                        onChange={(e) => {
                          const newSpeaker = e.target.value;
                          updateLine(line.id, { speakerId: newSpeaker });
                          if (!activeScene.characterIds.includes(newSpeaker)) {
                            patchActiveScene((sc) => ({
                              ...sc,
                              characterIds: [...sc.characterIds.slice(-2), newSpeaker],
                            }));
                          }
                        }}
                        className="px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                      >
                        {roster.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.voiceName})
                          </option>
                        ))}
                      </select>

                      <select
                        value={line.position}
                        onChange={(e) =>
                          updateLine(line.id, {
                            position: e.target.value as StoryCharacterPosition,
                          })
                        }
                        className="px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-semibold text-[var(--ptxt)]"
                        title="موضع الشخصية على الشاشة"
                      >
                        {POSITION_OPTIONS.map((p) => (
                          <option key={p.id} value={p.id}>
                            الموضع: {p.label}
                          </option>
                        ))}
                      </select>

                      <select
                        value={line.expression ?? 'calm'}
                        onChange={(e) =>
                          updateLine(line.id, {
                            expression: e.target.value as StoryCharacterExpression,
                          })
                        }
                        className="px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-semibold text-[var(--ptxt)]"
                        title="التعبير الدرامي"
                      >
                        {EXPRESSION_OPTIONS.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-mono-nums text-[var(--pmuted)] px-1.5">
                      {estDur.toFixed(1)} ث
                    </span>
                    <button
                      type="button"
                      disabled={lIdx === 0}
                      onClick={() => handleMoveLine(lIdx, -1)}
                      className="p-1.5 rounded-md bg-[var(--panel)] border border-[var(--pline)] disabled:opacity-35 cursor-pointer"
                      title="نقل للأعلى"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={lIdx >= activeScene.lines.length - 1}
                      onClick={() => handleMoveLine(lIdx, 1)}
                      className="p-1.5 rounded-md bg-[var(--panel)] border border-[var(--pline)] disabled:opacity-35 cursor-pointer"
                      title="نقل للأسفل"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={activeScene.lines.length <= 1}
                      onClick={() => handleDeleteLine(line.id)}
                      className="p-1.5 rounded-md bg-[var(--panel)] border border-rose-500/35 text-rose-500 disabled:opacity-35 cursor-pointer"
                      title="حذف السطر"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Line dialogue textarea */}
                <textarea
                  rows={2}
                  value={line.text}
                  onChange={(e) => updateLine(line.id, { text: e.target.value })}
                  placeholder="اكتب نص الحوار الذي ستنطقه هذه الشخصية..."
                  className="w-full px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-sm leading-relaxed text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none resize-y"
                />

                {/* Audio controls for this line */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!line.text.trim() || isGen || isBatchGenerating}
                      onClick={() => void handleGenerateLineVoice(line)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00B050]/15 border border-[#00B050]/45 hover:bg-[#00B050]/25 text-[#00B050] dark:text-[#6ee7b7] text-[11px] font-bold disabled:opacity-50 cursor-pointer"
                    >
                      {isGen ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isGen
                          ? 'جارٍ التوليد...'
                          : line.voiceClip?.dataUrl
                            ? `إعادة توليد صوت ${speaker.name}`
                            : `توليد بصوت ${speaker.name}`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setUploadTargetLineId(line.id);
                        audioUploadInputRef.current?.click();
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-semibold cursor-pointer"
                    >
                      <Upload className="w-3 h-3" />
                      <span>رفع صوت</span>
                    </button>
                  </div>

                  {line.voiceClip?.dataUrl && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--panel)] border border-[#00B050]/40">
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.getContext();
                          void soundEngine.playClip(line.voiceClip!, 1);
                        }}
                        className="flex items-center gap-1 text-[11px] font-bold text-[#00B050] cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        <span>تشغيل ({line.voiceClip.duration.toFixed(1)} ث)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateLine(line.id, { voiceClip: undefined })}
                        className="text-rose-500 hover:text-rose-400 p-0.5 cursor-pointer"
                        title="إزالة الملف الصوتي"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleAddLine}
          className="w-full py-2.5 rounded-xl bg-[var(--surface)] border border-dashed border-[#00B050]/55 hover:bg-[#00B050]/10 text-[#00B050] dark:text-[#6ee7b7] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer min-h-[42px]"
        >
          <Plus className="w-4 h-4" />
          <span>+ إضافة سطر حوار جديد في هذا المشهد</span>
        </button>
      </div>
    </div>
  );
};
