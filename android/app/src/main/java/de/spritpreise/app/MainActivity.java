package de.spritpreise.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Zeigt die Spritpreise-PWA in einer WebView. Die Dateien liegen als Assets in der APK und werden
 * unter https://appassets.androidplatform.net/ ausgeliefert, damit Standort, localStorage und
 * Abrufe an Tankerkönig wie im Browser funktionieren (sicherer Ursprung).
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final String LEAFLET = "/ajax/libs/leaflet/1.9.4/";
    private static final int REQ_LOCATION = 1, REQ_OPEN = 2, REQ_SAVE = 3, REQ_NOTIFY = 4;

    private WebView web;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xff14181c);
        // Die WebView zeichnet unabhängig von ihrem eigenen Padding bis an den Rand,
        // daher rückt ein Container sie um die Systemleisten (und die Tastatur) ein
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff14181c);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, in) -> {
                Insets i = in.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                // Verbraucht, damit die WebView die Ränder nicht zusätzlich als safe-area anwendet
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(), "Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return serve(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLocation()) {
                    cb.invoke(origin, true, false);
                    return;
                }
                geoOrigin = origin;
                geoCallback = cb;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_OPEN);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Kein Service Worker in der App: Die Dateien kommen ohnehin aus der APK
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest req) {
                return HOST.equals(req.getUrl().getHost()) ? notFound() : null;
            }
        });

        if (state == null || web.restoreState(state) == null) web.loadUrl(START);
    }

    /** Liefert App-Dateien und das mitgelieferte Leaflet aus den Assets; alles andere geht ins Netz. */
    private WebResourceResponse serve(Uri u) {
        String host = u.getHost(), path = u.getPath(), asset = null;
        if (HOST.equals(host)) {
            if (path == null || path.equals("/")) path = "/index.html";
            if (path.equals("/sw.js") || path.contains("..")) return notFound();
            asset = "www" + path;
        } else if ("cdnjs.cloudflare.com".equals(host) && path != null && path.startsWith(LEAFLET)) {
            if (path.endsWith("/leaflet.min.js")) asset = "vendor/leaflet.js";
            else if (path.endsWith("/leaflet.min.css")) asset = "vendor/leaflet.css";
        }
        if (asset == null) return null;
        try {
            InputStream in = getAssets().open(asset);
            return new WebResourceResponse(mime(asset), "UTF-8", in);
        } catch (IOException e) {
            // Fehlt Leaflet in der APK, wird es aus dem Netz geladen
            return HOST.equals(host) ? notFound() : null;
        }
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                new ByteArrayInputStream(new byte[0]));
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Keine passende App gefunden", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);
            geoCallback = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_OPEN) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        } else if (code == REQ_SAVE) {
            String content = pendingSave;
            pendingSave = null;
            if (result != RESULT_OK || data == null || data.getData() == null || content == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Gespeichert", Toast.LENGTH_SHORT).show();
            } catch (IOException | NullPointerException e) {
                Toast.makeText(this, "Speichern fehlgeschlagen", Toast.LENGTH_SHORT).show();
            }
        }
    }

    /** Zurück-Taste: erst Dialoge, Popups und Ansichten der App schließen, dann die App verlassen. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack?appBack():false", v -> {
            if (!"true".equals(v)) super.onBackPressed();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Für die Web-App: Teilen, Speichern, App-Version sowie Abgleich mit Widget und Preisalarm. */
    private class Bridge {
        @JavascriptInterface
        public void syncConfig(String json) {
            try {
                Prices.setConfig(MainActivity.this, json);
            } catch (org.json.JSONException e) {
                // Ungültige Konfiguration ignorieren, die alte bleibt aktiv
            }
        }

        @JavascriptInterface
        public String prices() {
            return Prices.json(MainActivity.this, Prices.PRICES).toString();
        }

        @JavascriptInterface
        public void requestNotify() {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY));
            }
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                return "";
            }
        }

        @JavascriptInterface
        public void share(String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, null));
            });
        }

        @JavascriptInterface
        public void saveFile(String name, String content) {
            runOnUiThread(() -> {
                pendingSave = content;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json")
                        .putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(i, REQ_SAVE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, "Speichern nicht möglich", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
