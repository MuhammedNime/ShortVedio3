import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Circle,
  Cloud,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  FileUp,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Loader2,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import {
  AI_VOICE_OPTIONS,
  AiVoiceMode,
  AiVoiceName,
  generateAiQuizSlides,
  generateSlideVoiceoverSafe,
} from '../services/aiClient';
import {
  deleteCloudBankFolder,
  deleteCloudBankQuestion,
  pushBankFoldersToCloud,
  pushBankQuestionsToCloud,
  renameCloudBankFolder,
  signInWithGoogleForSync,
  signOutFirebaseUser,
  subscribeFirebaseUser,
  syncQuestionBankWithCloud,
  updateCloudBankQuestion,
  updateCloudBankQuestionUsed,
  updateCloudBankQuestionsFolder,
} from '../services/firebaseClient';
import { getWebLoginBaseUrl, launchWebLinkLoginForApk } from '../services/youtubeClient';
import {
  BankFolder,
  BankQuestionItem,
  BankStatsSummary,
  addManualQuestionToBank,
  addQuestionsToBank,
  bankItemToQuestionSlide,
  buildFolderBreadcrumb,
  createBankFolder,
  deleteBankFolder,
  deleteBankQuestion,
  getAllBankFolders,
  getAllBankQuestions,
  getBankQuestions,
  getBankStats,
  markBankQuestionsUsed,
  mergeCloudFoldersIntoVault,
  mergeCloudQuestionsIntoBank,
  moveBankQuestionsToFolder,
  parseManualBulkQuestionsText,
  renameBankFolder,
  updateBankQuestionItem,
} from '../storage/questionBankVault';
import { QUIZ_CATEGORIES, QuestionSlide, QuizCategory, SlideType } from '../types/quiz';
import { isAndroidNativeApp, saveOrDownloadBlob } from '../utils/nativeDownload';

interface QuestionBankVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  voiceName: AiVoiceName;
  onVoiceChange: (voice: AiVoiceName) => void;
  onInsertSlides: (
    slides: QuestionSlide[],
    mode: 'append' | 'replace',
    enableAutoSync: boolean,
    warningMessage?: string,
    applyMathTheme?: boolean
  ) => void;
}

type ActiveCreatorDrawer = 'none' | 'manual' | 'bulk' | 'ai';

const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  multiple: '4 خيارات',
  trueFalse: 'صح أم خطأ',
  clues: '3 تلميحات',
  versus: 'مقارنة VS',
};

const FOLDER_EMOJIS = ['📁', '🕌', '📖', '🌙', '⭐', '🧮', '📐', '🔬', '🪐', '🌍', '⚽', '🏛️', '💻', '📚', '💬', '💡'];

interface FolderSelectOption {
  id: string;
  label: string;
  depth: number;
  category?: QuizCategory;
}

function buildIndentedFolderOptions(folders: BankFolder[]): FolderSelectOption[] {
  const byParent = new Map<string | null, BankFolder[]>();
  for (const f of folders) {
    const key = f.parentId || null;
    const arr = byParent.get(key) ?? [];
    arr.push(f);
    byParent.set(key, arr);
  }
  const result: FolderSelectOption[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const prefix = depth > 0 ? `${'— '.repeat(depth)}` : '';
      result.push({
        id: child.id,
        label: `${prefix}${child.emoji || '📁'} ${child.name}`,
        depth,
        category: child.category,
      });
      walk(child.id, depth + 1);
    }
  };

  walk(null, 0);
  // Catch any orphaned folders if parent missing
  for (const f of folders) {
    if (!visited.has(f.id)) {
      result.push({
        id: f.id,
        label: `${f.emoji || '📁'} ${f.name}`,
        depth: 0,
        category: f.category,
      });
    }
  }
  return result;
}

