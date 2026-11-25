package com.xiaoai.phone;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.util.Log;
import android.view.accessibility.AccessibilityManager;
import java.text.DateFormat;
import java.util.Date;
import java.util.List;

/** Small, local record of lifecycle and failures. It never reads screen or conversation contents. */
final class AccessibilityDiagnostics {
    private static final String TAG = "XiaoAiAccessibility";
    private static final String PREFS = "accessibility_diagnostics";
    private AccessibilityDiagnostics() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void created(Context context) {
        prefs(context).edit().putString("stage", "create").putInt("pid", Process.myPid())
                .putLong("stageAt", System.currentTimeMillis()).remove("firstEventAt").commit();
        Log.i(TAG, "onCreate");
    }

    static void stage(Context context, String stage) {
        prefs(context).edit().putString("stage", stage).putInt("pid", Process.myPid())
                .putLong("stageAt", System.currentTimeMillis()).commit();
        Log.i(TAG, "stage=" + stage);
    }

    static void firstEvent(Context context) {
        prefs(context).edit().putLong("firstEventAt", System.currentTimeMillis()).commit();
        Log.i(TAG, "First system accessibility event received");
    }

    static void lockStage(Context context, String phase) {
        SharedPreferences saved = prefs(context);
        if (phase.equals(saved.getString("lockStage", ""))) return;
        saved.edit().putString("lockStage",phase).putLong("lockStageAt",System.currentTimeMillis()).apply();
    }

    static void fault(Context context, String operation, Throwable error) {
        SharedPreferences saved = prefs(context);
        String detail = operation + " / " + error.getClass().getSimpleName();
        for (StackTraceElement frame : error.getStackTrace()) {
            if (frame.getClassName().startsWith("com.xiaoai.phone.")) {
                detail += " / " + frame.getFileName() + ":" + frame.getLineNumber();
                break;
            }
        }
        long now = System.currentTimeMillis();
        if (detail.equals(saved.getString("fault", "")) && now-saved.getLong("faultAt",0) < 5000) return;
        saved.edit().putString("fault", detail).putLong("faultAt", now).commit();
        Log.e(TAG, detail);
    }

    static String report(Context context, boolean webBridgeSupported, boolean pageReported) {
        SharedPreferences saved = prefs(context);
        AccessibilityManager manager = context.getSystemService(AccessibilityManager.class);
        String installed = "無法讀取", systemList = "無法讀取";
        if (manager != null) {
            try {
                ComponentName service = new ComponentName(context, PhoneService.class);
                installed = yesNo(includes(manager.getInstalledAccessibilityServiceList(), service));
                systemList = yesNo(includes(manager.getEnabledAccessibilityServiceList(
                        AccessibilityServiceInfo.FEEDBACK_ALL_MASK), service));
            } catch (RuntimeException error) {
                fault(context, "查詢系統服務清單", error);
            }
        }
        String version = "未知";
        try {
            PackageInfo pkg = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? pkg.getLongVersionCode() : pkg.versionCode;
            version = pkg.versionName + " (#" + code + ")";
        } catch (android.content.pm.PackageManager.NameNotFoundException ignored) {}

        String stage = saved.getString("stage", "");
        boolean connected = PhoneService.instance != null;
        boolean granted = connected || AccessibilityGrant.isEnabled(context);
        StringBuilder report = new StringBuilder("小愛機無障礙診斷\n")
                .append("版本：").append(version).append('\n')
                .append("系統：Android ").append(Build.VERSION.RELEASE).append(" / API ").append(Build.VERSION.SDK_INT)
                .append(" · ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
                .append("系統授權：").append(granted ? "已開啟" : "未開啟").append('\n')
                .append("系統已識別本服務：").append(installed).append('\n')
                .append("系統服務查詢列為啟用：").append(systemList).append('\n')
                .append("運行連接：").append(connected ? "已連接" : "未連接").append('\n')
                .append("最近階段：").append(stageLabel(stage)).append(" · ").append(time(saved.getLong("stageAt", 0))).append('\n')
                .append("首次收到系統事件：").append(time(saved.getLong("firstEventAt",0))).append('\n')
                .append("網頁原生橋接：").append(webBridgeSupported ? "受支持" : "不受支持")
                .append(pageReported ? "，頁面已查詢狀態" : "，本次未觀察到頁面查詢");
        report.append("\n本次進程是否為最近服務進程：").append(yesNo(saved.getInt("pid",-1)==Process.myPid()));
        try {
            PackageInfo webView=android.webkit.WebView.getCurrentWebViewPackage();
            report.append("\nWebView：").append(webView==null?"未知":webView.packageName+" "+webView.versionName);
        } catch(RuntimeException | LinkageError ignored) {}
        if ("HUAWEI".equalsIgnoreCase(Build.MANUFACTURER)) {
            android.os.PowerManager power=context.getSystemService(android.os.PowerManager.class);
            if(power!=null)report.append("\n電池優化豁免：").append(yesNo(power.isIgnoringBatteryOptimizations(context.getPackageName())));
            report.append("\n華為/鴻蒙提示：若系統已授權但服務未連接或被清理，請在設置搜尋「應用啟動管理」，找到小愛機，關閉自動管理，允許自啟動、關聯啟動、後台活動。之後返回無障礙確認服務開關。此操作不等於已連接。");
        }
        String error = saved.getString("fault", "");
        String lock = saved.getString("lockStage", "");
        if (!lock.isEmpty()) report.append("\n最近應用鎖階段：").append(lock).append(" · ").append(time(saved.getLong("lockStageAt", 0)));
        if (!error.isEmpty()) report.append("\n最近執行異常：").append(error).append(" · ").append(time(saved.getLong("faultAt", 0)));
        if (Build.VERSION.SDK_INT >= 30) appendRecentExit(context, report);
        return report.toString();
    }

    private static boolean includes(List<AccessibilityServiceInfo> list, ComponentName expected) {
        for (AccessibilityServiceInfo info : list) {
            if (expected.equals(ComponentName.unflattenFromString(info.getId()))) return true;
        }
        return false;
    }

    private static void appendRecentExit(Context context, StringBuilder report) {
        ActivityManager manager = context.getSystemService(ActivityManager.class);
        if (manager == null) return;
        try {
            for (ApplicationExitInfo exit : manager.getHistoricalProcessExitReasons(context.getPackageName(),0,8)) {
                if (!context.getApplicationInfo().processName.equals(exit.getProcessName())) continue;
                int reason = exit.getReason();
                String label;
                if (reason == ApplicationExitInfo.REASON_CRASH) label="程式崩潰";
                else if (reason == ApplicationExitInfo.REASON_CRASH_NATIVE) label="原生崩潰";
                else if (reason == ApplicationExitInfo.REASON_ANR) label="程式無回應";
                else continue;
                report.append("\n系統記錄的最近異常退出：").append(label).append(" · ").append(time(exit.getTimestamp()));
                return;
            }
        } catch (RuntimeException ignored) {}
    }

    private static String stageLabel(String stage) {
        switch (stage) {
            case "create": return "服務已建立，尚未收到連接回調";
            case "callback": return "已收到 Android 連接回調";
            case "event": return "已由 Android 窗口事件確認連接";
            case "unbind": return "Android 已解除綁定";
            case "destroy": return "服務已結束";
            case "disabled": return "用戶已關閉服務";
            default: return "尚未看到服務啟動";
        }
    }

    private static String yesNo(boolean value) { return value ? "是" : "否"; }
    private static String time(long stamp) {
        return stamp == 0 ? "無記錄" : DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.MEDIUM).format(new Date(stamp));
    }
}
