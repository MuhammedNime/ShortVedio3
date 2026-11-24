interface AndroidNativeBridgeApi {
  requestAudioPermission?: () => boolean;
  openExternalUrl?: (url: string) => boolean;
  beginSaveFile?: (fileName: string, mimeType: string) => string;
  appendSaveChunk?: (uploadId: string, base64Chunk: string) => boolean;
  abortSaveFile?: (uploadId: string) => void;
  finishSaveFile?: (uploadId: string) => string;
  finishShareFile?: (uploadId: string) => string;
  finishShareFileWithText?: (uploadId: string, extraText: string) => string;
  saveFile?: (base64Data: string, fileName: string, mimeType: string) => string;
  shareFile?: (base64Data: string, fileName: string, mimeType: string) => string;
}

export interface NativeTransferOptions {
  signal?: AbortSignal;
  onProgress?: (progressRatio: number) => void;
}

export interface NativeSaveResult {
  savedNatively: boolean;
  ok: boolean;
  fileName?: string;
  savedLocation?: string;
  contentUri?: string;
  error?: string;
}

function getAndroidBridge(): AndroidNativeBridgeApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AndroidNativeBridge?: AndroidNativeBridgeApi };
  return w.AndroidNativeBridge ?? null;
}

export function isAndroidNativeApp(): boolean {
  return Boolean(getAndroidBridge()?.saveFile || getAndroidBridge()?.beginSaveFile);
}

export function openExternalBrowserUrl(url: string): boolean {
  const clean = (url || '').trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  const bridge = getAndroidBridge();
  if (bridge?.openExternalUrl) {
    return Boolean(bridge.openExternalUrl(clean));
  }
  const win = window.open(clean, '_blank', 'noopener,noreferrer');
  return Boolean(win);
}

export function normalizeExportMime(mimeType?: string, fileName?: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base && base !== 'application/octet-stream') {
    return base;
  }
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'application/octet-stream';
}

export function ensureMatchingFileName(fileName: string, safeMime: string): string {
  const clean = (fileName || 'export').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'export';
  const expectedExt =
    safeMime === 'video/mp4'
      ? '.mp4'
      : safeMime === 'video/webm'
        ? '.webm'
        : safeMime === 'image/jpeg'
          ? '.jpg'
          : safeMime === 'image/png'
            ? '.png'
            : safeMime === 'application/json'
              ? '.json'
              : '';
  if (!expectedExt) return clean;
  const lower = clean.toLowerCase();
  if (lower.endsWith(expectedExt)) return clean;
  if (expectedExt === '.jpg' && lower.endsWith('.jpeg')) return clean;
  const dotIdx = clean.lastIndexOf('.');
  const stem = dotIdx > 0 ? clean.slice(0, dotIdx) : clean;
  return `${stem}${expectedExt}`;
}

export function canShareNatively(fileName: string, mimeType: string, blob: Blob): boolean {
  if (getAndroidBridge()?.shareFile || getAndroidBridge()?.finishShareFile) return true;
  const safeMime = normalizeExportMime(mimeType || blob.type, fileName);
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      const testFile = new File([blob], fileName, { type: safeMime });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  }
  return false;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const blockSize = 0x2000; // 8 KB sub-blocks avoid call-stack limits on all Android WebViews
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += blockSize) {
    const sub = bytes.subarray(i, Math.min(i + blockSize, bytes.length));
    parts.push(String.fromCharCode(...sub));
  }
  return btoa(parts.join(''));
}

async function blobSliceToBase64(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === 'function') {
    try {
      const buf = await blob.arrayBuffer();
      return uint8ToBase64(new Uint8Array(buf));
    } catch {
      // fall back to FileReader
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const marker = result.indexOf(';base64,');
      resolve(marker >= 0 ? result.slice(marker + 8) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('تعذر قراءة بيانات الملف.'));
    reader.readAsDataURL(blob);
  });
}

