import React from 'react';
import { Copy, Film, Plus, Trash2, Volume2 } from 'lucide-react';
import { BUILTIN_3D_CHARACTERS, resolveStoryLocationInfo } from '../data/storyAssets';
import {
  StoryCharacterProfile,
  StoryCinemaSettings,
  StoryScene,
  TemplateSettings,
  TimingSettings,
  computeStoryTimeline,
} from '../types/quiz';

interface StoryStoryboardBarProps {
  scenes: StoryScene[];
  characters: StoryCharacterProfile[];
  activeSceneIndex: number;
  timing: TimingSettings;
  storySettings?: StoryCinemaSettings;
  template: TemplateSettings;
  onSelectScene: (idx: number) => void;
  onAddScene: () => void;
  onDuplicateScene: (idx: number) => void;
  onDeleteScene: (idx: number) => void;
}

export const StoryStoryboardBar: React.FC<StoryStoryboardBarProps> = ({
  scenes,
  characters,
  activeSceneIndex,
  timing,
  storySettings,
  template,
  onSelectScene,
  onAddScene,
  onDuplicateScene,
  onDeleteScene,
}) => {
  const roster = characters.length > 0 ? characters : BUILTIN_3D_CHARACTERS;
  const schedules = computeStoryTimeline(scenes, timing, storySettings, template);

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 bg-[var(--panel)] border-t border-[var(--pline)] shrink-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--ptxt)]">
          <Film className="w-3.5 h-3.5 text-[var(--gold)]" />
          <span>شريط مشاهد القصة 3D ({scenes.length})</span>
        </div>

        <button
          type="button"
          onClick={onAddScene}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[11px] font-bold cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>مشهد جديد</span>
        </button>
      </div>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {scenes.map((sc, idx) => {
          const isActive = idx === activeSceneIndex;
          const loc = resolveStoryLocationInfo(sc.locationId, sc.customLocationUrl);
          const sched = schedules[idx];
          const dur = sched?.duration ?? 5;
          const hasVoice = sc.lines.some((ln) => Boolean(ln.voiceClip?.dataUrl));
          const cast = (sc.characterIds || [])
            .map((id) => roster.find((c) => c.id === id))
            .filter((x): x is StoryCharacterProfile => Boolean(x))
            .slice(0, 3);

          return (
            <div
              key={sc.id}
              onClick={() => onSelectScene(idx)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectScene(idx);
                }
              }}
              className={`group relative shrink-0 w-44 rounded-xl border p-2 flex flex-col gap-1.5 cursor-pointer transition-all ${
                isActive
                  ? 'bg-[#00B050]/12 border-[#00B050] shadow-sm'
                  : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[var(--gold)]'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <img
                    src={loc.src}
                    alt={loc.label}
                    className="w-7 h-5 rounded object-cover border border-white/20 shrink-0"
                  />
                  <span className="text-[11px] font-extrabold text-[var(--ptxt)] truncate">
                    {idx + 1}. {sc.title || `مشهد ${idx + 1}`}
                  </span>
                </div>
                <span className="text-[10px] font-mono-nums text-[var(--pmuted)] shrink-0">
                  {dur.toFixed(1)}ث
                </span>
              </div>

              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center -space-x-1.5 space-x-reverse">
                  {cast.map((ch) => (
                    <img
                      key={ch.id}
                      src={ch.avatarUrl}
                      alt={ch.name}
                      className="w-5 h-5 rounded-full object-cover border border-[var(--panel)]"
                    />
                  ))}
                  <span className="text-[10px] text-[var(--pmuted)] mr-2">
                    {sc.lines.length} حوار
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {hasVoice && <Volume2 className="w-3 h-3 text-[#00B050]" />}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateScene(idx);
                    }}
                    className="p-1 rounded hover:bg-[var(--panel)] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    title="تكرار المشهد"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {scenes.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteScene(idx);
                      }}
                      className="p-1 rounded hover:bg-rose-500/15 text-[var(--pmuted)] hover:text-rose-500 cursor-pointer"
                      title="حذف المشهد"
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