export const QuestionBankVaultModal: React.FC<QuestionBankVaultModalProps> = ({
  isOpen,
  onClose,
  voiceName,
  onVoiceChange,
  onInsertSlides,
}) => {
  const [folders, setFolders] = useState<BankFolder[]>([]);
  const [allQuestions, setAllQuestions] = useState<BankQuestionItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<BankQuestionItem[]>([]);
  const [bankStats, setBankStats] = useState<BankStatsSummary | null>(null);

  // Collapsible Folder Sidebar & Drawer State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(['folder_islamic', 'folder_math', 'folder_science', 'folder_geography'])
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all' | 'unfiled'>('all');
  const [includeSubfolders, setIncludeSubfolders] = useState(true);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<QuizCategory | 'all'>('all');
  const [filterSlideType, setFilterSlideType] = useState<SlideType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unused' | 'used'>('all');
  const [displayLimit, setDisplayLimit] = useState(40);

  // Folder Create / Rename / Delete inline state
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderEmoji, setNewFolderEmoji] = useState('📁');
  const [newFolderCategory, setNewFolderCategory] = useState<QuizCategory>('general');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderText, setRenameFolderText] = useState('');
  const [renameFolderEmoji, setRenameFolderEmoji] = useState('📁');
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<BankFolder | null>(null);

  // Creator Drawers (Manual / Bulk / AI Batch)
  const [creatorDrawer, setCreatorDrawer] = useState<ActiveCreatorDrawer>('none');

  // Manual Question Form State
  const [manualSlideType, setManualSlideType] = useState<SlideType>('multiple');
  const [manualCategory, setManualCategory] = useState<QuizCategory>('islamic');
  const [manualFolderId, setManualFolderId] = useState<string>('');
  const [manualBadge, setManualBadge] = useState('');
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualOpt0, setManualOpt0] = useState('');
  const [manualOpt1, setManualOpt1] = useState('');
  const [manualOpt2, setManualOpt2] = useState('');
  const [manualOpt3, setManualOpt3] = useState('');
  const [manualCorrectIndex, setManualCorrectIndex] = useState<0 | 1 | 2 | 3>(0);
  const [manualExplanation, setManualExplanation] = useState('');
  const [manualDuplicatePending, setManualDuplicatePending] = useState(false);

  // Bulk Paste State
  const [bulkText, setBulkText] = useState('');
  const [bulkCategory, setBulkCategory] = useState<QuizCategory>('general');
  const [bulkSlideType, setBulkSlideType] = useState<SlideType>('multiple');
  const [bulkFolderId, setBulkFolderId] = useState<string>('');

  // AI Batch Generator State
  const [aiCategory, setAiCategory] = useState<QuizCategory>('general');
  const [aiSlideType, setAiSlideType] = useState<SlideType>('multiple');
  const [aiFolderId, setAiFolderId] = useState<string>('');
  const [aiTopicHint, setAiTopicHint] = useState('');
  const [aiDifficulty, setAiDifficulty] = useState('متوسط');
  const [aiTargetCount, setAiTargetCount] = useState(25);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ saved: number; target: number; label: string } | null>(null);
  const aiAbortRef = useRef(false);

  // Multi-select & Inline Question Editing
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(() => new Set());
  const [bulkMoveTargetFolderId, setBulkMoveTargetFolderId] = useState<string>('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    question: string;
    options: [string, string, string, string];
    correctIndex: 0 | 1 | 2 | 3;
    category: QuizCategory;
    slideType: SlideType;
    explanationText: string;
    folderId: string;
  } | null>(null);

  // Voiceover on "تحويل لفيديو"
  const [withVoiceOnInsert, setWithVoiceOnInsert] = useState(true);
  const [voiceModeOnInsert, setVoiceModeOnInsert] = useState<AiVoiceMode>('full');
  const [autoApplyMathTheme, setAutoApplyMathTheme] = useState(true);
  const [workingItemId, setWorkingItemId] = useState<string | null>(null);

  // Cloud & Notices
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorNotice, setErrorNotice] = useState('');
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const loadAllData = useCallback(async () => {
    const [folderRows, allRows, stats, matched] = await Promise.all([
      getAllBankFolders(),
      getAllBankQuestions(),
      getBankStats(),
      getBankQuestions({
        category: filterCategory,
        slideType: filterSlideType,
        status: filterStatus,
        folderId: selectedFolderId,
        includeSubfolders,
        search: searchQuery,
      }),
    ]);
    setFolders(folderRows);
    setAllQuestions(allRows);
    setBankStats(stats);
    setFilteredItems(matched);
  }, [filterCategory, filterSlideType, filterStatus, selectedFolderId, includeSubfolders, searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    void loadAllData();
  }, [isOpen, loadAllData]);

  useEffect(() => {
    return subscribeFirebaseUser((user) => {
      setCloudUser(user);
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAiRunning) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isAiRunning, onClose]);

  const folderOptions = useMemo(() => buildIndentedFolderOptions(folders), [folders]);

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const folderQuestionCounts = useMemo(() => {
    const directMap = new Map<string, number>();
    let unfiledCount = 0;
    for (const q of allQuestions) {
      if (!q.folderId) {
        unfiledCount += 1;
      } else {
        directMap.set(q.folderId, (directMap.get(q.folderId) ?? 0) + 1);
      }
    }
    const childrenByParent = new Map<string | null, BankFolder[]>();
    for (const f of folders) {
      const p = f.parentId || null;
      const arr = childrenByParent.get(p) ?? [];
      arr.push(f);
      childrenByParent.set(p, arr);
    }
    const recursiveMap = new Map<string, number>();
    const computeRec = (id: string, stack = new Set<string>()): number => {
      if (recursiveMap.has(id)) return recursiveMap.get(id)!;
      if (stack.has(id)) return 0;
      stack.add(id);
      let total = directMap.get(id) ?? 0;
      for (const child of childrenByParent.get(id) ?? []) {
        total += computeRec(child.id, stack);
      }
      recursiveMap.set(id, total);
      return total;
    };
    for (const f of folders) {
      computeRec(f.id);
    }
    return { directMap, recursiveMap, unfiledCount };
  }, [allQuestions, folders]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, BankFolder[]>();
    for (const f of folders) {
      const key = f.parentId || null;
      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    }
    return map;
  }, [folders]);

  const activeBreadcrumb = useMemo(() => {
    if (selectedFolderId === 'all') return 'كل الأسئلة في الذاكرة';
    if (selectedFolderId === 'unfiled') return 'أسئلة غير مصنفة بمجلد';
    return buildFolderBreadcrumb(selectedFolderId, folders) || 'مجلد';
  }, [selectedFolderId, folders]);

  // Keep creator target folders synchronized when user picks a folder
  const syncTargetFolderDefaults = (folderId: string | 'all' | 'unfiled') => {
    if (folderId !== 'all' && folderId !== 'unfiled') {
      setManualFolderId(folderId);
      setBulkFolderId(folderId);
      setAiFolderId(folderId);
      const f = folderMap.get(folderId);
      if (f?.category) {
        setManualCategory(f.category);
        setBulkCategory(f.category);
        setAiCategory(f.category);
      }
    }
  };

  const handleSelectFolder = (fid: string | 'all' | 'unfiled') => {
    setSelectedFolderId(fid);
    setDisplayLimit(40);
    setSelectedQuestionIds(new Set());
    syncTargetFolderDefaults(fid);
  };

  const toggleExpandFolder = (fid: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(fid)) next.delete(fid);
      else next.add(fid);
      return next;
    });
  };

  const handleStartCreateFolder = (parentId: string | null) => {
    setCreatingParentId(parentId);
    setNewFolderName('');
    setNewFolderEmoji('📁');
    const parent = parentId ? folderMap.get(parentId) : undefined;
    setNewFolderCategory(parent?.category ?? 'general');
    if (parentId) {
      setExpandedFolderIds((prev) => new Set([...prev, parentId]));
    }
  };

  const handleConfirmCreateFolder = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newFolderName.trim()) {
      setErrorNotice('يرجى كتابة اسم المجلد الجديد.');
      return;
    }
    setErrorNotice('');
    try {
      const created = await createBankFolder({
        name: newFolderName.trim(),
        parentId: creatingParentId ?? null,
        category: newFolderCategory,
        emoji: newFolderEmoji,
      });
      if (cloudUser) {
        void pushBankFoldersToCloud([created]).catch(() => {});
      }
      setCreatingParentId(undefined);
      setNewFolderName('');
      if (created.parentId) {
        setExpandedFolderIds((prev) => new Set([...prev, created.parentId!]));
      }
      await loadAllData();
      handleSelectFolder(created.id);
      setNotice(`تم إنشاء مجلد «${created.name}» بنجاح.`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'تعذر إنشاء المجلد.');
    }
  };

  const handleConfirmRenameFolder = async (folderId: string) => {
    if (!renameFolderText.trim()) return;
    const updated = await renameBankFolder(folderId, renameFolderText.trim(), renameFolderEmoji);
    if (updated && cloudUser) {
      void renameCloudBankFolder(updated).catch(() => {});
    }
    setRenamingFolderId(null);
    await loadAllData();
  };

  const handleDeleteFolderConfirmed = async (mode: 'moveToParent' | 'deleteQuestions') => {
    if (!confirmDeleteFolder) return;
    const target = confirmDeleteFolder;
    setConfirmDeleteFolder(null);
    const res = await deleteBankFolder(target.id, mode);
    if (selectedFolderId !== 'all' && selectedFolderId !== 'unfiled' && res.deletedFolderIds.includes(selectedFolderId)) {
      setSelectedFolderId(target.parentId || 'all');
    }
    await loadAllData();
    if (cloudUser) {
      for (const fid of res.deletedFolderIds) {
        void deleteCloudBankFolder(fid).catch(() => {});
      }
      for (const qid of res.deletedQuestionIds) {
        void deleteCloudBankQuestion(qid).catch(() => {});
      }
      if (mode === 'moveToParent') {
        void syncQuestionBankWithCloud().catch(() => {});
      }
    }
    setNotice(
      mode === 'deleteQuestions'
        ? `تم حذف مجلد «${target.name}» ومحتوياته.`
        : `تم حذف مجلد «${target.name}» ونقل أسئلته للأعلى.`
    );
  };

  const handleSaveManualQuestion = async (allowDuplicate = false) => {
    const cleanQ = manualQuestion.trim();
    if (!cleanQ) {
      setErrorNotice('يرجى كتابة نص السؤال أولاً.');
      return;
    }

    const opts: [string, string, string, string] =
      manualSlideType === 'trueFalse'
        ? ['صح', 'خطأ', '', '']
        : manualSlideType === 'versus'
          ? [manualOpt0.trim() || 'الطرف الأول', manualOpt1.trim() || 'الطرف الثاني', '', '']
          : [manualOpt0.trim(), manualOpt1.trim(), manualOpt2.trim(), manualOpt3.trim()];

    if (manualSlideType === 'multiple' && opts.some((o) => !o)) {
      setErrorNotice('يرجى تعبئة الخيارات الأربعة لسؤال الاختيار من متعدد.');
      return;
    }
    if (manualSlideType === 'clues' && (!opts[0] || !opts[1] || !opts[2] || !opts[3])) {
      setErrorNotice('يرجى تعبئة التلميحات الثلاثة مع الجواب النهائي.');
      return;
    }

    setErrorNotice('');
    setNotice('');
    const targetFolder = manualFolderId || (selectedFolderId !== 'all' && selectedFolderId !== 'unfiled' ? selectedFolderId : undefined);
    const res = await addManualQuestionToBank({
      question: cleanQ,
      options: opts,
      correctIndex: manualSlideType === 'clues' ? 3 : manualCorrectIndex,
      slideType: manualSlideType,
      category: manualCategory,
      badgeText: manualBadge.trim() || undefined,
      explanationText: manualExplanation.trim() || undefined,
      folderId: targetFolder,
      allowDuplicate,
    });

    if (res.duplicate) {
      setManualDuplicatePending(true);
      setErrorNotice('يوجد سؤال مطابق أو قريب جداً منه في الذاكرة. يمكنك تعديله أو الضغط على «حفظ رغم التشابه».');
      return;
    }

    setManualDuplicatePending(false);
    if (res.added) {
      if (cloudUser) {
        void pushBankQuestionsToCloud([res.added]).catch(() => {});
      }
      setManualQuestion('');
      setManualOpt0('');
      setManualOpt1('');
      setManualOpt2('');
      setManualOpt3('');
      setManualExplanation('');
      await loadAllData();
      setNotice('تم حفظ السؤال يدوياً في الذاكرة بنجاح ✅');
    }
  };

  const parsedBulkPreview = useMemo(
    () => parseManualBulkQuestionsText(bulkText, bulkCategory, bulkSlideType),
    [bulkText, bulkCategory, bulkSlideType]
  );

  const handleSaveBulkQuestions = async () => {
    if (parsedBulkPreview.length === 0) {
      setErrorNotice('لم يتم التعرف على أسئلة صالحة. تأكد من تنسيق كل سطر بالفاصل | أو لصق JSON صالح.');
      return;
    }
    setErrorNotice('');
    const targetFolder = bulkFolderId || (selectedFolderId !== 'all' && selectedFolderId !== 'unfiled' ? selectedFolderId : undefined);
    const fPath = targetFolder ? buildFolderBreadcrumb(targetFolder, folders) : '';
    const res = await addQuestionsToBank(
      parsedBulkPreview,
      bulkCategory,
      fPath || 'إضافة يدوية مجمّعة',
      false,
      targetFolder,
      fPath
    );
    if (cloudUser && res.addedItems.length > 0) {
      void pushBankQuestionsToCloud(res.addedItems).catch(() => {});
    }
    setBulkText('');
    await loadAllData();
    setNotice(
      `تم حفظ ${res.addedItems.length} سؤالاً يدوياً في الذاكرة${
        res.skippedDuplicates > 0 ? ` (تجاوز ${res.skippedDuplicates} مكرراً)` : ''
      }.`
    );
  };

  const handleStartAiBatchForVault = async () => {
    if (isAiRunning) return;
    aiAbortRef.current = false;
    setIsAiRunning(true);
    setErrorNotice('');
    setNotice('');

    const targetFolder = aiFolderId || (selectedFolderId !== 'all' && selectedFolderId !== 'unfiled' ? selectedFolderId : undefined);
    const fPath = targetFolder ? buildFolderBreadcrumb(targetFolder, folders) : '';
    const catMeta = QUIZ_CATEGORIES.find((c) => c.id === aiCategory) ?? QUIZ_CATEGORIES[0];
    const modeMap: Record<SlideType, 'general' | 'math' | 'trueFalse' | 'clues' | 'versus'> = {
      multiple: aiCategory === 'math' ? 'math' : 'general',
      trueFalse: 'trueFalse',
      clues: 'clues',
      versus: 'versus',
    };

    let savedTotal = 0;
    let skippedTotal = 0;
    let round = 0;
    const batchSize = 10;
    const maxRounds = Math.ceil(aiTargetCount / batchSize) + 5;
    let consecutiveFail = 0;

    setAiProgress({
      saved: 0,
      target: aiTargetCount,
      label: `جارٍ التحضير لتوليد أسئلة ${fPath || catMeta.label}...`,
    });

    try {
      const existingQs = allQuestions.slice(0, 80).map((q) => q.question);
      while (!aiAbortRef.current && savedTotal < aiTargetCount && round < maxRounds) {
        const needed = Math.min(batchSize, aiTargetCount - savedTotal);
        const promptTopic = `${aiTopicHint.trim() || fPath || catMeta.promptHint} (دفعة ${round + 1})`;
        setAiProgress({
          saved: savedTotal,
          target: aiTargetCount,
          label: `توليد دفعة ${round + 1} (${savedTotal}/${aiTargetCount})...`,
        });

        try {
          const generated = await generateAiQuizSlides(
            promptTopic,
            needed,
            aiDifficulty,
            modeMap[aiSlideType],
            existingQs,
            aiCategory
          );
          consecutiveFail = 0;
          for (const g of generated) existingQs.unshift(g.question);
          const saveRes = await addQuestionsToBank(
            generated,
            aiCategory,
            aiTopicHint.trim() || fPath || catMeta.label,
            false,
            targetFolder,
            fPath
          );
          if (cloudUser && saveRes.addedItems.length > 0) {
            void pushBankQuestionsToCloud(saveRes.addedItems).catch(() => {});
          }
          savedTotal += saveRes.addedItems.length;
          skippedTotal += saveRes.skippedDuplicates;
          await loadAllData();
        } catch (err) {
          consecutiveFail += 1;
          if (consecutiveFail >= 3) {
            setErrorNotice(
              err instanceof Error
                ? `توقف مؤقت بعد حفظ ${savedTotal} سؤالاً: ${err.message}`
                : `توقف مؤقت بعد حفظ ${savedTotal} سؤالاً`
            );
            break;
          }
          await new Promise((r) => setTimeout(r, 1800));
        }

        round += 1;
        if (!aiAbortRef.current && savedTotal < aiTargetCount) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      if (savedTotal > 0) {
        setNotice(
          `تم توليد وحفظ ${savedTotal} سؤالاً جديداً${fPath ? ` داخل «${fPath}»` : ''}${
            skippedTotal > 0 ? ` (تجاوز ${skippedTotal} مكرراً)` : ''
          }.`
        );
      }
    } finally {
      setIsAiRunning(false);
      setAiProgress(null);
      await loadAllData();
    }
  };

  const handleUseQuestionInVideo = async (
    item: BankQuestionItem,
    mode: 'append' | 'replace'
  ) => {
    if (workingItemId) return;
    setWorkingItemId(item.id);
    setErrorNotice('');
    try {
      try {
        soundEngine.getContext();
      } catch {
        // ignore
      }

      let slide = bankItemToQuestionSlide(item);
      let warningMsg: string | undefined;

      if (withVoiceOnInsert) {
        const res = await generateSlideVoiceoverSafe(slide, voiceName, voiceModeOnInsert);
        slide = res.slide;
        warningMsg = res.warning;
      }

      await markBankQuestionsUsed([item.id], true);
      if (cloudUser) {
        void updateCloudBankQuestionUsed(item.id, true).catch(() => {});
      }
      await loadAllData();

      const applyMath = item.category === 'math' && autoApplyMathTheme;
      onInsertSlides([slide], mode, withVoiceOnInsert, warningMsg, applyMath);
      onClose();
    } finally {
      setWorkingItemId(null);
    }
  };

  const handlePickRandomUnused = async () => {
    const pool = filteredItems.filter((i) => !i.usedInVideo);
    if (pool.length === 0) {
      setErrorNotice('لا توجد أسئلة جديدة (غير مستخدمة) ضمن المجلد والفلتر الحالي.');
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    await handleUseQuestionInVideo(picked, 'append');
  };

  const handleStartEditItem = (item: BankQuestionItem) => {
    setEditingItemId(item.id);
    setEditDraft({
      question: item.question,
      options: [...item.options] as [string, string, string, string],
      correctIndex: item.correctIndex,
      category: item.category,
      slideType: item.slideType,
      explanationText: item.explanationText || '',
      folderId: item.folderId || '',
    });
  };

  const handleSaveEditItem = async () => {
    if (!editingItemId || !editDraft || !editDraft.question.trim()) return;
    const fId = editDraft.folderId || undefined;
    const fPath = fId ? buildFolderBreadcrumb(fId, folders) : undefined;
    const updated = await updateBankQuestionItem(editingItemId, {
      question: editDraft.question.trim(),
      options: editDraft.options,
      correctIndex: editDraft.correctIndex,
      category: editDraft.category,
      slideType: editDraft.slideType,
      explanationText: editDraft.explanationText.trim(),
      folderId: fId,
      folderPath: fPath,
    });
    if (updated && cloudUser) {
      void updateCloudBankQuestion(updated).catch(() => {});
    }
    setEditingItemId(null);
    setEditDraft(null);
    await loadAllData();
    setNotice('تم تحديث السؤال وحفظه في الذاكرة.');
  };

  const handleBulkMoveSelected = async () => {
    if (selectedQuestionIds.size === 0) return;
    const ids = Array.from(selectedQuestionIds);
    const targetFid = bulkMoveTargetFolderId || undefined;
    const fPath = targetFid ? buildFolderBreadcrumb(targetFid, folders) : undefined;
    await moveBankQuestionsToFolder(ids, targetFid, fPath);
    if (cloudUser) {
      void updateCloudBankQuestionsFolder(ids, targetFid, fPath).catch(() => {});
    }
    setSelectedQuestionIds(new Set());
    await loadAllData();
    setNotice(`تم نقل ${ids.length} سؤالاً إلى ${fPath || 'غير مصنف بمجلد'}.`);
  };

  const handleBulkMarkUsedSelected = async (used: boolean) => {
    if (selectedQuestionIds.size === 0) return;
    const ids = Array.from(selectedQuestionIds);
    await markBankQuestionsUsed(ids, used);
    if (cloudUser) {
      for (const id of ids) {
        void updateCloudBankQuestionUsed(id, used).catch(() => {});
      }
    }
    setSelectedQuestionIds(new Set());
    await loadAllData();
  };

  const handleCloudSync = async () => {
    if (isCloudSyncing) return;
    setIsCloudSyncing(true);
    setErrorNotice('');
    setNotice('');
    try {
      const user = cloudUser ?? (await signInWithGoogleForSync());
      if (!user) return;
      const res = await syncQuestionBankWithCloud();
      await loadAllData();
      setNotice(
        `تمت مزامنة السحابة (${user.email || 'حسابك'}): استرجاع ${res.pulled} سؤال و${res.foldersPulled} مجلد، ورفع ${res.pushed} سؤال و${res.foldersPushed} مجلد.`
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'تعذر إتمام المزامنة مع السحابة.');
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const handleExportVaultBackup = async () => {
    const bundle = {
      version: 2,
      exportedAt: new Date().toISOString(),
      folders,
      questions: allQuestions,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    await saveOrDownloadBlob(
      blob,
      `question-vault-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
    setNotice(`تم تصدير ${allQuestions.length} سؤالاً و ${folders.length} مجلداً.`);
  };

  const handleImportVaultJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorNotice('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      let importedFolders: BankFolder[] = [];
      let importedQuestions: BankQuestionItem[] = [];
      if (Array.isArray(parsed)) {
        importedQuestions = parsed as BankQuestionItem[];
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as { folders?: BankFolder[]; questions?: BankQuestionItem[] };
        if (Array.isArray(obj.folders)) importedFolders = obj.folders;
        if (Array.isArray(obj.questions)) importedQuestions = obj.questions;
      }

      if (importedFolders.length > 0) {
        await mergeCloudFoldersIntoVault(importedFolders);
      }
      let addedCount = 0;
      if (importedQuestions.length > 0) {
        const res = await mergeCloudQuestionsIntoBank(importedQuestions);
        addedCount = res.insertedFromCloud;
      }
      if (cloudUser && (importedFolders.length > 0 || addedCount > 0)) {
        void syncQuestionBankWithCloud().catch(() => {});
      }
      await loadAllData();
      setNotice(`تم استيراد ${addedCount} سؤالاً جديداً و ${importedFolders.length} مجلداً للذاكرة.`);
    } catch {
      setErrorNotice('تعذر قراءة ملف JSON. تأكد من صلاحية الملف.');
    } finally {
      e.target.value = '';
    }
  };

  const renderFolderTreeNodes = (parentId: string | null, depth = 0): React.ReactNode => {
    const nodes = childrenByParent.get(parentId) ?? [];
    if (nodes.length === 0) return null;

    return nodes.map((folder) => {
      const children = childrenByParent.get(folder.id) ?? [];
      const hasChildren = children.length > 0;
      const isExpanded = expandedFolderIds.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const count = folderQuestionCounts.recursiveMap.get(folder.id) ?? 0;
      const isRenaming = renamingFolderId === folder.id;

      return (
        <div key={folder.id} className="flex flex-col">
          <div
            style={{ paddingRight: `${depth * 14 + 6}px` }}
            className={`group flex items-center gap-1 py-1.5 pl-1.5 rounded-lg border transition-colors ${
              isSelected
                ? 'bg-[#00B050]/16 border-[#00B050]/50 text-[#00B050] dark:text-[#6ee7b7]'
                : 'border-transparent hover:bg-[var(--panel)] text-[var(--ptxt)]'
            }`}
          >
            <button
              type="button"
              onClick={() => hasChildren && toggleExpandFolder(folder.id)}
              className={`w-4 h-4 flex items-center justify-center shrink-0 text-[var(--pmuted)] ${
                hasChildren ? 'cursor-pointer hover:text-[var(--ptxt)]' : 'opacity-25 cursor-default'
              }`}
              aria-label={isExpanded ? 'طي المجلد' : 'توسيع المجلد'}
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronLeft className="w-3.5 h-3.5" />
                )
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
              )}
            </button>

            {isRenaming ? (
              <div className="flex-1 flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  value={renameFolderEmoji}
                  onChange={(e) => setRenameFolderEmoji(e.target.value)}
                  className="w-7 text-center px-1 py-0.5 rounded bg-[var(--panel)] border border-[var(--pline)] text-xs"
                />
                <input
                  type="text"
                  value={renameFolderText}
                  onChange={(e) => setRenameFolderText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConfirmRenameFolder(folder.id);
                    if (e.key === 'Escape') setRenamingFolderId(null);
                  }}
                  autoFocus
                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[#00B050] text-xs text-[var(--ptxt)]"
                />
                <button
                  type="button"
                  onClick={() => void handleConfirmRenameFolder(folder.id)}
                  className="p-1 text-[#00B050] cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSelectFolder(folder.id)}
                  className="flex-1 flex items-center gap-1.5 min-w-0 text-right cursor-pointer"
                >
                  <span className="text-sm shrink-0">{folder.emoji || '📁'}</span>
                  <span className="text-xs font-bold truncate">{folder.name}</span>
                </button>

                <span className="text-[10px] font-mono-nums text-[var(--pmuted)] px-1 shrink-0">
                  {count}
                </span>

                <div className="flex items-center gap-0.5 opacity-90 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    title="إضافة مجلد فرعي داخله"
                    onClick={() => handleStartCreateFolder(folder.id)}
                    className="p-1 rounded hover:bg-[#00B050]/20 text-[#00B050] cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title="تعديل الاسم"
                    onClick={() => {
                      setRenamingFolderId(folder.id);
                      setRenameFolderText(folder.name);
                      setRenameFolderEmoji(folder.emoji || '📁');
                    }}
                    className="p-1 rounded hover:bg-[var(--surface)] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title="حذف المجلد"
                    onClick={() => setConfirmDeleteFolder(folder)}
                    className="p-1 rounded hover:bg-rose-500/15 text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </>
            )}
          </div>

          {creatingParentId === folder.id && (
            <form
              onSubmit={(e) => void handleConfirmCreateFolder(e)}
              style={{ paddingRight: `${(depth + 1) * 14 + 8}px` }}
              className="my-1 p-2 rounded-lg bg-[var(--panel)] border border-[#00B050]/50 flex flex-col gap-1.5"
            >
              <span className="text-[10px] font-bold text-[#00B050]">
                مجلد فرعي داخل «{folder.name}»
              </span>
              <div className="flex items-center gap-1">
                <select
                  value={newFolderEmoji}
                  onChange={(e) => setNewFolderEmoji(e.target.value)}
                  className="px-1 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-xs"
                >
                  {FOLDER_EMOJIS.map((em) => (
                    <option key={em} value={em}>
                      {em}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="اسم المجلد الفرعي..."
                  autoFocus
                  className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setCreatingParentId(undefined)}
                  className="px-2 py-1 rounded text-[10px] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded bg-[#00B050] text-white text-[10px] font-bold cursor-pointer"
                >
                  إنشاء
                </button>
              </div>
            </form>
          )}

          {hasChildren && isExpanded && (
            <div className="flex flex-col">{renderFolderTreeNodes(folder.id, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  if (!isOpen) return null;

  const visibleItems = filteredItems.slice(0, displayLimit);
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((it) => selectedQuestionIds.has(it.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-1.5 sm:p-4"
      dir="rtl"
    >
      <div className="w-full max-w-7xl h-[95dvh] sm:h-[92dvh] rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl flex flex-col overflow-hidden text-[var(--ptxt)]">
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 sm:px-5 py-3 border-b border-[var(--pline)] bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen((s) => !s)}
              title={isSidebarOpen ? 'إغلاق شجرة المجلدات' : 'فتح شجرة المجلدات'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold cursor-pointer shrink-0"
            >
              {isSidebarOpen ? (
                <PanelRightClose className="w-4 h-4 text-[#00B050]" />
              ) : (
                <PanelRightOpen className="w-4 h-4 text-[#00B050]" />
              )}
              <span className="hidden sm:inline">المجلدات</span>
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <Brain className="w-5 h-5 text-[#00B050] shrink-0" />
              <div className="flex flex-col min-w-0">
                <h2 className="text-sm sm:text-base font-extrabold truncate">
                  مكتبة الذاكرة الكبرى للأسئلة والمجلدات
                </h2>
                <span className="text-[11px] text-[var(--pmuted)] truncate">
                  {activeBreadcrumb} · {bankStats?.total ?? allQuestions.length} سؤال إجمالي (
                  <span className="text-[var(--gold)] font-bold">
                    {bankStats?.unused ?? 0} جديد
                  </span>{' '}
                  ·{' '}
                  <span className="text-[#00B050] font-bold">
                    {bankStats?.used ?? 0} منفّذ ✅
                  </span>
                  )
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Cloud Sync Status */}
            {cloudUser ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isCloudSyncing}
                  onClick={() => void handleCloudSync()}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050]/15 border border-[#00B050]/45 text-[#00B050] dark:text-[#6ee7b7] text-[11px] font-bold cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCloudSyncing ? 'animate-spin' : ''}`} />
                  <span className="hidden md:inline">مزامنة السحابة</span>
                </button>
                <button
                  type="button"
                  onClick={() => void signOutFirebaseUser()}
                  title="فصل المزامنة السحابية"
                  className="p-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : isAndroidNativeApp() ? (
              <button
                type="button"
                onClick={() => launchWebLinkLoginForApk(getWebLoginBaseUrl())}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[#00B050]/45 text-[#00B050] text-[11px] font-bold cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>دخول سحابي</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isCloudSyncing}
                onClick={() => void handleCloudSync()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[#00B050]/45 text-[#00B050] text-[11px] font-bold cursor-pointer"
              >
                <Cloud className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">مزامنة Firebase</span>
              </button>
            )}

            <input
              ref={importFileRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleImportVaultJson(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              title="استيراد ملف JSON للذاكرة"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-[11px] font-bold cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5 text-[#00B050]" />
              <span className="hidden md:inline">استيراد</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExportVaultBackup()}
              title="نسخة احتياطية JSON لكل المجلدات والأسئلة"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-bold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[var(--gold)]" />
              <span className="hidden md:inline">نسخة احتياطية</span>
            </button>

            <button
              type="button"
              onClick={() => void handlePickRandomUnused()}
              disabled={Boolean(workingItemId)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[11px] font-bold cursor-pointer"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>سحب عشوائي للفيديو</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق مكتبة الذاكرة"
              className="p-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Split Body */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* Collapsible Nested Folder Tree Sidebar */}
          {isSidebarOpen && (
            <aside className="w-full lg:w-72 xl:w-80 max-h-[34dvh] lg:max-h-none border-b lg:border-b-0 lg:border-l border-[var(--pline)] bg-[var(--surface)] flex flex-col min-h-0 shrink-0">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[var(--pline)] shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-extrabold">
                  <FolderTree className="w-4 h-4 text-[#00B050]" />
                  <span>أقسام ومجلدات الذاكرة</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleStartCreateFolder(null)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[10px] font-bold cursor-pointer"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>مجلد رئيسي</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                {/* Root Create Folder Inline Box */}
                {creatingParentId === null && (
                  <form
                    onSubmit={(e) => void handleConfirmCreateFolder(e)}
                    className="mb-1.5 p-2 rounded-xl bg-[var(--panel)] border border-[#00B050] flex flex-col gap-1.5"
                  >
                    <span className="text-[10px] font-bold text-[#00B050]">إنشاء مجلد رئيسي جديد</span>
                    <div className="flex items-center gap-1">
                      <select
                        value={newFolderEmoji}
                        onChange={(e) => setNewFolderEmoji(e.target.value)}
                        className="px-1 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-xs"
                      >
                        {FOLDER_EMOJIS.map((em) => (
                          <option key={em} value={em}>
                            {em}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="مثلاً: ديني، فيزياء..."
                        autoFocus
                        className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                      />
                    </div>
                    <select
                      value={newFolderCategory}
                      onChange={(e) => setNewFolderCategory(e.target.value as QuizCategory)}
                      className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)]"
                    >
                      {QUIZ_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          التصنيف الافتراضي: {c.emoji} {c.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setCreatingParentId(undefined)}
                        className="px-2 py-1 text-[10px] text-[var(--pmuted)] cursor-pointer"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded bg-[#00B050] text-white text-[10px] font-bold cursor-pointer"
                      >
                        حفظ المجلد
                      </button>
                    </div>
                  </form>
                )}

                {/* Confirm Delete Folder Inline Prompt */}
                {confirmDeleteFolder && (
                  <div className="mb-1.5 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/40 flex flex-col gap-2">
                    <span className="text-[11px] font-bold text-rose-300 leading-relaxed">
                      حذف مجلد «{confirmDeleteFolder.name}» والمجلدات الفرعية داخله؟
                    </span>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => void handleDeleteFolderConfirmed('moveToParent')}
                        className="w-full py-1.5 px-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[10px] font-bold text-[var(--ptxt)] cursor-pointer"
                      >
                        حذف المجلد مع بقاء الأسئلة (نقل للأعلى)
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteFolderConfirmed('deleteQuestions')}
                        className="w-full py-1.5 px-2 rounded-lg bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                      >
                        حذف المجلد والأسئلة التي بداخله
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFolder(null)}
                        className="w-full py-1 text-[10px] text-[var(--pmuted)] cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}

                {/* Built-in Root Views */}
                <button
                  type="button"
                  onClick={() => handleSelectFolder('all')}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-xs font-bold cursor-pointer ${
                    selectedFolderId === 'all'
                      ? 'bg-[#00B050]/16 border-[#00B050]/50 text-[#00B050] dark:text-[#6ee7b7]'
                      : 'border-transparent hover:bg-[var(--panel)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-[#00B050]" />
                    <span>كل الذاكرة</span>
                  </span>
                  <span className="text-[10px] font-mono-nums text-[var(--pmuted)]">
                    {allQuestions.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectFolder('unfiled')}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                    selectedFolderId === 'unfiled'
                      ? 'bg-[#00B050]/16 border-[#00B050]/50 text-[#00B050] dark:text-[#6ee7b7]'
                      : 'border-transparent hover:bg-[var(--panel)] text-[var(--pmuted)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Folder className="w-3.5 h-3.5" />
                    <span>أسئلة بدون مجلد</span>
                  </span>
                  <span className="text-[10px] font-mono-nums">{folderQuestionCounts.unfiledCount}</span>
                </button>

                <div className="my-1 border-t border-[var(--pline)]" />

                {/* Nested User Folders */}
                <div className="flex flex-col gap-0.5">{renderFolderTreeNodes(null, 0)}</div>
              </div>

              <label className="px-3 py-2 border-t border-[var(--pline)] flex items-center gap-2 text-[11px] font-semibold cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={includeSubfolders}
                  onChange={(e) => setIncludeSubfolders(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#00B050] rounded"
                />
                <span>عرض أسئلة المجلدات الفرعية أيضاً</span>
              </label>
            </aside>
          )}

          {/* Main Questions & Creators Column */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {/* Toolbar: Search + Filters + Creator Toggle Buttons */}
            <div className="p-3 sm:p-4 border-b border-[var(--pline)] bg-[var(--panel)] flex flex-col gap-2.5 shrink-0">
              {/* Row 1: Creator Mode Toggles + Voiceover option */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCreatorDrawer((d) => (d === 'manual' ? 'none' : 'manual'))
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                      creatorDrawer === 'manual'
                        ? 'bg-[#00B050] border-[#00B050] text-white'
                        : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[#00B050] text-[var(--ptxt)]'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة سؤال يدوياً</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreatorDrawer((d) => (d === 'bulk' ? 'none' : 'bulk'))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                      creatorDrawer === 'bulk'
                        ? 'bg-[#00B050] border-[#00B050] text-white'
                        : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[#00B050] text-[var(--ptxt)]'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>لصق دفعة أسئلة</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreatorDrawer((d) => (d === 'ai' ? 'none' : 'ai'))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                      creatorDrawer === 'ai'
                        ? 'bg-[#00B050] border-[#00B050] text-white'
                        : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[var(--gold)] text-[var(--ptxt)]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[var(--gold)]" />
                    <span>توليد دفعة ذكاء للمجلد</span>
                  </button>
                </div>

                {/* Voiceover on video convert setting */}
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer font-bold">
                    <input
                      type="checkbox"
                      checked={withVoiceOnInsert}
                      onChange={(e) => setWithVoiceOnInsert(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[#00B050]"
                    />
                    <Volume2 className="w-3.5 h-3.5 text-[#00B050]" />
                    <span>صوت تلقائي عند التحويل</span>
                  </label>
                  {withVoiceOnInsert && (
                    <>
                      <select
                        value={voiceName}
                        onChange={(e) => onVoiceChange(e.target.value as AiVoiceName)}
                        className="px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--pline)] text-[10px]"
                      >
                        {AI_VOICE_OPTIONS.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={voiceModeOnInsert}
                        onChange={(e) => setVoiceModeOnInsert(e.target.value as AiVoiceMode)}
                        className="px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--pline)] text-[10px]"
                      >
                        <option value="questionOnly">السؤال فقط</option>
                        <option value="questionAndAnswer">السؤال والحل</option>
                        <option value="full">كامل</option>
                      </select>
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: Instant Search & Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <div className="relative sm:col-span-2 lg:col-span-1">
                  <Search className="w-3.5 h-3.5 text-[var(--pmuted)] absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setDisplayLimit(40);
                    }}
                    placeholder="ابحث بالسؤال أو الجواب أو المجلد..."
                    className="w-full pr-8 pl-7 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <select
                  value={filterCategory}
                  onChange={(e) => {
                    setFilterCategory(e.target.value as QuizCategory | 'all');
                    setDisplayLimit(40);
                  }}
                  className="px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                >
                  <option value="all">كل المجالات</option>
                  {QUIZ_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </select>

                <select
                  value={filterSlideType}
                  onChange={(e) => {
                    setFilterSlideType(e.target.value as SlideType | 'all');
                    setDisplayLimit(40);
                  }}
                  className="px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                >
                  <option value="all">كل أنواع الأسئلة</option>
                  <option value="multiple">4 خيارات</option>
                  <option value="trueFalse">صح أم خطأ</option>
                  <option value="clues">3 تلميحات</option>
                  <option value="versus">مقارنة VS</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value as 'all' | 'unused' | 'used');
                    setDisplayLimit(40);
                  }}
                  className="px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                >
                  <option value="all">كل الحالات ({filteredItems.length})</option>
                  <option value="unused">جديد (غير منفّذ)</option>
                  <option value="used">تم تنفيذه ✅</option>
                </select>
              </div>
            </div>

            {/* Scrollable Workspace Content */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-3">
              {/* Notices */}
              {notice && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40 text-xs text-[#00B050] dark:text-[#6ee7b7]">
                  <span>{notice}</span>
                  <button type="button" onClick={() => setNotice('')} className="font-bold cursor-pointer">
                    ×
                  </button>
                </div>
              )}
              {errorNotice && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/40 text-xs text-rose-400">
                  <span>{errorNotice}</span>
                  <button type="button" onClick={() => setErrorNotice('')} className="font-bold cursor-pointer">
                    ×
                  </button>
                </div>
              )}

              {/* Collapsible Drawer 1: Manual Add Question */}
              {creatorDrawer === 'manual' && (
                <div className="p-3.5 rounded-2xl bg-[var(--surface)] border border-[#00B050]/45 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#00B050] dark:text-[#6ee7b7]">
                      إضافة سؤال وإجابة يدوياً للذاكرة (بدون انتظار الذكاء)
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreatorDrawer('none')}
                      className="text-xs text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      إغلاق
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={manualFolderId}
                      onChange={(e) => setManualFolderId(e.target.value)}
                      className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                    >
                      <option value="">بدون مجلد محدد</option>
                      {folderOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={manualCategory}
                      onChange={(e) => setManualCategory(e.target.value as QuizCategory)}
                      className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                    >
                      {QUIZ_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.emoji} {c.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={manualSlideType}
                      onChange={(e) => {
                        const st = e.target.value as SlideType;
                        setManualSlideType(st);
                        setManualCorrectIndex(st === 'clues' ? 3 : 0);
                      }}
                      className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                    >
                      <option value="multiple">4 خيارات</option>
                      <option value="trueFalse">صح أم خطأ</option>
                      <option value="clues">3 تلميحات + الحل</option>
                      <option value="versus">مقارنة VS</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-2">
                    <input
                      type="text"
                      value={manualQuestion}
                      onChange={(e) => {
                        setManualQuestion(e.target.value);
                        setManualDuplicatePending(false);
                      }}
                      placeholder="اكتب نص السؤال هنا..."
                      className="px-3 py-2 rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={manualBadge}
                      onChange={(e) => setManualBadge(e.target.value)}
                      placeholder="الشارة أعلى السؤال (اختياري)"
                      className="px-3 py-2 rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                    />
                  </div>

                  {manualSlideType === 'trueFalse' ? (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-bold text-[var(--pmuted)]">الإجابة الصحيحة:</span>
                      <button
                        type="button"
                        onClick={() => setManualCorrectIndex(0)}
                        className={`px-4 py-1.5 rounded-lg border font-bold cursor-pointer ${
                          manualCorrectIndex === 0
                            ? 'bg-[#00B050] border-[#00B050] text-white'
                            : 'bg-[var(--panel)] border-[var(--pline)]'
                        }`}
                      >
                        ✓ صح
                      </button>
                      <button
                        type="button"
                        onClick={() => setManualCorrectIndex(1)}
                        className={`px-4 py-1.5 rounded-lg border font-bold cursor-pointer ${
                          manualCorrectIndex === 1
                            ? 'bg-[#00B050] border-[#00B050] text-white'
                            : 'bg-[var(--panel)] border-[var(--pline)]'
                        }`}
                      >
                        ✗ خطأ
                      </button>
                    </div>
                  ) : manualSlideType === 'versus' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[0, 1].map((idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="manual-vs-correct"
                            checked={manualCorrectIndex === idx}
                            onChange={() => setManualCorrectIndex(idx as 0 | 1)}
                            className="accent-[#00B050]"
                          />
                          <input
                            type="text"
                            value={idx === 0 ? manualOpt0 : manualOpt1}
                            onChange={(e) =>
                              idx === 0 ? setManualOpt0(e.target.value) : setManualOpt1(e.target.value)
                            }
                            placeholder={idx === 0 ? 'الطرف الأول' : 'الطرف الثاني'}
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  ) : manualSlideType === 'clues' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={manualOpt0}
                        onChange={(e) => setManualOpt0(e.target.value)}
                        placeholder="التلميح الأول..."
                        className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                      />
                      <input
                        type="text"
                        value={manualOpt1}
                        onChange={(e) => setManualOpt1(e.target.value)}
                        placeholder="التلميح الثاني..."
                        className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                      />
                      <input
                        type="text"
                        value={manualOpt2}
                        onChange={(e) => setManualOpt2(e.target.value)}
                        placeholder="التلميح الثالث..."
                        className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                      />
                      <input
                        type="text"
                        value={manualOpt3}
                        onChange={(e) => setManualOpt3(e.target.value)}
                        placeholder="الجواب النهائي الصحيح..."
                        className="px-2.5 py-1.5 rounded-lg bg-[#00B050]/10 border border-[#00B050]/45 text-xs font-bold"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(
                        [
                          [manualOpt0, setManualOpt0],
                          [manualOpt1, setManualOpt1],
                          [manualOpt2, setManualOpt2],
                          [manualOpt3, setManualOpt3],
                        ] as const
                      ).map(([val, setter], idx) => (
                        <div
                          key={idx}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                            manualCorrectIndex === idx
                              ? 'bg-[#00B050]/12 border-[#00B050]/55'
                              : 'bg-[var(--panel)] border-[var(--pline)]'
                          }`}
                        >
                          <input
                            type="radio"
                            name="manual-correct"
                            checked={manualCorrectIndex === idx}
                            onChange={() => setManualCorrectIndex(idx as 0 | 1 | 2 | 3)}
                            title="تحديد كإجابة صحيحة"
                            className="accent-[#00B050] cursor-pointer"
                          />
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => setter(e.target.value)}
                            placeholder={`الخيار ${idx + 1}${manualCorrectIndex === idx ? ' (الصحيح)' : ''}`}
                            className="flex-1 bg-transparent text-xs focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={manualExplanation}
                      onChange={(e) => setManualExplanation(e.target.value)}
                      placeholder="شرح أو معلومة مختصرة تظهر عند الكشف (اختياري)..."
                      className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveManualQuestion(false)}
                      className="px-4 py-2 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
                    >
                      حفظ السؤال في الذاكرة
                    </button>
                    {manualDuplicatePending && (
                      <button
                        type="button"
                        onClick={() => void handleSaveManualQuestion(true)}
                        className="px-3 py-2 rounded-xl bg-[var(--gold)] text-black text-xs font-bold cursor-pointer"
                      >
                        حفظ رغم التشابه
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Collapsible Drawer 2: Bulk Paste Import */}
              {creatorDrawer === 'bulk' && (
                <div className="p-3.5 rounded-2xl bg-[var(--surface)] border border-[#00B050]/45 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#00B050] dark:text-[#6ee7b7]">
                      لصق قائمة أسئلة وإجابات دفعة واحدة (سطر لكل سؤال أو JSON)
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreatorDrawer('none')}
                      className="text-xs text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      إغلاق
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                    التنسيق السريع: اكتب كل سؤال في سطر مفصولاً بـ <code className="font-mono">|</code>{' '}
                    مثل: <span className="text-[var(--ptxt)]">ما أطول سورة؟ | البقرة* | آل عمران | النساء | المائدة | 286 آية</span>{' '}
                    (ضع <code className="font-mono">*</code> عند الجواب الصحيح أو رقم الخيار 1-4 في النهاية).
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={bulkFolderId}
                      onChange={(e) => setBulkFolderId(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    >
                      <option value="">بدون مجلد محدد</option>
                      {folderOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value as QuizCategory)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    >
                      {QUIZ_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.emoji} {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bulkSlideType}
                      onChange={(e) => setBulkSlideType(e.target.value as SlideType)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    >
                      <option value="multiple">4 خيارات</option>
                      <option value="trueFalse">صح أم خطأ</option>
                      <option value="clues">3 تلميحات</option>
                      <option value="versus">مقارنة VS</option>
                    </select>
                  </div>
                  <textarea
                    rows={5}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={`ما عدد أركان الإسلام؟ | خمسة* | أربعة | ثلاثة | ستة | تبدأ بالشهادتين\nأطول نهر في العالم؟ | النيل* | الأمازون | الفرات | دجلة`}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-xs leading-relaxed focus:border-[#00B050] focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-[var(--gold)]">
                      تم التعرف على {parsedBulkPreview.length} سؤال جاهز للحفظ
                    </span>
                    <button
                      type="button"
                      disabled={parsedBulkPreview.length === 0}
                      onClick={() => void handleSaveBulkQuestions()}
                      className="px-4 py-2 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-45 text-white text-xs font-bold cursor-pointer"
                    >
                      حفظ الكل في الذاكرة ({parsedBulkPreview.length})
                    </button>
                  </div>
                </div>
              )}

              {/* Collapsible Drawer 3: AI Batch Generator into Active Folder */}
              {creatorDrawer === 'ai' && (
                <div className="p-3.5 rounded-2xl bg-[var(--surface)] border border-[var(--gold)]/45 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[var(--gold)]">
                      توليد دفعة أسئلة بالذكاء وحفظها مباشرة داخل المجلد المحدد
                    </span>
                    <button
                      type="button"
                      disabled={isAiRunning}
                      onClick={() => setCreatorDrawer('none')}
                      className="text-xs text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      إغلاق
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <select
                      value={aiFolderId}
                      disabled={isAiRunning}
                      onChange={(e) => setAiFolderId(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    >
                      <option value="">بدون مجلد محدد</option>
                      {folderOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={aiCategory}
                      disabled={isAiRunning}
                      onChange={(e) => setAiCategory(e.target.value as QuizCategory)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    >
                      {QUIZ_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.emoji} {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={aiSlideType}
                      disabled={isAiRunning}
                      onChange={(e) => setAiSlideType(e.target.value as SlideType)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    >
                      <option value="multiple">4 خيارات</option>
                      <option value="trueFalse">صح أم خطأ</option>
                      <option value="clues">3 تلميحات</option>
                      <option value="versus">مقارنة VS</option>
                    </select>
                    <select
                      value={aiDifficulty}
                      disabled={isAiRunning}
                      onChange={(e) => setAiDifficulty(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    >
                      <option value="سهل">سهل</option>
                      <option value="متوسط">متوسط</option>
                      <option value="صعب">صعب</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={aiTopicHint}
                      disabled={isAiRunning}
                      onChange={(e) => setAiTopicHint(e.target.value)}
                      placeholder="توجيه اختياري للموضوع (مثلاً: أسئلة عن الصحابة أو معادلات الدرجة الأولى)..."
                      className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                    />
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                      {[10, 25, 50, 100, 200].map((n) => (
                        <button
                          key={n}
                          type="button"
                          disabled={isAiRunning}
                          onClick={() => setAiTargetCount(n)}
                          className={`px-2 py-1 rounded text-[11px] font-mono-nums font-bold cursor-pointer ${
                            aiTargetCount === n
                              ? 'bg-[#00B050] text-white'
                              : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  {!isAiRunning ? (
                    <button
                      type="button"
                      onClick={() => void handleStartAiBatchForVault()}
                      className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>بدء توليد {aiTargetCount} سؤالاً وحفظها في الذاكرة</span>
                    </button>
                  ) : (
                    <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#00B050] dark:text-[#6ee7b7]">
                          {aiProgress?.label}
                        </span>
                        <span className="font-mono-nums font-extrabold">
                          {aiProgress?.saved ?? 0} / {aiProgress?.target ?? aiTargetCount}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          aiAbortRef.current = true;
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span>إيقاف وحفظ ما تم توليده</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Bulk Selection / Move Bar */}
              {selectedQuestionIds.size > 0 && (
                <div className="sticky top-0 z-10 p-2.5 rounded-xl bg-[var(--panel)] border border-[#00B050] shadow-lg flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-[#00B050] dark:text-[#6ee7b7]">
                    محدد: {selectedQuestionIds.size} سؤال
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={bulkMoveTargetFolderId}
                      onChange={(e) => setBulkMoveTargetFolderId(e.target.value)}
                      className="px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[11px]"
                    >
                      <option value="">نقل إلى: بدون مجلد</option>
                      {folderOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          نقل إلى: {opt.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleBulkMoveSelected()}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] text-white text-[11px] font-bold cursor-pointer"
                    >
                      <FolderInput className="w-3.5 h-3.5" />
                      <span>نقل المحدد</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBulkMarkUsedSelected(true)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[11px] font-bold cursor-pointer"
                    >
                      تحديد ✅ منفّذ
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedQuestionIds(new Set())}
                      className="px-2 py-1 text-[11px] text-[var(--pmuted)] cursor-pointer"
                    >
                      إلغاء التحديد
                    </button>
                  </div>
                </div>
              )}

              {/* Selection Helper + Math Theme Option */}
              {visibleItems.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--pmuted)]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (allVisibleSelected) {
                          setSelectedQuestionIds(new Set());
                        } else {
                          setSelectedQuestionIds(new Set(visibleItems.map((i) => i.id)));
                        }
                      }}
                      className="px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] font-bold text-[var(--ptxt)] cursor-pointer"
                    >
                      {allVisibleSelected ? 'إلغاء تحديد الظاهر' : 'تحديد الظاهر للنقل'}
                    </button>
                    <span>
                      عرض {visibleItems.length} من أصل {filteredItems.length} سؤال
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoApplyMathTheme}
                      onChange={(e) => setAutoApplyMathTheme(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[#00B050]"
                    />
                    <span>تطبيق سبورة الرياضيات تلقائياً لأسئلة الرياضيات</span>
                  </label>
                </div>
              )}

              {/* Questions Grid */}
              {filteredItems.length === 0 ? (
                <div className="flex-1 min-h-[220px] flex flex-col items-center justify-center text-center gap-3 p-6 rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--pline)]">
                  <Brain className="w-10 h-10 text-[var(--pmuted)] opacity-60" />
                  <div className="flex flex-col gap-1 max-w-md">
                    <span className="text-sm font-bold text-[var(--ptxt)]">
                      لا توجد أسئلة مطابقة هنا بعد
                    </span>
                    <span className="text-xs text-[var(--pmuted)] leading-relaxed">
                      يمكنك إضافة سؤال يدوياً، أو لصق قائمة كاملة، أو توليد دفعة ذكاء لهذا المجلد في أي وقت.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCreatorDrawer('manual')}
                      className="px-3.5 py-2 rounded-xl bg-[#00B050] text-white text-xs font-bold cursor-pointer"
                    >
                      + إضافة سؤال يدوياً
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreatorDrawer('ai')}
                      className="px-3.5 py-2 rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold cursor-pointer"
                    >
                      توليد بالذكاء الاصطناعي
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                  {visibleItems.map((item) => {
                    const catMeta =
                      QUIZ_CATEGORIES.find((c) => c.id === item.category) ?? QUIZ_CATEGORIES[0];
                    const fBreadcrumb = item.folderId
                      ? buildFolderBreadcrumb(item.folderId, folders) || item.folderPath
                      : item.folderPath;
                    const isChecked = selectedQuestionIds.has(item.id);
                    const isWorking = workingItemId === item.id;
                    const isEditing = editingItemId === item.id && editDraft;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-2xl border flex flex-col gap-2 transition-colors ${
                          item.usedInVideo
                            ? 'bg-[#00B050]/10 border-[#00B050]/55'
                            : 'bg-[var(--surface)] border-[var(--pline)]'
                        }`}
                      >
                        {/* Top Metadata Row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedQuestionIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                });
                              }}
                              className="w-3.5 h-3.5 accent-[#00B050] cursor-pointer"
                            />
                            <span className="px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--pline)] font-bold">
                              {catMeta.emoji} {catMeta.label}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)]">
                              {SLIDE_TYPE_LABELS[item.slideType]}
                            </span>
                            {fBreadcrumb && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[#00B050]/30 text-[#00B050] dark:text-[#6ee7b7] truncate max-w-[180px]">
                                📂 {fBreadcrumb}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const nextUsed = !item.usedInVideo;
                              void markBankQuestionsUsed([item.id], nextUsed).then(() => {
                                if (cloudUser) {
                                  void updateCloudBankQuestionUsed(item.id, nextUsed).catch(() => {});
                                }
                                return loadAllData();
                              });
                            }}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 cursor-pointer ${
                              item.usedInVideo
                                ? 'bg-[#00B050] text-white'
                                : 'bg-[var(--panel)] text-[var(--pmuted)] border border-[var(--pline)]'
                            }`}
                          >
                            {item.usedInVideo ? (
                              <>
                                <CheckCircle2 className="w-3 h-3" />
                                <span>تم تنفيذه</span>
                              </>
                            ) : (
                              <>
                                <Circle className="w-3 h-3" />
                                <span>جديد</span>
                              </>
                            )}
                          </button>
                        </div>

                        {isEditing ? (
                          <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-[var(--panel)] border border-[#00B050]/50">
                            <input
                              type="text"
                              value={editDraft.question}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, question: e.target.value })
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs font-bold"
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                              {editDraft.options.map((opt, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                  <input
                                    type="radio"
                                    checked={editDraft.correctIndex === idx}
                                    onChange={() =>
                                      setEditDraft({
                                        ...editDraft,
                                        correctIndex: idx as 0 | 1 | 2 | 3,
                                      })
                                    }
                                    className="accent-[#00B050]"
                                  />
                                  <input
                                    type="text"
                                    value={opt}
                                    onChange={(e) => {
                                      const nextOpts = [...editDraft.options] as [
                                        string,
                                        string,
                                        string,
                                        string,
                                      ];
                                      nextOpts[idx] = e.target.value;
                                      setEditDraft({ ...editDraft, options: nextOpts });
                                    }}
                                    className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-[11px]"
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <select
                                value={editDraft.folderId}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, folderId: e.target.value })
                                }
                                className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-[11px]"
                              >
                                <option value="">بدون مجلد</option>
                                {folderOptions.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={editDraft.category}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    category: e.target.value as QuizCategory,
                                  })
                                }
                                className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-[11px]"
                              >
                                {QUIZ_CATEGORIES.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.emoji} {c.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <input
                              type="text"
                              value={editDraft.explanationText}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, explanationText: e.target.value })
                              }
                              placeholder="الشرح (اختياري)..."
                              className="px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--pline)] text-[11px]"
                            />
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItemId(null);
                                  setEditDraft(null);
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] text-[var(--pmuted)] cursor-pointer"
                              >
                                إلغاء
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleSaveEditItem()}
                                className="px-3 py-1 rounded-lg bg-[#00B050] text-white text-[11px] font-bold cursor-pointer"
                              >
                                حفظ التعديل
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs sm:text-sm font-extrabold text-[var(--ptxt)] leading-relaxed">
                              {item.question}
                            </p>

                            {/* Options Preview */}
                            <div className="grid grid-cols-2 gap-1 text-[11px]">
                              {item.options
                                .filter((o, idx) =>
                                  item.slideType === 'trueFalse' || item.slideType === 'versus'
                                    ? idx < 2
                                    : Boolean(o)
                                )
                                .map((opt, idx) => {
                                  const isCorrect =
                                    item.slideType === 'clues' ? idx === 3 : idx === item.correctIndex;
                                  return (
                                    <div
                                      key={idx}
                                      className={`px-2 py-1 rounded-lg border truncate ${
                                        isCorrect
                                          ? 'bg-[#00B050]/14 border-[#00B050]/45 text-[#00B050] dark:text-[#6ee7b7] font-bold'
                                          : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--pmuted)]'
                                      }`}
                                    >
                                      {isCorrect ? '✓ ' : ''}
                                      {opt}
                                    </div>
                                  );
                                })}
                            </div>

                            {item.explanationText && (
                              <p className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                                💡 {item.explanationText}
                              </p>
                            )}

                            <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-[var(--pline)]/60">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditItem(item)}
                                  title="تعديل أو نقل لمجلد"
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-bold cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>تعديل / نقل</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void deleteBankQuestion(item.id).then(() => {
                                      if (cloudUser) {
                                        void deleteCloudBankQuestion(item.id).catch(() => {});
                                      }
                                      return loadAllData();
                                    });
                                  }}
                                  title="حذف السؤال"
                                  className="p-1.5 rounded-lg text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={Boolean(workingItemId)}
                                  onClick={() => void handleUseQuestionInVideo(item, 'replace')}
                                  className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[10px] font-bold cursor-pointer"
                                >
                                  بدء فيديو جديد
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(workingItemId)}
                                  onClick={() => void handleUseQuestionInVideo(item, 'append')}
                                  className="flex items-center gap-1 px-3 py-1 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-[10px] font-bold cursor-pointer"
                                >
                                  {isWorking ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Play className="w-3 h-3 fill-current" />
                                  )}
                                  <span>إضافة للفيديو</span>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredItems.length > displayLimit && (
                <button
                  type="button"
                  onClick={() => setDisplayLimit((n) => n + 40)}
                  className="py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold text-[#00B050] cursor-pointer"
                >
                  عرض المزيد ({filteredItems.length - displayLimit} سؤال متبقي)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