async function streamBlobToAndroidBridge(
  bridge: AndroidNativeBridgeApi,
  blob: Blob,
  fileName: string,
  safeMime: string,
  options?: NativeTransferOptions
): Promise<string | null> {
  if (!bridge.beginSaveFile || !bridge.appendSaveChunk) return null;
  if (options?.signal?.aborted) {
    throw new Error('تم إلغاء نقل الملف.');
  }
  if (!blob || blob.size <= 0) {
    throw new Error('ملف الفيديو فارغ ولا يمكن حفظه.');
  }

  const uploadId = bridge.beginSaveFile(fileName, safeMime);
  if (!uploadId) {
    throw new Error('تعذر تهيئة ملف الحفظ المؤقت على الجهاز.');
  }

  const CHUNK_SIZE = 256 * 1024; // 256 KB chunks keep Android WebView JNI memory flat
  try {
    let chunkCount = 0;
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      if (options?.signal?.aborted) {
        throw new Error('تم إلغاء نقل الملف.');
      }
      const end = Math.min(offset + CHUNK_SIZE, blob.size);
      const slice = blob.slice(offset, end);
      const b64 = await blobSliceToBase64(slice);
      const ok = bridge.appendSaveChunk(uploadId, b64);
      if (!ok) {
        throw new Error('تعذر كتابة جزء من الملف على ذاكرة الجهاز.');
      }
      chunkCount += 1;
      options?.onProgress?.(end / blob.size);
      if (chunkCount % 4 === 0) {
        await new Promise((r) => window.setTimeout(r, 0));
      }
    }
    return uploadId;
  } catch (err) {
    try {
      bridge.abortSaveFile?.(uploadId);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

function parseBridgeResponse(raw: string, fallbackFileName: string): {
  ok: boolean;
  fileName?: string;
  savedLocation?: string;
  contentUri?: string;
  error?: string;
} {
  try {
    const parsed = JSON.parse(raw) as {
      ok?: boolean;
      fileName?: string;
      savedLocation?: string;
      contentUri?: string;
      error?: string;
    };
    return {
      ok: Boolean(parsed.ok),
      fileName: parsed.fileName ?? fallbackFileName,
      savedLocation: parsed.savedLocation,
      contentUri: parsed.contentUri,
      error: parsed.error,
    };
  } catch {
    return {
      ok: false,
      fileName: fallbackFileName,
      error: 'استجابة غير صالحة من نظام الحفظ على الجهاز.',
    };
  }
}

export async function saveOrDownloadBlob(
  blob: Blob,
  fileName: string,
  mimeType?: string,
  options?: NativeTransferOptions
): Promise<NativeSaveResult> {
  if (!blob || blob.size <= 0) {
    return { savedNatively: false, ok: false, error: 'الملف فارغ ولا يمكن حفظه.' };
  }

  const bridge = getAndroidBridge();
  const safeMime = normalizeExportMime(mimeType || blob.type, fileName);
  const safeFileName = ensureMatchingFileName(fileName, safeMime);

  if (bridge?.beginSaveFile && bridge?.appendSaveChunk && bridge?.finishSaveFile) {
    let uploadId: string | null = null;
    try {
      uploadId = await streamBlobToAndroidBridge(bridge, blob, safeFileName, safeMime, options);
      if (uploadId) {
        if (options?.signal?.aborted) {
          bridge.abortSaveFile?.(uploadId);
          return { savedNatively: true, ok: false, error: 'تم إلغاء حفظ الملف.' };
        }
        const raw = bridge.finishSaveFile(uploadId);
        uploadId = null;
        const parsed = parseBridgeResponse(raw, safeFileName);
        return {
          savedNatively: true,
          ok: parsed.ok,
          fileName: parsed.fileName ?? safeFileName,
          savedLocation: parsed.savedLocation,
          contentUri: parsed.contentUri,
          error: parsed.error,
        };
      }
    } catch (err) {
      if (uploadId) {
        try {
          bridge.abortSaveFile?.(uploadId);
        } catch {
          // ignore
        }
      }
      return {
        savedNatively: true,
        ok: false,
        error: err instanceof Error ? err.message : 'تعذر حفظ الملف على الجهاز',
      };
    }
  }

  if (bridge?.saveFile) {
    // Guard against OOM on single-shot legacy bridge when file is very large (>15 MB)
    if (blob.size > 15 * 1024 * 1024) {
      return {
        savedNatively: true,
        ok: false,
        error: 'حجم الملف كبير جداً على جسر الحفظ القديم. يرجى تحديث نسخة التطبيق.',
      };
    }
    try {
      const base64 = await blobSliceToBase64(blob);
      const raw = bridge.saveFile(base64, safeFileName, safeMime);
      const parsed = parseBridgeResponse(raw, safeFileName);
      return {
        savedNatively: true,
        ok: parsed.ok,
        fileName: parsed.fileName ?? safeFileName,
        savedLocation: parsed.savedLocation,
        contentUri: parsed.contentUri,
        error: parsed.error,
      };
    } catch (err) {
      return {
        savedNatively: true,
        ok: false,
        error: err instanceof Error ? err.message : 'تعذر حفظ الملف على الجهاز',
      };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  options?.onProgress?.(1);
  return { savedNatively: false, ok: true, fileName: safeFileName };
}

export async function shareBlobNatively(
  blob: Blob,
  fileName: string,
  mimeType: string,
  title = 'فيديو شورتس الأسئلة',
  shareText = '',
  options?: NativeTransferOptions
): Promise<boolean> {
  if (!blob || blob.size <= 0) {
    throw new Error('الملف فارغ ولا يمكن مشاركته.');
  }
  const bridge = getAndroidBridge();
  const safeMime = normalizeExportMime(mimeType || blob.type, fileName);
  const safeFileName = ensureMatchingFileName(fileName, safeMime);

  if (
    bridge?.beginSaveFile &&
    bridge?.appendSaveChunk &&
    (bridge?.finishShareFileWithText || bridge?.finishShareFile)
  ) {
    let uploadId: string | null = null;
    try {
      uploadId = await streamBlobToAndroidBridge(bridge, blob, safeFileName, safeMime, options);
      if (uploadId) {
        if (options?.signal?.aborted) {
          bridge.abortSaveFile?.(uploadId);
          return false;
        }
        const raw = bridge.finishShareFileWithText
          ? bridge.finishShareFileWithText(uploadId, shareText)
          : bridge.finishShareFile!(uploadId);
        uploadId = null;
        const parsed = parseBridgeResponse(raw, safeFileName);
        if (!parsed.ok && parsed.error) {
          throw new Error(parsed.error);
        }
        return parsed.ok;
      }
    } catch (err) {
      if (uploadId) {
        try {
          bridge.abortSaveFile?.(uploadId);
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  if (bridge?.shareFile) {
    if (blob.size > 15 * 1024 * 1024) {
      throw new Error('حجم الملف كبير جداً على جسر المشاركة القديم.');
    }
    const base64 = await blobSliceToBase64(blob);
    const raw = bridge.shareFile(base64, safeFileName, safeMime);
    const parsed = parseBridgeResponse(raw, safeFileName);
    return parsed.ok;
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], safeFileName, { type: safeMime });
    await navigator.share({ title, text: shareText || undefined, files: [file] });
    return true;
  }
  return false;
}
