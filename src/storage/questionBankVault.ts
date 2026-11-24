import { QuestionSlide, QuizCategory, SlideType } from '../types/quiz';

export interface BankFolder {
  id: string;
  name: string;
  parentId: string | null;
  category?: QuizCategory;
  emoji?: string;
  createdAt: number;
}

export interface BankQuestionItem {
  id: string;
  category: QuizCategory;
  slideType: SlideType;
  badgeText: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanationText?: string;
  topicTag: string;
  folderId?: string;
  folderPath?: string;
  usedInVideo: boolean;
  usedAt?: number;
  createdAt: number;
  normalizedKey: string;
}

export interface CategoryBankStats {
  total: number;
  unused: number;
  used: number;
}

export interface BankStatsSummary {
  total: number;
  unused: number;
  used: number;
  byCategory: Record<QuizCategory, CategoryBankStats>;
}

const DB_NAME = 'shorts_quiz_question_bank_db';
const DB_VERSION = 2;
const STORE_NAME = 'bank_questions';
const FOLDERS_STORE_NAME = 'bank_folders';
const FOLDERS_SEEDED_KEY = 'shorts_quiz_bank_folders_seeded_v1';

const STARTER_FOLDERS: BankFolder[] = [
  { id: 'folder_islamic', name: 'ديني وإسلاميات', parentId: null, category: 'islamic', emoji: '🕌', createdAt: 1001 },
  { id: 'folder_islamic_quran', name: 'القرآن الكريم', parentId: 'folder_islamic', category: 'islamic', emoji: '📖', createdAt: 1002 },
  { id: 'folder_islamic_seerah', name: 'السيرة النبوية', parentId: 'folder_islamic', category: 'islamic', emoji: '🌙', createdAt: 1003 },
  { id: 'folder_islamic_sahaba', name: 'الصحابة والتابعون', parentId: 'folder_islamic', category: 'islamic', emoji: '⭐', createdAt: 1004 },

  { id: 'folder_math', name: 'رياضيات', parentId: null, category: 'math', emoji: '🧮', createdAt: 1005 },
  { id: 'folder_math_algebra', name: 'جبر ومعادلات', parentId: 'folder_math', category: 'math', emoji: '✖️', createdAt: 1006 },
  { id: 'folder_math_geometry', name: 'هندسة ومساحات', parentId: 'folder_math', category: 'math', emoji: '📐', createdAt: 1007 },
  { id: 'folder_math_fractions', name: 'كسور وجذور', parentId: 'folder_math', category: 'math', emoji: '➗', createdAt: 1008 },

  { id: 'folder_science', name: 'علوم وفضاء', parentId: null, category: 'science', emoji: '🔬', createdAt: 1009 },
  { id: 'folder_science_space', name: 'الفضاء والكواكب', parentId: 'folder_science', category: 'science', emoji: '🪐', createdAt: 1010 },
  { id: 'folder_science_human', name: 'جسم الإنسان', parentId: 'folder_science', category: 'science', emoji: '🧬', createdAt: 1011 },

  { id: 'folder_geography', name: 'جغرافيا', parentId: null, category: 'geography', emoji: '🌍', createdAt: 1012 },
  { id: 'folder_geography_capitals', name: 'دول وعواصم', parentId: 'folder_geography', category: 'geography', emoji: '🗺️', createdAt: 1013 },

  { id: 'folder_sports', name: 'رياضة', parentId: null, category: 'sports', emoji: '⚽', createdAt: 1014 },
  { id: 'folder_history', name: 'تاريخ وحضارات', parentId: null, category: 'history', emoji: '🏛️', createdAt: 1015 },
  { id: 'folder_discussion', name: 'نقاش وتفاعل', parentId: null, category: 'discussion', emoji: '💬', createdAt: 1016 },
  { id: 'folder_general', name: 'ثقافة عامة', parentId: null, category: 'general', emoji: '💡', createdAt: 1017 },
];

