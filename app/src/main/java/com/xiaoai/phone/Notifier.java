package com.xiaoai.phone;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Tiny system-tray notifier. Deliberately framework-only (no androidx.core) and
 * never throws: the page must keep working when notifications are refused.
 */
final class Notifier {
    static final String CHANNEL_MSG = "xiaoai_message";
    static final String CHANNEL_GUARD = "xiaoai_guard";
    private static final String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    private static final int GUARD_ID = 9001;
    private static final AtomicInteger SEQ = new AtomicInteger(2000);
    private static volatile boolean channelsReady;

    private Notifier() {}

    static void ensure(Context c) {
        if (channelsReady || c == null || Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager m = c.getSystemService(NotificationManager.class);
            if (m == null) return;
            NotificationChannel msg = new NotificationChannel(CHANNEL_MSG, "小愛機訊息", NotificationManager.IMPORTANCE_DEFAULT);
            msg.setDescription("角色傳來的新訊息、還有他自己主動傳過來的話。");
            NotificationChannel guard = new NotificationChannel(CHANNEL_GUARD, "應用鎖攔截", NotificationManager.IMPORTANCE_LOW);
            guard.setDescription("被強制鎖擋下來、還有鎖時間到放行時的紀錄。");
            m.createNotificationChannel(msg);
            m.createNotificationChannel(guard);
            channelsReady = true;
        } catch (RuntimeException | LinkageError bad) {
            AccessibilityDiagnostics.fault(c, "建立通知管道", bad);
        }
    }

    static boolean granted(Context c) {
        if (c == null) return false;
        NotificationManager m = c.getSystemService(NotificationManager.class);
        if (m == null || !m.areNotificationsEnabled()) return false;
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static void requestPermission(Activity a) {
        if (a == null || Build.VERSION.SDK_INT < 33) return;
        try {
            if (a.checkSelfPermission(POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                a.requestPermissions(new String[]{POST_NOTIFICATIONS}, 73);
        } catch (RuntimeException | LinkageError bad) {
            AccessibilityDiagnostics.fault(a, "請求通知權限", bad);
        }
    }

    static JSONObject status(Context c) {
        ensure(c);
        NotificationManager m = c == null ? null : c.getSystemService(NotificationManager.class);
        boolean enabled = m != null && m.areNotificationsEnabled();
        boolean perm = Build.VERSION.SDK_INT < 33 || (c != null && c.checkSelfPermission(POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
        boolean channels = false;
        if (m != null && Build.VERSION.SDK_INT >= 26) {
            try { channels = !m.getNotificationChannels().isEmpty(); } catch (RuntimeException ignored) {}
        }
        return PhoneService.json("ok", true, "enabled", enabled, "permission", perm,
                "granted", enabled && perm, "channels", channels, "why", enabled && perm ? "通知可用" : "通知被擋著");
    }

    /** Returns "" on success, otherwise a short machine-readable reason. */
    static String post(Context c, String channel, String title, String body) {
        ensure(c);
        if (c == null) return "no_context";
        if (!granted(c)) return "no_perm";
        NotificationManager m = c.getSystemService(NotificationManager.class);
        if (m == null) return "no_manager";
        try {
            String head = title == null || title.trim().isEmpty() ? "小愛機" : trim(title, 24);
            String text = body == null ? "" : trim(body, 200);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(c, CHANNEL_GUARD.equals(channel) ? CHANNEL_GUARD : CHANNEL_MSG)
                    : new Notification.Builder(c);
            Intent open = new Intent(c, MainActivity.class)
                    .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent tap = PendingIntent.getActivity(c, 0, open, flags);
            b.setSmallIcon(android.R.drawable.stat_notify_chat)
                    .setContentTitle(head)
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle(b).bigText(text))
                    .setContentIntent(tap)
                    .setAutoCancel(true)
                    .setWhen(System.currentTimeMillis());
            int id = CHANNEL_GUARD.equals(channel) ? GUARD_ID : (Math.abs(SEQ.incrementAndGet()) % 5000 + 1000);
            m.notify(id, b.build());
            return "";
        } catch (RuntimeException | LinkageError bad) {
            AccessibilityDiagnostics.fault(c, "發系統通知", bad);
            return "fault";
        }
    }

    static void clear(Context c) {
        try {
            NotificationManager m = c == null ? null : c.getSystemService(NotificationManager.class);
            if (m != null) m.cancelAll();
        } catch (RuntimeException ignored) {}
    }

    private static String trim(String s, int max) {
        String v = s.trim();
        return v.length() <= max ? v : v.substring(0, max) + "…";
    }
}
