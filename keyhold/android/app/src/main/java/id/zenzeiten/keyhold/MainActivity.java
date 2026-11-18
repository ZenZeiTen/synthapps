package id.zenzeiten.keyhold;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PersistableBundle;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Keyhold on Android: one WebView showing the web app packed in the APK's assets.
 *
 * The files are served under https://appassets.androidplatform.net, so the page is a
 * secure context (Web Crypto works) with its own IndexedDB, where the encrypted vault
 * is kept. The page answers /api/mode with "device", which is the web app's mode for a
 * vault that lives on this device. All encryption happens in the page, as everywhere.
 *
 * What the app adds to the browser version:
 *  - copied passwords are marked sensitive, and the clipboard is cleared only if it
 *    still holds what Keyhold put there;
 *  - files are saved and opened with the system's file picker;
 *  - links open in the phone's browser; the WebView never leaves the app's own pages;
 *  - screenshots and the recent-apps preview are blocked (FLAG_SECURE);
 *  - the back button closes dialogs and steps back before leaving the app.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    static final String CLIP_LABEL = "Keyhold";

    // The same rules the desktop program sends (internal/api/common.go), plus the
    // breach-check service and any HTTPS sync server.
    static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            + "font-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'self' https:; "
            + "form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

    private static final int PICK_FILE = 1;
    private static final int SAVE_FILE = 2;

    private WebView web;
    private ValueCallback<Uri[]> pendingPick;
    private byte[] pendingSave;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        FrameLayout frame = new FrameLayout(this);
        web = new WebView(this);
        frame.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(frame);
        // From Android 15 apps draw behind the status and navigation bars and the keyboard
        // no longer resizes the window: keep the page clear of all three.
        if (Build.VERSION.SDK_INT >= 35) {
            frame.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);

        web.addJavascriptInterface(new Bridge(), "KeyholdAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::goBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        web.loadUrl(ORIGIN + "/");
    }

    // ---------- the app's own pages ----------

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!isOwn(u)) {
                // Other pages are never shown inside the app; fetches (sync server, breach check) pass.
                return req.isForMainFrame() ? text(403, "Forbidden", "text/plain", "") : null;
            }
            String path = u.getPath() == null ? "/" : u.getPath();
            if (path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.equals("/api/mode")) {
                return text(200, "OK", "application/json",
                        "{\"mode\":\"device\",\"platform\":\"android\",\"version\":\"" + versionName() + "\"}");
            }
            if (path.contains("..") || path.contains("//")) return text(404, "Not Found", "text/plain", "");
            String asset = path.substring(1);
            try {
                InputStream in = getAssets().open(asset);
                String type = mimeType(asset);
                return new WebResourceResponse(type, type.startsWith("image/png") ? null : "utf-8", 200, "OK", headers(), in);
            } catch (IOException e) {
                return text(404, "Not Found", "text/plain", "");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            if (isOwn(req.getUrl())) return false;
            openExternal(req.getUrl());
            return true;
        }
    }

    static boolean isOwn(Uri u) {
        return "https".equals(u.getScheme()) && HOST.equals(u.getHost()) && u.getPort() == -1;
    }

    private static Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        h.put("Content-Security-Policy", CSP);
        h.put("X-Content-Type-Options", "nosniff");
        h.put("Referrer-Policy", "no-referrer");
        h.put("Cache-Control", "no-cache");
        return h;
    }

    private static WebResourceResponse text(int status, String reason, String type, String body) {
        return new WebResourceResponse(type, "utf-8", status, reason, headers(),
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    static String mimeType(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".webmanifest")) return "application/manifest+json";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    private void openExternal(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http") && !scheme.equals("mailto")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    // ---------- opening files (import, merge, open a backup) ----------

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingPick != null) pendingPick.onReceiveValue(null);
            pendingPick = callback;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try {
                startActivityForResult(i, PICK_FILE);
            } catch (ActivityNotFoundException e) {
                pendingPick = null;
                callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this, R.string.no_file_app, Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == PICK_FILE) {
            if (pendingPick != null) pendingPick.onReceiveValue(uri == null ? null : new Uri[] {uri});
            pendingPick = null;
        } else if (requestCode == SAVE_FILE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (uri == null || bytes == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IOException("no stream");
                out.write(bytes);
                Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
            } catch (IOException | SecurityException e) {
                Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show();
            }
        }
    }

    // ---------- what the page can ask of the app ----------

    /**
     * Called from the page as window.KeyholdAndroid. The WebView only ever shows this
     * app's own pages (see Client), so only Keyhold's code can reach it.
     */
    private final class Bridge {
        /** Ask where to save a file (encrypted backup, export), then write it. */
        @JavascriptInterface
        public void saveFile(String name, String type, String content) {
            runOnUiThread(() -> {
                pendingSave = content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(type == null || type.isEmpty() ? "application/octet-stream" : type)
                        .putExtra(Intent.EXTRA_TITLE, name == null ? "keyhold" : name);
                try {
                    startActivityForResult(i, SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_app, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url != null) runOnUiThread(() -> openExternal(Uri.parse(url)));
        }

        /** Copy, marked sensitive so keyboards and the system's clipboard preview hide it. */
        @JavascriptInterface
        public void copy(String text) {
            runOnUiThread(() -> {
                ClipData clip = ClipData.newPlainText(CLIP_LABEL, text == null ? "" : text);
                PersistableBundle extras = new PersistableBundle();
                extras.putBoolean(Build.VERSION.SDK_INT >= 33 ? ClipDescription.EXTRA_IS_SENSITIVE : "android.content.extra.IS_SENSITIVE", true);
                clip.getDescription().setExtras(extras);
                clipboard().setPrimaryClip(clip);
            });
        }

        /**
         * "cleared", "other" (the clipboard holds something else now: left alone), or
         * "later" (Android lets only the app in front see the clipboard; try again on return).
         */
        @JavascriptInterface
        public String clearClipboard() {
            if (!hasWindowFocus()) return "later";
            ClipboardManager cm = clipboard();
            ClipDescription d = cm.getPrimaryClipDescription();
            if (d == null || !CLIP_LABEL.contentEquals(d.getLabel() == null ? "" : d.getLabel())) return "other";
            cm.clearPrimaryClip();
            return "cleared";
        }
    }

    private ClipboardManager clipboard() {
        return (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
    }

    // ---------- lifecycle and the back button ----------

    private void goBack() {
        web.evaluateJavascript("window.keyholdBack ? String(window.keyholdBack()) : 'false'", value -> {
            if (!"\"true\"".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack(); // Android 12 and older; newer versions use backCallback.
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Back in front: a clipboard clear that had to wait can happen now.
        if (hasFocus && web != null) web.evaluateJavascript("window.keyholdResume && window.keyholdResume()", null);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        web.destroy();
        super.onDestroy();
    }
}
