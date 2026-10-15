package com.dontrack.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;

/**
 * DonTrack — hote natif de l'interface web.
 *
 * L'application est une WebView plein ecran ; tout ce que le web ne sait pas
 * faire seul (fichier de donnees, impression PDF, export vers Telechargements,
 * selection d'un fichier a importer) passe par le pont ci-dessous.
 */
public class MainActivity extends Activity {

    private static final String DATA_FILE = "dontrack-data.json";
    private static final int REQ_IMPORT = 4101;

    private WebView web;
    private WebView printView;              // conserve pendant toute l'impression
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        web.setBackgroundColor(Color.parseColor("#0D111B"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    /** Le bouton retour ferme d'abord la couche affichee par l'interface web. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.DTApp && window.DTApp.back()) === true",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) finish();
                    }
                });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_IMPORT) return;

        String text = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            text = readUri(data.getData());
        }
        final String payload = text;
        ui.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(
                        "window.DTPlatform._onImport(" + (payload == null ? "null" : jsonString(payload)) + ")",
                        null);
            }
        });
    }

    /* ------------------------------------------------------------- outils */

    private String readUri(Uri uri) {
        InputStream in = null;
        try {
            in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            Reader r = new InputStreamReader(in, "UTF-8");
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            return sb.toString();
        } catch (Exception e) {
            return null;
        } finally {
            closeQuietly(in);
        }
    }

    private static void closeQuietly(java.io.Closeable c) {
        if (c != null) {
            try { c.close(); } catch (IOException ignored) { }
        }
    }

    /** Encode une chaine en litteral JavaScript sur, accents compris. */
    private static String jsonString(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 32);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20 || c > 0x7e) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    private void toastUi(final String msg) {
        ui.post(new Runnable() {
            @Override
            public void run() { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show(); }
        });
    }

    /* ------------------------------------------------------------- pont JS */

    private class Bridge {

        /** Contenu brut du fichier de donnees, ou null au tout premier lancement. */
        @JavascriptInterface
        public String load() {
            File f = new File(getFilesDir(), DATA_FILE);
            if (!f.exists()) return null;
            InputStream in = null;
            try {
                in = new java.io.FileInputStream(f);
                Reader r = new InputStreamReader(in, "UTF-8");
                StringBuilder sb = new StringBuilder();
                char[] buf = new char[8192];
                int n;
                while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
                return sb.toString();
            } catch (Exception e) {
                return null;
            } finally {
                closeQuietly(in);
            }
        }

        /** Ecriture atomique : fichier temporaire puis renommage. */
        @JavascriptInterface
        public void save(String json) {
            File dir = getFilesDir();
            File tmp = new File(dir, DATA_FILE + ".tmp");
            File dst = new File(dir, DATA_FILE);
            FileOutputStream out = null;
            try {
                out = new FileOutputStream(tmp);
                out.write(json.getBytes("UTF-8"));
                out.flush();
                out.getFD().sync();
                out.close();
                out = null;
                if (dst.exists() && !dst.delete()) throw new IOException("suppression impossible");
                if (!tmp.renameTo(dst)) throw new IOException("renommage impossible");
            } catch (Exception e) {
                toastUi("Enregistrement impossible : " + e.getMessage());
            } finally {
                closeQuietly(out);
            }
        }

        /**
         * Envoie le rapport vers le service d'impression Android. La destination
         * « Enregistrer au format PDF » produit le fichier demande par l'utilisateur.
         */
        @JavascriptInterface
        public void printHtml(final String html, final String jobName) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    final WebView w = new WebView(MainActivity.this);
                    w.getSettings().setJavaScriptEnabled(false);
                    w.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView view, String url) {
                            try {
                                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                                PrintAttributes attrs = new PrintAttributes.Builder()
                                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                        .build();
                                pm.print(jobName, adapter, attrs);
                            } catch (Exception e) {
                                toastUi("Impression indisponible : " + e.getMessage());
                            }
                        }
                    });
                    printView = w;    // sans cette reference la WebView serait recyclee
                    w.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                }
            });
        }

        /**
         * Depose un fichier texte dans Telechargements (Android 10+) ou, sur les
         * versions anterieures, dans le dossier de l'application — sans permission
         * dans les deux cas. Renvoie le chemin affichable, ou "" en cas d'echec.
         */
        @JavascriptInterface
        public String exportFile(String name, String mime, String content) {
            try {
                byte[] bytes = content.getBytes("UTF-8");

                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return "";
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return "";
                    os.write(bytes);
                    os.flush();
                    os.close();
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, cv, null, null);
                    return "Téléchargements/" + name;
                }

                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = getFilesDir();
                if (!dir.exists() && !dir.mkdirs()) return "";
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(bytes);
                fos.flush();
                fos.close();
                return out.getAbsolutePath();
            } catch (Exception e) {
                toastUi("Export impossible : " + e.getMessage());
                return "";
            }
        }

        /** Ouvre le selecteur de documents ; la reponse revient par onActivityResult. */
        @JavascriptInterface
        public void pickImport() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        i.setType("*/*");
                        startActivityForResult(i, REQ_IMPORT);
                    } catch (Exception e) {
                        toastUi("Selecteur de fichiers indisponible.");
                    }
                }
            });
        }

        @JavascriptInterface
        public void toast(String msg) { toastUi(msg); }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "1.0.0";
            }
        }

        @JavascriptInterface
        public String storageLabel() {
            return new File(getFilesDir(), DATA_FILE).getAbsolutePath();
        }

        /** Aligne les barres systeme sur le theme choisi dans l'application. */
        @JavascriptInterface
        public void setThemeColor(final String hex, final boolean light) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        int color = Color.parseColor(hex);
                        Window w = getWindow();
                        w.setStatusBarColor(color);
                        w.setNavigationBarColor(color);
                        View decor = w.getDecorView();
                        int flags = decor.getSystemUiVisibility();
                        if (light) {
                            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        } else {
                            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                            if (Build.VERSION.SDK_INT >= 26) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        }
                        decor.setSystemUiVisibility(flags);
                        web.setBackgroundColor(color);
                    } catch (Exception ignored) { }
                }
            });
        }
    }
}
