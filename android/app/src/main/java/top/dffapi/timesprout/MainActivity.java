package top.dffapi.timesprout;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final int OPEN_BACKUP = 101;
    private static final int SAVE_BACKUP = 102;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private String backupContent;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        webView.addJavascriptInterface(new NativeBridge(), "TimeSproutNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme()) && "/android_asset/index.html".equals(uri.getPath())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/plain");
                startActivityForResult(pick, OPEN_BACKUP);
                return true;
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 103);
        else askForExactAlarmPermission();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.evaluateJavascript("globalThis.TimeSproutSyncNativeReminders?.()", null);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 103) askForExactAlarmPermission();
    }

    private void askForExactAlarmPermission() {
        if (Build.VERSION.SDK_INT >= 31) {
            AlarmManager alarms = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (!alarms.canScheduleExactAlarms()) new AlertDialog.Builder(this)
                    .setTitle("准时提醒")
                    .setMessage("允许 TimeSprout 设置精确提醒，任务通知才能尽量准时响起。也可以稍后在系统设置中开启。")
                    .setPositiveButton("去设置", (dialog, which) -> {
                        Intent request = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                        request.setData(Uri.parse("package:" + getPackageName()));
                        try { startActivity(request); } catch (Exception ignored) { }
                    })
                    .setNegativeButton("稍后", null).show();
        }
    }

    private final class NativeBridge {
        @JavascriptInterface public boolean syncReminders(String json) { return ReminderScheduler.replace(getApplicationContext(), json); }
        @JavascriptInterface public void exportBackup(String filename, String content) {
            if (content == null || content.length() > 10000000) return;
            runOnUiThread(() -> {
                backupContent = content;
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE).setType("text/plain")
                        .putExtra(Intent.EXTRA_TITLE, filename);
                startActivityForResult(save, SAVE_BACKUP);
            });
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OPEN_BACKUP) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(resultCode == RESULT_OK && data != null ? new Uri[]{data.getData()} : null);
                fileCallback = null;
            }
        } else if (requestCode == SAVE_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && backupContent != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out != null) out.write(backupContent.getBytes(StandardCharsets.UTF_8));
                } catch (Exception error) {
                    new AlertDialog.Builder(this).setMessage("备份保存失败：" + error.getMessage()).setPositiveButton("确定", null).show();
                }
            }
            backupContent = null;
        }
    }

    @Override protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
