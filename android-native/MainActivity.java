package com.shortsquiz.studiopro;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_APP_PERMISSIONS = 1001;
    private static final int IO_BUFFER_SIZE = 65536;
    private static final long STALE_CACHE_AGE_MS = 12L * 60L * 60L * 1000L;

    private long lastBackPressAt = 0L;
    private volatile String pendingYouTubeAuthUrl = null;

    private static class PendingUpload {
        final File tempFile;
        final String fileName;
        final String mimeType;
        private BufferedOutputStream outputStream;
        private long bytesWritten = 0L;
        private boolean closed = false;

        PendingUpload(File tempFile, String fileName, String mimeType) throws IOException {
            this.tempFile = tempFile;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.outputStream = new BufferedOutputStream(
                    new FileOutputStream(tempFile, false),
                    IO_BUFFER_SIZE
            );
        }

        synchronized boolean append(byte[] bytes) {
            if (closed || outputStream == null || bytes == null) return false;
            try {
                if (bytes.length > 0) {
                    outputStream.write(bytes);
                    bytesWritten += bytes.length;
                }
                return true;
            } catch (IOException e) {
                return false;
            }
        }

        synchronized long finishWriting() throws IOException {
            if (outputStream != null) {
                try {
                    outputStream.flush();
                } finally {
                    try {
                        outputStream.close();
                    } finally {
                        outputStream = null;
                        closed = true;
                    }
                }
            } else {
                closed = true;
            }
            return bytesWritten;
        }

        synchronized void abortAndDelete() {
            closed = true;
            if (outputStream != null) {
                try {
                    outputStream.close();
                } catch (IOException ignored) {
                    // ignore
                }
                outputStream = null;
            }
            if (tempFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
            }
        }
    }

    private static class SaveResult {
        final String fileName;
        final String savedLocation;
        final String contentUri;

        SaveResult(String fileName, String savedLocation, String contentUri) {
            this.fileName = fileName;
            this.savedLocation = savedLocation;
            this.contentUri = contentUri;
        }
    }

    private final Map<String, PendingUpload> pendingUploads = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        cleanupStaleSharedCache();
        attachBridgeAndListeners();
        ensureRequiredPermissions();
        handleDeepLinkIntent(getIntent());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                            "(function(){ try { return window.__handleAndroidBack ? Boolean(window.__handleAndroidBack()) : false; } catch(e) { return false; } })()",
                            value -> {
                                if ("true".equals(value)) {
                                    return;
                                }
                                long now = System.currentTimeMillis();
                                if (now - lastBackPressAt < 2000L) {
                                    finish();
                                } else {
                                    lastBackPressAt = now;
                                    Toast.makeText(
                                            MainActivity.this,
                                            "اضغط رجوع مرة أخرى للخروج",
                                            Toast.LENGTH_SHORT
                                    ).show();
                                }
                            }
                    );
                } else {
                    finish();
                }
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        attachBridgeAndListeners();
        flushPendingYouTubeAuth();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent);
    }

    @Override
    public void onDestroy() {
        for (PendingUpload upload : pendingUploads.values()) {
            upload.abortAndDelete();
        }
        pendingUploads.clear();
        super.onDestroy();
    }

    private void cleanupStaleSharedCache() {
        try {
            File shareDir = new File(getCacheDir(), "shared");
            if (!shareDir.exists() || !shareDir.isDirectory()) return;
            File[] files = shareDir.listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - STALE_CACHE_AGE_MS;
            for (File f : files) {
                if (f.isFile() && f.lastModified() < cutoff) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        } catch (Exception ignored) {
            // ignore cache cleanup failures
        }
    }

    private void attachBridgeAndListeners() {
        if (this.bridge == null) return;
        WebView webView = this.bridge.getWebView();
        if (webView == null) return;

        webView.addJavascriptInterface(new AndroidNativeBridge(), "AndroidNativeBridge");
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(
                    String url,
                    String userAgent,
                    String contentDisposition,
                    String mimetype,
                    long contentLength
            ) {
                if (url == null || url.trim().isEmpty()) return;
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        Intent viewIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(viewIntent);
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            }
        });
    }

    private void handleDeepLinkIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (("com.shortsquiz.studiopro".equals(data.getScheme())
                || "com.shortsquiz.studio0".equals(data.getScheme()))
                && "youtube-auth".equals(data.getHost())) {
            pendingYouTubeAuthUrl = data.toString();
            flushPendingYouTubeAuth();
        }
    }

    private void flushPendingYouTubeAuth() {
        final String url = pendingYouTubeAuthUrl;
        if (url == null || this.bridge == null || this.bridge.getWebView() == null) return;
        final WebView webView = this.bridge.getWebView();
        pendingYouTubeAuthUrl = null;
        runOnUiThread(() -> {
            String jsArg = JSONObject.quote(url);
            webView.evaluateJavascript(
                    "(function(){ try { if (window.__onAndroidYouTubeAuth) { window.__onAndroidYouTubeAuth(" + jsArg + "); } } catch(e) {} })()",
                    null
            );
        });
    }

    private void ensureRequiredPermissions() {
        List<String> needed = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        // Only request legacy WRITE_EXTERNAL_STORAGE on Android 9 (API 28) and lower.
        // Android 10+ uses Scoped Storage / MediaStore with IS_PENDING without legacy permission.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
            }
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                    this,
                    needed.toArray(new String[0]),
                    REQUEST_APP_PERMISSIONS
            );
        }
    }

    private static String sanitizeFileName(String rawName) {
        String safe = (rawName == null ? "export.bin" : rawName).replaceAll("[^a-zA-Z0-9._-]", "_");
        while (safe.startsWith(".")) {
            safe = safe.substring(1);
        }
        return safe.isEmpty() ? "export.bin" : safe;
    }

    private static String sanitizeMimeType(String rawMime, String fileName) {
        String clean = rawMime == null ? "" : rawMime.trim().toLowerCase(Locale.ROOT);
        int semi = clean.indexOf(';');
        if (semi >= 0) {
            clean = clean.substring(0, semi).trim();
        }

        if (clean.isEmpty() || "application/octet-stream".equals(clean)) {
            String lowerName = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
            if (lowerName.endsWith(".mp4")) return "video/mp4";
            if (lowerName.endsWith(".webm")) return "video/webm";
            if (lowerName.endsWith(".mov")) return "video/quicktime";
            if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
            if (lowerName.endsWith(".png")) return "image/png";
            if (lowerName.endsWith(".webp")) return "image/webp";
            if (lowerName.endsWith(".json")) return "application/json";
            if (lowerName.endsWith(".wav")) return "audio/wav";
            if (lowerName.endsWith(".mp3")) return "audio/mpeg";
            return "application/octet-stream";
        }
        return clean;
    }

    private static String ensureMatchingExtension(String safeName, String safeMime) {
        String expectedExt = null;
        if ("video/mp4".equals(safeMime)) expectedExt = ".mp4";
        else if ("video/webm".equals(safeMime)) expectedExt = ".webm";
        else if ("image/jpeg".equals(safeMime)) expectedExt = ".jpg";
        else if ("image/png".equals(safeMime)) expectedExt = ".png";
        else if ("application/json".equals(safeMime)) expectedExt = ".json";

        if (expectedExt == null) return safeName;
        String lower = safeName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(expectedExt)) return safeName;
        if (".jpg".equals(expectedExt) && lower.endsWith(".jpeg")) return safeName;

        int dotIdx = safeName.lastIndexOf('.');
        String stem = dotIdx > 0 ? safeName.substring(0, dotIdx) : safeName;
        return stem + expectedExt;
    }

    private static File resolveNonCollidingFile(File dir, String fileName) {
        File candidate = new File(dir, fileName);
        if (!candidate.exists()) {
            return candidate;
        }
        int dotIdx = fileName.lastIndexOf('.');
        String stem = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;
        String ext = dotIdx > 0 ? fileName.substring(dotIdx) : "";
        for (int i = 1; i <= 500; i++) {
            File next = new File(dir, stem + "_" + i + ext);
            if (!next.exists()) {
                return next;
            }
        }
        return new File(dir, stem + "_" + System.currentTimeMillis() + ext);
    }

    private static byte[] decodeBase64Payload(String base64Data) {
        String clean = base64Data == null ? "" : base64Data;
        int commaIndex = clean.indexOf(",");
        if (commaIndex >= 0) {
            clean = clean.substring(commaIndex + 1);
        }
        return Base64.decode(clean, Base64.DEFAULT);
    }

    private String queryDisplayName(ContentResolver resolver, Uri uri, String fallback) {
        try (Cursor cursor = resolver.query(
                uri,
                new String[]{OpenableColumns.DISPLAY_NAME},
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.trim().isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // fallback to requested name
        }
        return fallback;
    }

    private Uri writePendingMediaStoreFile(
            ContentResolver resolver,
            Uri collectionUri,
            ContentValues values,
            File sourceFile
    ) throws Exception {
        Uri uri = resolver.insert(collectionUri, values);
        if (uri == null) {
            throw new IllegalStateException("MediaStore insert returned null");
        }
        try {
            try (InputStream in = new FileInputStream(sourceFile);
                 OutputStream out = resolver.openOutputStream(uri, "w")) {
                if (out == null) {
                    throw new IllegalStateException("Failed to open output stream");
                }
                byte[] buffer = new byte[IO_BUFFER_SIZE];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
                out.flush();
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues clearPending = new ContentValues();
                clearPending.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, clearPending, null, null);
            }
            return uri;
        } catch (Exception e) {
            try {
                resolver.delete(uri, null, null);
            } catch (Exception ignored) {
                // ignore cleanup failure
            }
            throw e;
        }
    }

    private SaveResult persistFileToDevice(File sourceFile, String safeName, String safeMime) throws Exception {
        if (sourceFile == null || !sourceFile.exists() || sourceFile.length() <= 0) {
            throw new IllegalStateException("ملف التصدير المؤقت فارغ أو غير موجود.");
        }

        String finalFileName = ensureMatchingExtension(safeName, safeMime);
        String savedLocation;
        String contentUriStr = null;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContentResolver();
            long fileSize = sourceFile.length();

            if (safeMime.startsWith("video/")) {
                try {
                    ContentValues videoValues = new ContentValues();
                    videoValues.put(MediaStore.Video.Media.DISPLAY_NAME, finalFileName);
                    videoValues.put(MediaStore.Video.Media.MIME_TYPE, safeMime);
                    videoValues.put(MediaStore.Video.Media.SIZE, fileSize);
                    videoValues.put(
                            MediaStore.Video.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_MOVIES + "/ShortsQuizStudio"
                    );
                    videoValues.put(MediaStore.Video.Media.IS_PENDING, 1);
                    Uri insertedUri = writePendingMediaStoreFile(
                            resolver,
                            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                            videoValues,
                            sourceFile
                    );
                    finalFileName = queryDisplayName(resolver, insertedUri, finalFileName);
                    contentUriStr = insertedUri.toString();
                    savedLocation = "Movies/ShortsQuizStudio";
                } catch (Exception videoTableErr) {
                    ContentValues dlValues = new ContentValues();
                    dlValues.put(MediaStore.Downloads.DISPLAY_NAME, finalFileName);
                    dlValues.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                    dlValues.put(MediaStore.Downloads.SIZE, fileSize);
                    dlValues.put(
                            MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/ShortsQuizStudio"
                    );
                    dlValues.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri insertedUri = writePendingMediaStoreFile(
                            resolver,
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            dlValues,
                            sourceFile
                    );
                    finalFileName = queryDisplayName(resolver, insertedUri, finalFileName);
                    contentUriStr = insertedUri.toString();
                    savedLocation = "Downloads/ShortsQuizStudio";
                }
            } else if (safeMime.startsWith("image/")) {
                try {
                    ContentValues imgValues = new ContentValues();
                    imgValues.put(MediaStore.Images.Media.DISPLAY_NAME, finalFileName);
                    imgValues.put(MediaStore.Images.Media.MIME_TYPE, safeMime);
                    imgValues.put(MediaStore.Images.Media.SIZE, fileSize);
                    imgValues.put(
                            MediaStore.Images.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_PICTURES + "/ShortsQuizStudio"
                    );
                    imgValues.put(MediaStore.Images.Media.IS_PENDING, 1);
                    Uri insertedUri = writePendingMediaStoreFile(
                            resolver,
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                            imgValues,
                            sourceFile
                    );
                    finalFileName = queryDisplayName(resolver, insertedUri, finalFileName);
                    contentUriStr = insertedUri.toString();
                    savedLocation = "Pictures/ShortsQuizStudio";
                } catch (Exception imgTableErr) {
                    ContentValues dlValues = new ContentValues();
                    dlValues.put(MediaStore.Downloads.DISPLAY_NAME, finalFileName);
                    dlValues.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                    dlValues.put(MediaStore.Downloads.SIZE, fileSize);
                    dlValues.put(
                            MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/ShortsQuizStudio"
                    );
                    dlValues.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri insertedUri = writePendingMediaStoreFile(
                            resolver,
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            dlValues,
                            sourceFile
                    );
                    finalFileName = queryDisplayName(resolver, insertedUri, finalFileName);
                    contentUriStr = insertedUri.toString();
                    savedLocation = "Downloads/ShortsQuizStudio";
                }
            } else {
                ContentValues dlValues = new ContentValues();
                dlValues.put(MediaStore.Downloads.DISPLAY_NAME, finalFileName);
                dlValues.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                dlValues.put(MediaStore.Downloads.SIZE, fileSize);
                dlValues.put(
                        MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/ShortsQuizStudio"
                );
                dlValues.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri insertedUri = writePendingMediaStoreFile(
                        resolver,
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        dlValues,
                        sourceFile
                );
                finalFileName = queryDisplayName(resolver, insertedUri, finalFileName);
                contentUriStr = insertedUri.toString();
                savedLocation = "Downloads/ShortsQuizStudio";
            }
        } else {
            String dirType = safeMime.startsWith("video/")
                    ? Environment.DIRECTORY_MOVIES
                    : safeMime.startsWith("image/")
                    ? Environment.DIRECTORY_PICTURES
                    : Environment.DIRECTORY_DOWNLOADS;

            boolean hasStoragePerm = ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED;

            File targetDir;
            if (hasStoragePerm) {
                targetDir = new File(
                        Environment.getExternalStoragePublicDirectory(dirType),
                        "ShortsQuizStudio"
                );
                savedLocation = dirType + "/ShortsQuizStudio";
            } else {
                File appDir = getExternalFilesDir(dirType);
                targetDir = new File(appDir != null ? appDir : getFilesDir(), "ShortsQuizStudio");
                savedLocation = "AppStorage/ShortsQuizStudio";
            }

            if (!targetDir.exists() && !targetDir.mkdirs()) {
                throw new IOException("تعذر إنشاء مجلد الحفظ.");
            }

            File outFile = resolveNonCollidingFile(targetDir, finalFileName);
            finalFileName = outFile.getName();
            File partFile = new File(targetDir, ".part_" + UUID.randomUUID() + "_" + finalFileName);

            try {
                try (InputStream in = new FileInputStream(sourceFile);
                     FileOutputStream fos = new FileOutputStream(partFile)) {
                    byte[] buffer = new byte[IO_BUFFER_SIZE];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        fos.write(buffer, 0, read);
                    }
                    fos.flush();
                    fos.getFD().sync();
                }
                if (!partFile.renameTo(outFile)) {
                    throw new IOException("تعذر نقل الملف المكتمل إلى وجهته النهائية.");
                }
            } catch (Exception e) {
                if (partFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    partFile.delete();
                }
                throw e;
            }

            MediaScannerConnection.scanFile(
                    MainActivity.this,
                    new String[]{outFile.getAbsolutePath()},
                    new String[]{safeMime},
                    null
            );
        }

        final String toastText = safeMime.startsWith("video/")
                ? "تم حفظ الفيديو في المعرض (" + savedLocation + "): " + finalFileName
                : "تم حفظ الملف في (" + savedLocation + "): " + finalFileName;

        runOnUiThread(() -> Toast.makeText(
                MainActivity.this,
                toastText,
                Toast.LENGTH_LONG
        ).show());

        return new SaveResult(finalFileName, savedLocation, contentUriStr);
    }

    private String toSuccessSaveJson(SaveResult res) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("ok", true);
            obj.put("fileName", res.fileName);
            obj.put("savedLocation", res.savedLocation);
            if (res.contentUri != null) {
                obj.put("contentUri", res.contentUri);
            }
            return obj.toString();
        } catch (Exception e) {
            return "{\"ok\":true,\"fileName\":\"" + res.fileName + "\"}";
        }
    }

    private String toErrorJson(Throwable t) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("ok", false);
            obj.put("error", t != null && t.getMessage() != null ? t.getMessage() : "Unknown error");
            return obj.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"Save failed\"}";
        }
    }

    private String launchShareIntent(File fileToShare, String safeMime, String extraText) {
        if (fileToShare == null || !fileToShare.exists() || fileToShare.length() <= 0) {
            return "{\"ok\":false,\"error\":\"ملف المشاركة غير جاهز أو فارغ.\"}";
        }
        Uri contentUri = FileProvider.getUriForFile(
                MainActivity.this,
                getPackageName() + ".fileprovider",
                fileToShare
        );
        runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(safeMime);
                intent.putExtra(Intent.EXTRA_STREAM, contentUri);
                if (extraText != null && !extraText.trim().isEmpty()) {
                    intent.putExtra(Intent.EXTRA_TEXT, extraText);
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(intent, "مشاركة / رفع إلى YouTube");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(chooser);
            } catch (Exception ignored) {
                Toast.makeText(
                        MainActivity.this,
                        "تعذر فتح نافذة المشاركة على الجهاز.",
                        Toast.LENGTH_SHORT
                ).show();
            }
        });
        return "{\"ok\":true}";
    }

    public class AndroidNativeBridge {
        @JavascriptInterface
        public boolean requestAudioPermission() {
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) {
                return true;
            }
            runOnUiThread(MainActivity.this::ensureRequiredPermissions);
            return false;
        }

        @JavascriptInterface
        public boolean openExternalUrl(String url) {
            if (url == null) return false;
            String trimmed = url.trim();
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
                return false;
            }
            try {
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String beginSaveFile(String fileName, String mimeType) {
            try {
                String safeName = sanitizeFileName(fileName);
                String safeMime = sanitizeMimeType(mimeType, safeName);
                safeName = ensureMatchingExtension(safeName, safeMime);
                File tempDir = new File(getCacheDir(), "shared");
                if (!tempDir.exists() && !tempDir.mkdirs()) {
                    return "";
                }
                String uploadId = UUID.randomUUID().toString();
                File tempFile = new File(tempDir, uploadId + "_" + safeName);
                if (tempFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                }
                PendingUpload upload = new PendingUpload(tempFile, safeName, safeMime);
                pendingUploads.put(uploadId, upload);
                return uploadId;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean appendSaveChunk(String uploadId, String base64Chunk) {
            if (uploadId == null) return false;
            PendingUpload upload = pendingUploads.get(uploadId);
            if (upload == null) return false;
            try {
                byte[] bytes = decodeBase64Payload(base64Chunk);
                return upload.append(bytes);
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public void abortSaveFile(String uploadId) {
            if (uploadId == null) return;
            PendingUpload upload = pendingUploads.remove(uploadId);
            if (upload != null) {
                upload.abortAndDelete();
            }
        }

        @JavascriptInterface
        public String finishSaveFile(String uploadId) {
            if (uploadId == null) {
                return "{\"ok\":false,\"error\":\"Upload session not found\"}";
            }
            PendingUpload upload = pendingUploads.remove(uploadId);
            if (upload == null) {
                return "{\"ok\":false,\"error\":\"Upload session not found\"}";
            }
            try {
                long written = upload.finishWriting();
                if (written <= 0 || !upload.tempFile.exists() || upload.tempFile.length() <= 0) {
                    return "{\"ok\":false,\"error\":\"ملف الفيديو فارغ ولم يتم حفظه.\"}";
                }
                SaveResult result = persistFileToDevice(upload.tempFile, upload.fileName, upload.mimeType);
                return toSuccessSaveJson(result);
            } catch (Throwable e) {
                return toErrorJson(e);
            } finally {
                upload.abortAndDelete();
            }
        }

        @JavascriptInterface
        public String finishShareFile(String uploadId) {
            return finishShareFileWithText(uploadId, "");
        }

        @JavascriptInterface
        public String finishShareFileWithText(String uploadId, String extraText) {
            if (uploadId == null) {
                return "{\"ok\":false,\"error\":\"Upload session not found\"}";
            }
            PendingUpload upload = pendingUploads.remove(uploadId);
            if (upload == null) {
                return "{\"ok\":false,\"error\":\"Upload session not found\"}";
            }
            try {
                long written = upload.finishWriting();
                if (written <= 0 || !upload.tempFile.exists() || upload.tempFile.length() <= 0) {
                    upload.abortAndDelete();
                    return "{\"ok\":false,\"error\":\"ملف المشاركة فارغ.\"}";
                }
                return launchShareIntent(upload.tempFile, upload.mimeType, extraText);
            } catch (Throwable e) {
                upload.abortAndDelete();
                return toErrorJson(e);
            }
        }

        @JavascriptInterface
        public String saveFile(String base64Data, String fileName, String mimeType) {
            String safeName = sanitizeFileName(fileName);
            String safeMime = sanitizeMimeType(mimeType, safeName);
            safeName = ensureMatchingExtension(safeName, safeMime);
            File tempFile = null;
            try {
                byte[] bytes = decodeBase64Payload(base64Data);
                if (bytes.length == 0) {
                    return "{\"ok\":false,\"error\":\"الملف فارغ.\"}";
                }
                File tempDir = new File(getCacheDir(), "shared");
                if (!tempDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempDir.mkdirs();
                }
                tempFile = new File(tempDir, "tmp_" + UUID.randomUUID() + "_" + safeName);
                try (FileOutputStream fos = new FileOutputStream(tempFile)) {
                    fos.write(bytes);
                    fos.flush();
                }
                SaveResult res = persistFileToDevice(tempFile, safeName, safeMime);
                return toSuccessSaveJson(res);
            } catch (Throwable e) {
                return toErrorJson(e);
            } finally {
                if (tempFile != null && tempFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                }
            }
        }

        @JavascriptInterface
        public String shareFile(String base64Data, String fileName, String mimeType) {
            String safeName = sanitizeFileName(fileName);
            String safeMime = sanitizeMimeType(mimeType, safeName);
            safeName = ensureMatchingExtension(safeName, safeMime);
            try {
                byte[] bytes = decodeBase64Payload(base64Data);
                if (bytes.length == 0) {
                    return "{\"ok\":false,\"error\":\"ملف المشاركة فارغ.\"}";
                }
                File shareDir = new File(getCacheDir(), "shared");
                if (!shareDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    shareDir.mkdirs();
                }
                File outFile = new File(shareDir, "share_" + UUID.randomUUID() + "_" + safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                    fos.flush();
                }
                return launchShareIntent(outFile, safeMime, "");
            } catch (Throwable e) {
                return toErrorJson(e);
            }
        }
    }
}
