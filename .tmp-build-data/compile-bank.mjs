import fs from 'node:fs';
import path from 'node:path';
import { QURAN_QUESTIONS } from './quran.mjs';
import { SEERAH_QUESTIONS } from './seerah.mjs';
import { SAHABA_QUESTIONS } from './sahaba.mjs';
import { PROPHETS_QUESTIONS } from './prophets.mjs';
import { FIQH_QUESTIONS } from './fiqh.mjs';
import { HISTORY_QUESTIONS } from './history.mjs';
import { AKHLAQ_QUESTIONS } from './akhlaq.mjs';
import { EXTRA_BY_FOLDER } from './extra.mjs';

function normalizeText(text) {
  return String(text || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isNearDuplicate(candidate, seenSet) {
  const norm = normalizeText(candidate);
  if (!norm) return true;
  if (seenSet.has(norm)) return true;
  const candWords = norm.split(' ').filter((w) => w.length > 2);
  if (candWords.length < 3) return false;
  const candSet = new Set(candWords);
  for (const prev of seenSet) {
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

const GROUPS = [
  { folderId: 'folder_islamic_quran', folderPath: 'ديني وإسلاميات / القرآن الكريم', label: 'القرآن الكريم', rows: [...QURAN_QUESTIONS, ...(EXTRA_BY_FOLDER.folder_islamic_quran || [])] },
  { folderId: 'folder_islamic_seerah', folderPath: 'ديني وإسلاميات / السيرة النبوية', label: 'السيرة النبوية', rows: [...SEERAH_QUESTIONS, ...(EXTRA_BY_FOLDER.folder_islamic_seerah || [])] },
  { folderId: 'folder_islamic_sahaba', folderPath: 'ديني وإسلاميات / الصحابة والتابعون', label: 'الصحابة والتابعون', rows: [...SAHABA_QUESTIONS, ...(EXTRA_BY_FOLDER.folder_islamic_sahaba || [])] },
  { folderId: 'folder_islamic_prophets', folderPath: 'ديني وإسلاميات / الأنبياء والرسل', label: 'الأنبياء والرسل', rows: [...PROPHETS_QUESTIONS, ...(EXTRA_BY_FOLDER.folder_islamic_prophets || [])] },
  { folderId: 'folder_islamic_fiqh', folderPath: 'ديني وإسلاميات / الفقه والعبادات', label: 'الفقه والعبادات', rows: [...FIQH_QUESTIONS, ...(EXTRA_BY_FOLDER.folder_islamic_fiqh || [])] },
  { folderId: 'folder_islamic_history', folderPath: 'ديني وإسلاميات / الغزوات والتاريخ الإسلامي', label: 'الغزوات والتاريخ الإسلامي', rows: [...HISTORY_QUESTIONS, ...(EXTRA_BY_FOLDER.folder_islamic_history || [])] },
  { folderId: 'folder_islamic_akhlaq', folderPath: 'ديني وإسلاميات / الأحاديث والأذكار والأخلاق', label: 'الأحاديث والأذكار والأخلاق', rows: [...AKHLAQ_QUESTIONS, ...(EXTRA_BY_FOLDER.folder_islamic_akhlaq || [])] },
];

const seen = new Set();
const allItems = [];
const counts = {};
let skippedDup = 0;
let invalidCount = 0;

for (const grp of GROUPS) {
  counts[grp.folderId] = { raw: grp.rows.length, kept: 0, dup: 0, invalid: 0 };
  for (const row of grp.rows) {
    const [slideType, question, options, correctIndex, explanation, badge] = row;
    const cleanQ = String(question || '').trim();
    if (
      !cleanQ ||
      !['multiple', 'trueFalse', 'clues'].includes(slideType) ||
      !Array.isArray(options) ||
      options.length !== 4 ||
      typeof correctIndex !== 'number' ||
      correctIndex < 0 ||
      correctIndex > 3
    ) {
      invalidCount++;
      counts[grp.folderId].invalid++;
      continue;
    }
    if (slideType === 'multiple' && options.some((o) => !String(o || '').trim())) {
      invalidCount++;
      counts[grp.folderId].invalid++;
      continue;
    }
    if (slideType === 'clues' && (correctIndex !== 3 || options.some((o) => !String(o || '').trim()))) {
      invalidCount++;
      counts[grp.folderId].invalid++;
      continue;
    }
    if (isNearDuplicate(cleanQ, seen)) {
      skippedDup++;
      counts[grp.folderId].dup++;
      continue;
    }
    const normKey = normalizeText(cleanQ);
    seen.add(normKey);

    const idx = allItems.length + 1;
    allItems.push({
      id: `islamic_1000_${String(idx).padStart(4, '0')}`,
      category: 'islamic',
      slideType,
      badgeText: String(badge || grp.label).trim().slice(0, 120),
      question: cleanQ.slice(0, 600),
      options: [
        String(options[0] ?? '').trim().slice(0, 200),
        String(options[1] ?? '').trim().slice(0, 200),
        String(options[2] ?? '').trim().slice(0, 200),
        String(options[3] ?? '').trim().slice(0, 200),
      ],
      correctIndex,
      explanationText: String(explanation || '').trim().slice(0, 400),
      topicTag: grp.label.slice(0, 160),
      folderId: grp.folderId,
      folderPath: grp.folderPath.slice(0, 300),
      usedInVideo: false,
      createdAt: 1700000000000 + idx,
      normalizedKey: normKey.slice(0, 600),
    });
    counts[grp.folderId].kept++;
  }
}

console.log('Folder summary:', JSON.stringify(counts, null, 2));
console.log({ totalRaw: GROUPS.reduce((a, g) => a + g.rows.length, 0), uniqueKept: allItems.length, skippedDup, invalidCount });

if (allItems.length >= 1000) {
  const finalItems = allItems.slice(0, 1000).map((it, i) => ({
    ...it,
    id: `islamic_1000_${String(i + 1).padStart(4, '0')}`,
    createdAt: 1700000000000 + i + 1,
  }));
  const outPath = path.resolve(process.cwd(), 'public/data/islamic-bank-1000.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(finalItems));
  console.log(`SUCCESS: Wrote exact ${finalItems.length} unique Islamic questions to ${outPath} (${fs.statSync(outPath).size} bytes)`);
} else {
  console.log(`SHORTFALL: Need ${1000 - allItems.length} more unique questions to reach 1000!`);
  process.exitCode = 1;
}
