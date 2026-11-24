import React, { useRef, useState } from 'react';
import {
  Check,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Volume2,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { BUILTIN_3D_CHARACTERS, BUILTIN_3D_LOCATIONS } from '../data/storyAssets';
import { AI_VOICE_OPTIONS, AiVoiceName, generateTtsClip } from '../services/aiClient';
import { readFileAsDataUrl } from '../storage/projectStore';
import { StoryCharacterProfile, StoryScene } from '../types/quiz';

interface StoryCastLocationsPanelProps {
  initialFocus?: 'cast' | 'locations';
  characters: StoryCharacterProfile[];
  scenes: StoryScene[];
  activeSceneIndex: number;
  onCharactersChange: (next: StoryCharacterProfile[]) => void;
  onScenesChange: (next: StoryScene[]) => void;
}

const ACCENT_SWATCHES = ['#f59e0b', '#10b981', '#38bdf8', '#eab308', '#22d3ee', '#f43f5e'];

export const StoryCastLocationsPanel: React.FC<StoryCastLocationsPanelProps> = ({
  initialFocus = 'cast',
  characters,
  scenes,
  activeSceneIndex,
  onCharactersChange,
  onScenesChange,
}) => {
  const [sectionView, setSectionView] = useState<'cast' | 'locations'>(initialFocus);
  const [testingVoiceCharId, setTestingVoiceCharId] = useState<string | null>(null);
  const [voiceTestErr, setVoiceTestErr] = useState('');
  const charAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarTargetCharId, setAvatarTargetCharId] = useState<string | null>(null);
  const locationUploadRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setSectionView(initialFocus);
  }, [initialFocus]);

  const roster = characters.length > 0 ? characters : BUILTIN_3D_CHARACTERS;
  const safeSceneIdx = Math.max(0, Math.min(scenes.length - 1, activeSceneIndex));
  const activeScene = scenes[safeSceneIdx];

  const updateChar = (id: string, partial: Partial<StoryCharacterProfile>) => {
    onCharactersChange(roster.map((c) => (c.id === id ? { ...c, ...partial } : c)));
  };

  const handleAddCharacter = () => {
    const sample = BUILTIN_3D_CHARACTERS[roster.length % BUILTIN_3D_CHARACTERS.length];
    const nextChar: StoryCharacterProfile = {
      id: `char-${Date.now()}`,
      name: `شخصية ${roster.length + 1}`,
      roleTitle: 'شخصية حوارية 3D',
      avatarUrl: sample.avatarUrl,
      voiceName: AI_VOICE_OPTIONS[roster.length % AI_VOICE_OPTIONS.length].id,
      accentColor: ACCENT_SWATCHES[roster.length % ACCENT_SWATCHES.length],
    };
    onCharactersChange([...roster, nextChar]);
  };

  const handleDeleteCharacter = (id: string) => {
    if (roster.length <= 2) return;
    const remaining = roster.filter((c) => c.id !== id);
    const fallbackId = remaining[0].id;
    onCharactersChange(remaining);
    onScenesChange(
      scenes.map((sc) => ({
        ...sc,
        characterIds: sc.characterIds
          .map((cid) => (cid === id ? fallbackId : cid))
          .filter((cid, idx, arr) => arr.indexOf(cid) === idx),
        lines: sc.lines.map((ln) => (ln.speakerId === id ? { ...ln, speakerId: fallbackId } : ln)),
      }))
    );
  };

  const handleUploadCharAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = avatarTargetCharId;
    e.target.value = '';
    setAvatarTargetCharId(null);
    if (!file || !targetId) return;
    const dataUrl = await readFileAsDataUrl(file);
    updateChar(targetId, { avatarUrl: dataUrl });
  };

  const handleTestVoice = async (char: StoryCharacterProfile) => {
    if (testingVoiceCharId) return;
    setVoiceTestErr('');
    setTestingVoiceCharId(char.id);
    try {
      soundEngine.getContext();
      const clip = await generateTtsClip(
        `السلام عليكم، أنا ${char.name}، وجاهز للمشاركة في قصتك المصورة.`,
        char.voiceName,
        `preview-${char.id}.wav`
      );
      await soundEngine.playClip(clip, 1);
    } catch (err) {
      setVoiceTestErr(err instanceof Error ? err.message : 'تعذر اختبار الصوت الآن.');
    } finally {
      setTestingVoiceCharId(null);
    }
  };

  const applyLocationToActiveScene = (locId: string, customUrl?: string) => {
    if (!activeScene) return;
    const loc = BUILTIN_3D_LOCATIONS.find((l) => l.id === locId) ?? BUILTIN_3D_LOCATIONS[0];
    onScenesChange(
      scenes.map((sc, idx) =>
        idx === safeSceneIdx
          ? {
              ...sc,
              locationId: loc.id,
              customLocationUrl: customUrl,
              atmosphere: customUrl ? sc.atmosphere : loc.defaultAtmosphere,
              sceneBannerText: customUrl ? sc.sceneBannerText : loc.label,
            }
          : sc
      )
    );
  };

  const handleUploadCustomLocation = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeScene) return;
    const dataUrl = await readFileAsDataUrl(file);
    applyLocationToActiveScene(activeScene.locationId, dataUrl);
  };

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={charAvatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleUploadCharAvatar(e)}
      />
      <input
        ref={locationUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleUploadCustomLocation(e)}
      />

      {/* Section Switcher */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
        <button
          type="button"
          onClick={() => setSectionView('cast')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
            sectionView === 'cast'
              ? 'bg-[#00B050] text-white'
              : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>الشخصيات 3D ({roster.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSectionView('locations')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
            sectionView === 'locations'
              ? 'bg-[#00B050] text-white'
              : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>الأماكن والخلفيات 3D</span>
        </button>
      </div>

      {sectionView === 'cast' ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--pmuted)]">
              شخصيات ثلاثية الأبعاد شبه واقعية جاهزة للحوار والقصص مع نبرة صوت مستقلة لكل شخصية.
            </p>
            <button
              type="button"
              onClick={handleAddCharacter}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة شخصية</span>
            </button>
          </div>

          {voiceTestErr && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-xs text-rose-500">
              {voiceTestErr}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {roster.map((ch) => {
              const isTesting = testingVoiceCharId === ch.id;
              return (
                <div
                  key={ch.id}
                  className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0">
                      <img
                        src={ch.avatarUrl}
                        alt={ch.name}
                        className="w-16 h-20 rounded-xl object-cover border-2"
                        style={{ borderColor: ch.accentColor || '#00B050' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarTargetCharId(ch.id);
                          charAvatarInputRef.current?.click();
                        }}
                        className="mt-1 w-full flex items-center justify-center gap-1 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[10px] font-bold hover:border-[var(--gold)] cursor-pointer"
                      >
                        <Upload className="w-2.5 h-2.5" />
                        <span>صورة</span>
                      </button>
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-[var(--pmuted)]">اسم الشخصية</span>
                          <input
                            type="text"
                            value={ch.name}
                            onChange={(e) => updateChar(ch.id, { name: e.target.value })}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)]"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-[var(--pmuted)]">الدور / الوصف</span>
                          <input
                            type="text"
                            value={ch.roleTitle ?? ''}
                            onChange={(e) => updateChar(ch.id, { roleTitle: e.target.value })}
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={ch.voiceName}
                            onChange={(e) =>
                              updateChar(ch.id, { voiceName: e.target.value as AiVoiceName })
                            }
                            className="px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-bold text-[var(--ptxt)]"
                          >
                            {AI_VOICE_OPTIONS.map((v) => (
                              <option key={v.id} value={v.id}>
                                الصوت: {v.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={Boolean(testingVoiceCharId)}
                            onClick={() => void handleTestVoice(ch)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050]/15 border border-[#00B050]/45 text-[#00B050] dark:text-[#6ee7b7] text-[11px] font-bold cursor-pointer"
                          >
                            {isTesting ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Volume2 className="w-3 h-3" />
                            )}
                            <span>تجربة</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {ACCENT_SWATCHES.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              onClick={() => updateChar(ch.id, { accentColor: hex })}
                              className={`w-5 h-5 rounded-full border cursor-pointer ${
                                ch.accentColor === hex
                                  ? 'ring-2 ring-white scale-110'
                                  : 'border-white/20 opacity-80'
                              }`}
                              style={{ backgroundColor: hex }}
                              aria-label={hex}
                            />
                          ))}
                          {roster.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCharacter(ch.id)}
                              className="p-1.5 rounded-md text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                              title="حذف الشخصية"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Quick 3D model presets */}
                      <div className="flex items-center gap-1.5 pt-1 overflow-x-auto">
                        <span className="text-[10px] text-[var(--pmuted)] shrink-0">نموذج 3D:</span>
                        {BUILTIN_3D_CHARACTERS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => updateChar(ch.id, { avatarUrl: preset.avatarUrl })}
                            className={`shrink-0 rounded-lg p-0.5 border cursor-pointer ${
                              ch.avatarUrl === preset.avatarUrl
                                ? 'border-[#00B050]'
                                : 'border-transparent opacity-75 hover:opacity-100'
                            }`}
                            title={preset.name}
                          >
                            <img
                              src={preset.avatarUrl}
                              alt={preset.name}
                              className="w-7 h-7 rounded-md object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-extrabold text-[var(--ptxt)]">
                المشهد النشط الآن: {activeScene?.title || `المشهد ${safeSceneIdx + 1}`}
              </span>
              <span className="text-[11px] text-[var(--pmuted)]">
                اختر أي مكان 3D ليتم تطبيقه فوراً على المشهد المحدد، أو ارفع خلفية خاصة بك.
              </span>
            </div>
            <button
              type="button"
              onClick={() => locationUploadRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>رفع مكان / خلفية خاصة</span>
            </button>
          </div>

          {activeScene?.customLocationUrl && (
            <div className="p-3 rounded-xl bg-[#00B050]/10 border border-[#00B050]/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img
                  src={activeScene.customLocationUrl}
                  alt="خلفية مخصصة"
                  className="w-16 h-12 rounded-lg object-cover border border-white/20"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
                    مفعّل حالياً: خلفية خاصة للمشهد
                  </span>
                  <span className="text-[11px] text-[var(--pmuted)]">
                    يمكنك اختيار أحد الأماكن الجاهزة أدناه للاستبدال في أي وقت.
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BUILTIN_3D_LOCATIONS.map((loc) => {
              const isSelected =
                activeScene?.locationId === loc.id && !activeScene?.customLocationUrl;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => applyLocationToActiveScene(loc.id)}
                  className={`flex flex-col rounded-xl overflow-hidden border text-right transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#00B050] ring-2 ring-[#00B050]/45 bg-[#00B050]/10'
                      : 'border-[var(--pline)] bg-[var(--surface)] hover:border-[var(--gold)]'
                  }`}
                >
                  <div className="relative w-full h-32">
                    <img src={loc.src} alt={loc.label} className="w-full h-full object-cover" />
                    {isSelected && (
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[#00B050] text-white text-[10px] font-bold flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>مفعّل</span>
                      </span>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-1">
                    <span className="text-xs font-extrabold text-[var(--ptxt)] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[var(--gold)]" />
                      <span>{loc.label}</span>
                    </span>
                    <span className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                      {loc.subtitle}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