export function normalizeBankQuestionText(text: string): string {
  return (text || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isNearDuplicateQuestionText(
  candidate: string,
  existingNormalized: Set<string>
): boolean {
  const norm = normalizeBankQuestionText(candidate);
  if (!norm) return true;
  if (existingNormalized.has(norm)) return true;

  const candWords = norm.split(' ').filter((w) => w.length > 2);
  if (candWords.length < 3) return false;
  const candSet = new Set(candWords);

  for (const prev of existingNormalized) {
    const prevWords = prev.split(' ').filter((w) => w.length > 2);
    if (prevWords.length < 3) continue;
    let shared = 0;
    for (const w of candSet) {
      if (prevWords.includes(w)) shared += 1;
    }
    const ratio = shared / Math.max(candSet.size, prevWords.length);
    if (ratio >= 0.74) return true;
  }
  return false;
}

function openBankDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('normalizedKey', 'normalizedKey', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('folderId', 'folderId', { unique: false });
      } else if (req.transaction) {
        const store = req.transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains('folderId')) {
          store.createIndex('folderId', 'folderId', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(FOLDERS_STORE_NAME)) {
        const fStore = db.createObjectStore(FOLDERS_STORE_NAME, { keyPath: 'id' });
        fStore.createIndex('parentId', 'parentId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open bank DB'));
  });
}

// ==================== FOLDER TREE MANAGEMENT ====================

export async function getAllBankFolders(): Promise<BankFolder[]> {
  try {
    const db = await openBankDb();
    let rows = await new Promise<BankFolder[]>((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE_NAME, 'readonly');
      const req = tx.objectStore(FOLDERS_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as BankFolder[]) || []);
      req.onerror = () => reject(req.error ?? new Error('Failed to read folders'));
    });

    const alreadySeeded =
      typeof localStorage !== 'undefined' && localStorage.getItem(FOLDERS_SEEDED_KEY) === '1';

    if (rows.length === 0 && !alreadySeeded) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(FOLDERS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(FOLDERS_STORE_NAME);
        for (const folder of STARTER_FOLDERS) {
          store.put(folder);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to seed folders'));
      });
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(FOLDERS_SEEDED_KEY, '1');
        } catch {
          // ignore
        }
      }
      rows = [...STARTER_FOLDERS];
    }

    rows.sort((a, b) => a.createdAt - b.createdAt);
    return rows;
  } catch {
    return [];
  }
}

