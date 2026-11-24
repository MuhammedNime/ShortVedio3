import React, { useState } from 'react';
import {
  Brain,
  Clapperboard,
  Film,
  FolderOpen,
  HelpCircle,
  ListOrdered,
  Plus,
  Sparkles,
  Swords,
  Users,
  X,
} from 'lucide-react';
import { SlideType } from '../types/quiz';

interface QuickStartModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProjectName: string;
  onGoToAiTab: (contentType?: 'general' | 'math' | 'trueFalse' | 'clues' | 'versus' | 'order' | 'fillBlank' | 'story') => void;
  onStartFormatProject: (slideType: SlideType, projectTitle: string) => void;
  onStartStoryMode: (targetTab: 'scenes' | 'storyAi') => void;
  onOpenVault: () => void;
  onOpenProjects: () => void;
  onCreateBlankProject: (customName?: string) => void;
}

export const QuickStartModal: React.FC<QuickStartModalProps> = ({
  isOpen,
  onClose,
  currentProjectName,
  onGoToAiTab,
  onStartFormatProject,
  onStartStoryMode,
  onOpenVault,
  onOpenProjects,
  onCreateBlankProject,
}) => {
  const [newProjectTitle, setNewProjectTitle] = useState('');

  if (!isOpen) return null;

  const formatPaths: {
    id: SlideType;
    aiType: 'general' | 'versus' | 'order' | 'story';
    title: string;
    desc: string;
    icon: typeof Sparkles;
    projectLabel: string;
  }[] = [
    {
      id: 'multiple',
      aiType: 'general',
      title: '02. فيديو مسابقات وتحديات',
      desc: 'أسئلة 4 خيارات أو صح/خطأ أو 3 تلميحات مع مؤقت وتأثيرات كشف الإجابة.',
      icon: HelpCircle,
      projectLabel: 'مشروع مسابقة جديد',
    },
    {
      id: 'story',
      aiType: 'story',
      title: '03. شرائح معلوماتية متسلسلة',
      desc: 'نقاط متتابعة في وضع المسابقات بدون مؤقت، للشروحات السريعة والمعلومات.',
      icon: Film,
      projectLabel: 'مشروع معلومات سريعة',
    },
    {
      id: 'versus',
      aiType: 'versus',
      title: '04. تحديات المقارنة والترتيب التفاعلية',
      desc: 'مواجهات VS أو ترتيب تسلسلي من #1 إلى #4 أو إكمال الفراغ لجذب التعليقات.',
      icon: Swords,
      projectLabel: 'مشروع تحدي تفاعلي',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quickstart-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-[var(--pline)] bg-[var(--surface)]">
          <div className="min-w-0">
            <h2
              id="quickstart-title"
              className="font-display text-base sm:text-lg font-extrabold text-[var(--ptxt)] truncate"
            >
              البدء السريع · اختر نوع الفيديو
            </h2>
            <p className="text-[11px] text-[var(--pmuted)] truncate">
              المشروع الحالي: {currentProjectName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة البدء السريع"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex flex-col gap-3.5">
          {/* Featured 01: Dedicated 3D Storytelling & Multi-Character Dialogue Cinema */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/12 via-[var(--surface)] to-[#00B050]/10 border border-amber-500/45 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-extrabold text-[var(--ptxt)]">
                  01. استوديو القصص والحوارات 3D (شخصيات وأماكن شبه حقيقية)
                </h3>
                <p className="text-xs text-[var(--pmuted)] leading-relaxed">
                  أنتج قصصاً إسلامية وحوارات بين شخصيتين أو ثلاث شخصيات 3D بأصوات مختلفة وأماكن مصممة (السوق، المسجد، مجلس العلم، الصحراء، الاستوديو) بدون أسئلة أو مؤقت.
                </p>
              </div>
              <Clapperboard className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartStoryMode('storyAi');
                }}
                className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>تأليف قصة وحوار بالذكاء 3D</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartStoryMode('scenes');
                }}
                className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--panel)] hover:border-amber-400 border border-[var(--pline)] text-[var(--ptxt)] text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Users className="w-4 h-4 text-amber-400 shrink-0" />
                <span>فتح استوديو المشاهد والحوارات</span>
              </button>
            </div>
          </div>

          {/* Format-Specific Launchers */}
          {formatPaths.map((path) => {
            const Icon = path.icon;
            return (
              <div
                key={path.id}
                className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-extrabold text-[var(--ptxt)]">
                      {path.title}
                    </h3>
                    <p className="text-xs text-[var(--pmuted)] leading-relaxed">
                      {path.desc}
                    </p>
                  </div>
                  <Icon className="w-5 h-5 text-[#00B050] shrink-0 mt-0.5" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onGoToAiTab(path.aiType);
                    }}
                    className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>توليد بالذكاء الاصطناعي</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onStartFormatProject(path.id, path.projectLabel);
                      onClose();
                    }}
                    className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--panel)] hover:border-[#00B050] border border-[var(--pline)] text-[var(--ptxt)] text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {path.id === 'versus' ? (
                      <ListOrdered className="w-4 h-4 text-[var(--gold)] shrink-0" />
                    ) : (
                      <Plus className="w-4 h-4 text-[var(--gold)] shrink-0" />
                    )}
                    <span>بدء مشروع يدوي بهذا النمط</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* Question Bank Vault */}
          <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-extrabold text-[var(--ptxt)]">
                05. السحب الفوري من بنك الذاكرة
              </h3>
              <p className="text-xs text-[var(--pmuted)] leading-relaxed">
                أكثر من 700 سؤال مصنف بالمجلدات — جهّز 5 أو 10 أسئلة لفيديو كامل بضغطة واحدة.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVault();
              }}
              className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--panel)] border border-[#00B050]/55 hover:border-[#00B050] text-[#00B050] dark:text-[#6ee7b7] text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Brain className="w-4 h-4 shrink-0" />
              <span>فتح بنك الذاكرة</span>
            </button>
          </div>

          {/* Blank Project / Projects Library */}
          <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-extrabold text-[var(--ptxt)]">
                  06. مشروع مخصص أو مكتبة المشاريع
                </h3>
                <p className="text-xs text-[var(--pmuted)] leading-relaxed">
                  أنشئ مشروعاً باسم محدد أو انتقل بين مشاريعك المحفوظة.
                </p>
              </div>
              <FolderOpen className="w-5 h-5 text-[var(--gold)] shrink-0 mt-0.5" />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                placeholder="اسم المشروع الجديد (اختياري)..."
                className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] placeholder:text-[var(--pmuted)] focus:border-[#00B050] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  onCreateBlankProject(newProjectTitle.trim() || undefined);
                  setNewProjectTitle('');
                  onClose();
                }}
                className="min-h-[44px] flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--panel)] hover:border-[#00B050] border border-[var(--pline)] text-[var(--ptxt)] text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[#00B050]" />
                <span>مشروع فارغ</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenProjects();
                }}
                className="min-h-[44px] flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--panel)] hover:border-[var(--gold)] border border-[var(--pline)] text-[var(--ptxt)] text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-[var(--gold)]" />
                <span>مكتبة المشاريع</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