export async function createBankFolder(params: {
  name: string;
  parentId: string | null;
  category?: QuizCategory;
  emoji?: string;
}): Promise<BankFolder> {
  const cleanName = params.name.trim().slice(0, 80);
  if (!cleanName) {
    throw new Error('يرجى كتابة اسم المجلد.');
  }
  const folder: BankFolder = {
    id: `fld_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    parentId: params.parentId || null,
    category: params.category,
    emoji: (params.emoji || '📁').slice(0, 8),
    createdAt: Date.now(),
  };

  const db = await openBankDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, 'readwrite');
    tx.objectStore(FOLDERS_STORE_NAME).put(folder);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to create folder'));
  });

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(FOLDERS_SEEDED_KEY, '1');
    } catch {
      // ignore
    }
  }
  return folder;
}

export async function renameBankFolder(
  id: string,
  name: string,
  emoji?: string
): Promise<BankFolder | null> {
  const cleanName = name.trim().slice(0, 80);
  if (!cleanName) return null;
  const db = await openBankDb();
  let updated: BankFolder | null = null;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FOLDERS_STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const row = req.result as BankFolder | undefined;
      if (row) {
        updated = {
          ...row,
          name: cleanName,
          emoji: emoji !== undefined ? emoji : row.emoji,
        };
        store.put(updated);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to rename folder'));
  });
  return updated;
}

export function getDescendantFolderIds(rootId: string, folders: BankFolder[]): Set<string> {
  const result = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        added = true;
      }
    }
  }
  return result;
}

export function buildFolderBreadcrumb(
  folderId: string | undefined,
  folders: BankFolder[]
): string {
  if (!folderId) return '';
  const map = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let cur = map.get(folderId);
  let safety = 0;
  while (cur && safety < 12) {
    parts.unshift(cur.name);
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
    safety += 1;
  }
  return parts.join(' / ');
}

export async function deleteBankFolder(
  id: string,
  mode: 'moveToParent' | 'deleteQuestions' = 'moveToParent'
): Promise<{ deletedFolderIds: string[]; deletedQuestionIds: string[] }> {
  const folders = await getAllBankFolders();
  const target = folders.find((f) => f.id === id);
  if (!target) return { deletedFolderIds: [], deletedQuestionIds: [] };

  const toDeleteFolders = getDescendantFolderIds(id, folders);
  const deletedFolderIds = Array.from(toDeleteFolders);
  const allQuestions = await getAllBankQuestions();
  const affectedQuestions = allQuestions.filter((q) => q.folderId && toDeleteFolders.has(q.folderId));
  const deletedQuestionIds: string[] = [];

  const db = await openBankDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([FOLDERS_STORE_NAME, STORE_NAME], 'readwrite');
    const fStore = tx.objectStore(FOLDERS_STORE_NAME);
    const qStore = tx.objectStore(STORE_NAME);

    for (const fid of deletedFolderIds) {
      fStore.delete(fid);
    }

    const parentPath = target.parentId ? buildFolderBreadcrumb(target.parentId, folders) : '';
    for (const q of affectedQuestions) {
      if (mode === 'deleteQuestions') {
        qStore.delete(q.id);
        deletedQuestionIds.push(q.id);
      } else {
        qStore.put({
          ...q,
          folderId: target.parentId || undefined,
          folderPath: parentPath || undefined,
        });
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete folder'));
  });

  return { deletedFolderIds, deletedQuestionIds };
}

export async function mergeCloudFoldersIntoVault(
  cloudFolders: BankFolder[]
): Promise<{ insertedFromCloud: number; localOnlyFolders: BankFolder[] }> {
  const localAll = await getAllBankFolders();
  const localIds = new Set(localAll.map((f) => f.id));
  const cloudIds = new Set(cloudFolders.map((f) => f.id));

  const toPut: BankFolder[] = [];
  for (const cf of cloudFolders) {
    if (!localIds.has(cf.id)) {
      toPut.push(cf);
    }
  }

  if (toPut.length > 0) {
    const db = await openBankDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FOLDERS_STORE_NAME);
      for (const f of toPut) {
        store.put(f);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to merge cloud folders'));
    });
  }

  const localOnlyFolders = localAll.filter((lf) => !cloudIds.has(lf.id));
  return { insertedFromCloud: toPut.length, localOnlyFolders };
}

// ==================== QUESTIONS VAULT MANAGEMENT ====================

export async function getAllBankQuestions(): Promise<BankQuestionItem[]> {
  try {
    const db = await openBankDb();
    return await new Promise<BankQuestionItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as BankQuestionItem[]) || [];
        rows.sort((a, b) => b.createdAt - a.createdAt);
        resolve(rows);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to read bank questions'));
    });
  } catch {
    return [];
  }
}

export async function getBankQuestions(filter?: {
  category?: QuizCategory | 'all';
  slideType?: SlideType | 'all';
  status?: 'all' | 'unused' | 'used';
  folderId?: string | 'all' | 'unfiled';
  includeSubfolders?: boolean;
  search?: string;
}): Promise<BankQuestionItem[]> {
  const [all, folders] = await Promise.all([
    getAllBankQuestions(),
    filter?.folderId && filter.folderId !== 'all' && filter.folderId !== 'unfiled'
      ? getAllBankFolders()
      : Promise.resolve([] as BankFolder[]),
  ]);

  let allowedFolderIds: Set<string> | null = null;
  if (filter?.folderId && filter.folderId !== 'all' && filter.folderId !== 'unfiled') {
    allowedFolderIds =
      filter.includeSubfolders !== false
        ? getDescendantFolderIds(filter.folderId, folders)
        : new Set([filter.folderId]);
  }

  const q = (filter?.search || '').trim().toLowerCase();
  return all.filter((item) => {
    if (filter?.category && filter.category !== 'all' && item.category !== filter.category) {
      return false;
    }
    if (filter?.slideType && filter.slideType !== 'all' && item.slideType !== filter.slideType) {
      return false;
    }
    if (filter?.status === 'unused' && item.usedInVideo) return false;
    if (filter?.status === 'used' && !item.usedInVideo) return false;
    if (filter?.folderId === 'unfiled' && item.folderId) return false;
    if (allowedFolderIds && (!item.folderId || !allowedFolderIds.has(item.folderId))) {
      return false;
    }
    if (q) {
      const hay = `${item.question} ${item.topicTag} ${item.badgeText} ${item.explanationText || ''} ${item.folderPath || ''} ${item.options.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export async function getBankStats(): Promise<BankStatsSummary> {
  const all = await getAllBankQuestions();
  const byCategory: Record<QuizCategory, CategoryBankStats> = {
    general: { total: 0, unused: 0, used: 0 },
    discussion: { total: 0, unused: 0, used: 0 },
    sports: { total: 0, unused: 0, used: 0 },
    geography: { total: 0, unused: 0, used: 0 },
    science: { total: 0, unused: 0, used: 0 },
    history: { total: 0, unused: 0, used: 0 },
    islamic: { total: 0, unused: 0, used: 0 },
    technology: { total: 0, unused: 0, used: 0 },
    literature: { total: 0, unused: 0, used: 0 },
    math: { total: 0, unused: 0, used: 0 },
  };
  let used = 0;
  for (const item of all) {
    const bucket = byCategory[item.category] ?? byCategory.general;
    bucket.total += 1;
    if (item.usedInVideo) {
      bucket.used += 1;
      used += 1;
    } else {
      bucket.unused += 1;
    }
  }
  return {
    total: all.length,
    unused: all.length - used,
    used,
    byCategory,
  };
}

export async function getAvoidQuestionsForCategory(
  category: QuizCategory | 'all' = 'all',
  limit = 60
): Promise<string[]> {
  const all = await getAllBankQuestions();
  const prioritized =
    category === 'all'
      ? all
      : [
          ...all.filter((q) => q.category === category),
          ...all.filter((q) => q.category !== category),
        ];
  return prioritized.slice(0, limit).map((q) => q.question);
}

export async function addQuestionsToBank(
  slides: QuestionSlide[],
  category: QuizCategory,
  topicTag: string,
  markAsUsed = false,
  folderId?: string,
  folderPath?: string
): Promise<{
  addedItems: BankQuestionItem[];
  skippedDuplicates: number;
  totalInBank: number;
}> {
  const [existing, folders] = await Promise.all([
    getAllBankQuestions(),
    folderId && !folderPath ? getAllBankFolders() : Promise.resolve([] as BankFolder[]),
  ]);
  const resolvedFolderPath =
    folderPath || (folderId ? buildFolderBreadcrumb(folderId, folders) : '');

  const seenKeys = new Set(
    existing.map((q) => q.normalizedKey || normalizeBankQuestionText(q.question))
  );

  const now = Date.now();
  const toInsert: BankQuestionItem[] = [];
  let skippedDuplicates = 0;

  slides.forEach((slide, idx) => {
    const cleanQ = (slide.question || '').trim();
    if (!cleanQ) return;
    if (isNearDuplicateQuestionText(cleanQ, seenKeys)) {
      skippedDuplicates += 1;
      return;
    }
    const normKey = normalizeBankQuestionText(cleanQ);
    seenKeys.add(normKey);

    toInsert.push({
      id: `bank-${now}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      category: slide.category ?? category,
      slideType: slide.slideType ?? 'multiple',
      badgeText: (slide.badgeText || `السؤال ${idx + 1}`).trim(),
      question: cleanQ,
      options: [
        String(slide.options?.[0] ?? ''),
        String(slide.options?.[1] ?? ''),
        String(slide.options?.[2] ?? ''),
        String(slide.options?.[3] ?? ''),
      ],
      correctIndex: slide.correctIndex ?? 0,
      explanationText: (slide.explanationText ?? '').trim(),
      topicTag: topicTag.trim() || resolvedFolderPath || 'عام',
      folderId: folderId || undefined,
      folderPath: resolvedFolderPath || undefined,
      usedInVideo: markAsUsed,
      usedAt: markAsUsed ? now : undefined,
      createdAt: now + idx,
      normalizedKey: normKey,
    });
  });

  if (toInsert.length > 0) {
    const db = await openBankDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const item of toInsert) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to store bank items'));
    });
  }

  return {
    addedItems: toInsert,
    skippedDuplicates,
    totalInBank: existing.length + toInsert.length,
  };
}

export async function addManualQuestionToBank(input: {
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  slideType: SlideType;
  category: QuizCategory;
  explanationText?: string;
  badgeText?: string;
  topicTag?: string;
  folderId?: string;
  allowDuplicate?: boolean;
}): Promise<{ added: BankQuestionItem | null; duplicate: boolean }> {
  const slide: QuestionSlide = {
    id: `manual-${Date.now()}`,
    slideType: input.slideType,
    category: input.category,
    badgeText: input.badgeText?.trim() || 'سؤال مضاف يدوياً',
    question: input.question.trim(),
    options: input.options,
    correctIndex: input.correctIndex,
    explanationText: input.explanationText?.trim() || '',
  };

  if (input.allowDuplicate) {
    const folders = input.folderId ? await getAllBankFolders() : [];
    const folderPath = input.folderId ? buildFolderBreadcrumb(input.folderId, folders) : '';
    const now = Date.now();
    const item: BankQuestionItem = {
      id: `bank-${now}-0-${Math.random().toString(36).slice(2, 7)}`,
      category: input.category,
      slideType: input.slideType,
      badgeText: slide.badgeText,
      question: slide.question,
      options: slide.options,
      correctIndex: slide.correctIndex,
      explanationText: slide.explanationText,
      topicTag: input.topicTag?.trim() || folderPath || 'يدوي',
      folderId: input.folderId || undefined,
      folderPath: folderPath || undefined,
      usedInVideo: false,
      createdAt: now,
      normalizedKey: normalizeBankQuestionText(slide.question),
    };
    const db = await openBankDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save manual question'));
    });
    return { added: item, duplicate: false };
  }

  const res = await addQuestionsToBank(
    [slide],
    input.category,
    input.topicTag || 'يدوي',
    false,
    input.folderId
  );
  if (res.addedItems.length === 0) {
    return { added: null, duplicate: res.skippedDuplicates > 0 };
  }
  return { added: res.addedItems[0], duplicate: false };
}

export async function updateBankQuestionItem(
  id: string,
  patch: Partial<
    Pick<
      BankQuestionItem,
      | 'question'
      | 'options'
      | 'correctIndex'
      | 'explanationText'
      | 'badgeText'
      | 'category'
      | 'slideType'
      | 'topicTag'
      | 'folderId'
      | 'folderPath'
    >
  >
): Promise<BankQuestionItem | null> {
  const db = await openBankDb();
  let updated: BankQuestionItem | null = null;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const row = req.result as BankQuestionItem | undefined;
      if (row) {
        const nextQuestion =
          patch.question !== undefined ? patch.question.trim() : row.question;
        updated = {
          ...row,
          ...patch,
          question: nextQuestion,
          normalizedKey: normalizeBankQuestionText(nextQuestion) || row.normalizedKey,
        };
        store.put(updated);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to update bank question'));
  });
  return updated;
}

export async function moveBankQuestionsToFolder(
  ids: string[],
  folderId: string | undefined,
  folderPath?: string
): Promise<void> {
  if (ids.length === 0) return;
  const folders = folderId && !folderPath ? await getAllBankFolders() : [];
  const resolvedPath = folderId ? folderPath || buildFolderBreadcrumb(folderId, folders) : '';
  const idSet = new Set(ids);
  const db = await openBankDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of idSet) {
      const req = store.get(id);
      req.onsuccess = () => {
        const row = req.result as BankQuestionItem | undefined;
        if (row) {
          store.put({
            ...row,
            folderId: folderId || undefined,
            folderPath: resolvedPath || undefined,
          });
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to move bank questions'));
  });
}

export async function markBankQuestionsUsed(
  ids: string[],
  used = true
): Promise<void> {
  if (ids.length === 0) return;
  const db = await openBankDb();
  const idSet = new Set(ids);
  const now = Date.now();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of idSet) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = getReq.result as BankQuestionItem | undefined;
        if (row) {
          store.put({
            ...row,
            usedInVideo: used,
            usedAt: used ? now : undefined,
          });
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to update bank items'));
  });
}

export async function deleteBankQuestion(id: string): Promise<void> {
  const db = await openBankDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete bank question'));
  });
}

export async function clearBankQuestions(category?: QuizCategory | 'all'): Promise<void> {
  const all = await getAllBankQuestions();
  const db = await openBankDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    if (!category || category === 'all') {
      store.clear();
    } else {
      for (const row of all) {
        if (row.category === category) {
          store.delete(row.id);
        }
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to clear bank'));
  });
}

export function bankItemToQuestionSlide(item: BankQuestionItem): QuestionSlide {
  return {
    id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    slideType: item.slideType,
    category: item.category,
    badgeText: item.badgeText,
    question: item.question,
    options: [...item.options] as [string, string, string, string],
    correctIndex: item.correctIndex,
    explanationText: item.explanationText,
  };
}

export async function mergeCloudQuestionsIntoBank(
  cloudItems: BankQuestionItem[]
): Promise<{ insertedFromCloud: number; localOnlyItems: BankQuestionItem[] }> {
  const localAll = await getAllBankQuestions();
  const localById = new Map(localAll.map((item) => [item.id, item]));
  const localNormKeys = new Map(
    localAll.map((item) => [item.normalizedKey || normalizeBankQuestionText(item.question), item])
  );
  const cloudIdSet = new Set(cloudItems.map((c) => c.id));
  const cloudNormSet = new Set(
    cloudItems.map((c) => c.normalizedKey || normalizeBankQuestionText(c.question))
  );

  const toPutLocally: BankQuestionItem[] = [];
  let insertedFromCloud = 0;

  for (const cItem of cloudItems) {
    const norm = cItem.normalizedKey || normalizeBankQuestionText(cItem.question);
    const existing = localById.get(cItem.id) ?? localNormKeys.get(norm);
    if (!existing) {
      toPutLocally.push({ ...cItem, normalizedKey: norm });
      insertedFromCloud += 1;
    } else {
      const needUsedUpdate = cItem.usedInVideo && !existing.usedInVideo;
      const needFolderUpdate = Boolean(cItem.folderId && !existing.folderId);
      if (needUsedUpdate || needFolderUpdate) {
        toPutLocally.push({
          ...existing,
          usedInVideo: existing.usedInVideo || cItem.usedInVideo,
          usedAt: existing.usedAt ?? cItem.usedAt,
          folderId: existing.folderId ?? cItem.folderId,
          folderPath: existing.folderPath ?? cItem.folderPath,
        });
      }
    }
  }

  if (toPutLocally.length > 0) {
    const db = await openBankDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const item of toPutLocally) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to merge cloud bank items'));
    });
  }

  const localOnlyItems = localAll.filter((lItem) => {
    const norm = lItem.normalizedKey || normalizeBankQuestionText(lItem.question);
    return !cloudIdSet.has(lItem.id) && !cloudNormSet.has(norm);
  });

  return { insertedFromCloud, localOnlyItems };
}

export function parseManualBulkQuestionsText(
  rawText: string,
  defaultCategory: QuizCategory,
  defaultSlideType: SlideType
): QuestionSlide[] {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return [];

  // 1. Try JSON array or object first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? (((parsed as { slides?: unknown; questions?: unknown }).slides ??
              (parsed as { questions?: unknown }).questions ??
              []) as unknown[])
          : [];
      const slides: QuestionSlide[] = [];
      for (let i = 0; i < arr.length; i++) {
        const obj = arr[i] as Record<string, unknown>;
        if (!obj || typeof obj.question !== 'string' || !obj.question.trim()) continue;
        const opts = Array.isArray(obj.options) ? obj.options.map((o) => String(o ?? '')) : [];
        const st = (
          obj.slideType === 'trueFalse' ||
          obj.slideType === 'clues' ||
          obj.slideType === 'versus' ||
          obj.slideType === 'order' ||
          obj.slideType === 'fillBlank' ||
          obj.slideType === 'story'
            ? obj.slideType
            : defaultSlideType
        ) as SlideType;
        slides.push({
          id: `bulk-${Date.now()}-${i}`,
          slideType: st,
          category: (typeof obj.category === 'string' ? obj.category : defaultCategory) as QuizCategory,
          badgeText: typeof obj.badgeText === 'string' ? obj.badgeText : `سؤال ${i + 1}`,
          question: obj.question.trim(),
          options: [opts[0] || '', opts[1] || '', opts[2] || '', opts[3] || ''],
          correctIndex: Math.max(0, Math.min(3, Number(obj.correctIndex) || 0)) as 0 | 1 | 2 | 3,
          explanationText: typeof obj.explanationText === 'string' ? obj.explanationText : '',
        });
      }
      if (slides.length > 0) return slides;
    } catch {
      // fall through to line parser
    }
  }

  // 2. Line-by-line pipe/tab delimited parser:
  // Question | Option1 (or Correct) | Option2 | Option3 | Option4 | [Optional correct 1-4 or explanation]
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: QuestionSlide[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line
      .split(/\s*\|\s*|\t+/)
      .map((p) => p.trim())
      .filter((p, idx) => idx === 0 || p.length > 0);
    if (parts.length < 2) continue;

    const question = parts[0];
    if (defaultSlideType === 'trueFalse') {
      const ansWord = parts[1];
      const isFalse = /خطأ|غلط|false|no|لا|1/i.test(ansWord);
      out.push({
        id: `bulk-${Date.now()}-${i}`,
        slideType: 'trueFalse',
        category: defaultCategory,
        badgeText: `صح أم خطأ · ${i + 1}`,
        question,
        options: ['صح', 'خطأ', '', ''],
        correctIndex: isFalse ? 1 : 0,
        explanationText: parts[2] || '',
      });
      continue;
    }

    if (defaultSlideType === 'versus') {
      const o0 = parts[1] || 'الطرف الأول';
      const o1 = parts[2] || 'الطرف الثاني';
      const cIdx = parts[3] && /2|الثاني/i.test(parts[3]) ? 1 : 0;
      out.push({
        id: `bulk-${Date.now()}-${i}`,
        slideType: 'versus',
        category: defaultCategory,
        badgeText: `مقارنة VS · ${i + 1}`,
        question,
        options: [o0, o1, '', ''],
        correctIndex: cIdx,
        explanationText: parts[4] || '',
      });
      continue;
    }

    // Multiple or Clues
    let correctIndex: 0 | 1 | 2 | 3 = defaultSlideType === 'clues' ? 3 : 0;
    const opts: [string, string, string, string] = ['', '', '', ''];
    for (let k = 0; k < 4; k++) {
      let val = parts[k + 1] || '';
      if (val.startsWith('*') || val.endsWith('✓')) {
        val = val.replace(/^[\*\s]+|[\s✓]+$/g, '');
        correctIndex = k as 0 | 1 | 2 | 3;
      }
      opts[k] = val;
    }
    const maybeIndexOrNote = parts[5] || '';
    let explanation = parts[6] || '';
    if (/^[1-4]$/.test(maybeIndexOrNote)) {
      correctIndex = (Number(maybeIndexOrNote) - 1) as 0 | 1 | 2 | 3;
    } else if (maybeIndexOrNote) {
      explanation = maybeIndexOrNote;
    }

    out.push({
      id: `bulk-${Date.now()}-${i}`,
      slideType: defaultSlideType,
      category: defaultCategory,
      badgeText: `السؤال ${i + 1}`,
      question,
      options: opts,
      correctIndex,
      explanationText: explanation,
    });
  }

  return out;
}
