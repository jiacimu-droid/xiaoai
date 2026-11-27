package com.xiaoai.phone;

import android.accessibilityservice.AccessibilityService;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.DateFormat;
import java.util.Date;
import java.util.Locale;

final class AppLocks {
    private static final String PREFS = "app_locks";
    private static final String RULES = "rules";
    private static final String EVENTS = "events";
    private static final int EVENT_CAP = 40;
    private static final long BLOCK_NOTICE_MS = 60_000L;
    private static final long FOREGROUND_CHECK_MS = 180;
    private final PhoneService service;
    private final SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AppLockAttempt attempt = new AppLockAttempt();
    private JSONObject rules;
    private long latestExpiry;
    private long expiryNotified;
    private String blockNoticedPkg = "";
    private long blockNoticedAt;
    private LinearLayout notice;
    private View cover;
    private final Runnable hideNotice = this::hide;
    private final Runnable watchdog = this::inspect;

    AppLocks(PhoneService service) {
        this.service = service;
        prefs = service.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject saved;
        try { saved = new JSONObject(prefs.getString(RULES, "{}")); }
        catch (Exception badData) { saved = new JSONObject(); }
        rules = saved;
        refreshExpiry();
    }

    static void savePalette(Context context, JSONObject color) {
        SharedPreferences.Editor edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (String key : new String[]{"surface", "ink", "muted", "border"}) {
            String value = color.optString(key);
            if (value.matches("#[0-9a-fA-F]{6}")) edit.putInt(key, Color.parseColor(value));
        }
        edit.apply();
    }

    private boolean protectedApp(String pkg) { return guarded(service, pkg); }

    /** System surfaces, launchers, dialers and this app itself must never be locked. */
    static boolean guarded(Context c, String pkg) {
        String normalized = pkg.toLowerCase(Locale.ROOT);
        if (pkg.equals(c.getPackageName()) || normalized.equals("android") ||
            normalized.startsWith("com.android.") || normalized.contains("settings") ||
            normalized.contains("permissioncontroller") || normalized.contains("launcher") ||
            normalized.contains("systemui") || normalized.contains("securitycenter") ||
            normalized.contains("dialer") || normalized.contains("emergency")) return true;
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (android.content.pm.ResolveInfo candidate :
                c.getPackageManager().queryIntentActivities(home, 0)) {
            if (pkg.equals(candidate.activityInfo.packageName)) return true;
        }
        TelecomManager telecom = c.getSystemService(TelecomManager.class);
        return (telecom != null && pkg.equals(telecom.getDefaultDialerPackage())) ||
                pkg.equals(Telephony.Sms.getDefaultSmsPackage(c));
    }

    /** Whether the picker may offer this package for locking at all. */
    static boolean lockable(Context c, String pkg) {
        return !guarded(c, pkg) && !PhoneService.blockedPackage(c, pkg);
    }

    /** Recent enforcement history, newest last, capped. Readable without the service. */
    static JSONArray events(Context c) {
        try { return new JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(EVENTS, "[]")); }
        catch (Exception badData) { return new JSONArray(); }
    }

    private void record(String kind, String pkg, String label) {
        try {
            String shown = label == null || label.isEmpty() ? pkg : (label.length() > 24 ? label.substring(0, 24) + "…" : label);
            long now = System.currentTimeMillis();
            boolean block = "block".equals(kind);
            // The watchdog re-fires every 180ms while the app is on screen:
            // keep one history entry and one tray line per app per minute.
            if (block && shown.equals(blockNoticedPkg) && now - blockNoticedAt < BLOCK_NOTICE_MS) return;
            JSONArray arr = events(service);
            arr.put(PhoneService.json("t", now, "kind", kind, "pkg", pkg, "label", shown));
            while (arr.length() > EVENT_CAP) arr.remove(0);
            prefs.edit().putString(EVENTS, arr.toString()).apply();
            if (block) {
                blockNoticedPkg = shown; blockNoticedAt = now;
                Notifier.post(service, Notifier.CHANNEL_GUARD, "應用鎖擋下了", shown + " 想進去，已經切回小愛機");
            } else if ("expire".equals(kind)) {
                Notifier.post(service, Notifier.CHANNEL_GUARD, "應用鎖時間到", shown + " 現在可以打開了");
            }
        } catch (RuntimeException | LinkageError bad) {
            AccessibilityDiagnostics.fault(service, "記錄應用鎖事件", bad);
        }
    }

    boolean blocked(String pkg) {
        JSONObject rule = rules.optJSONObject(pkg);
        return rule != null && rule.optLong("until") > System.currentTimeMillis();
    }

    JSONObject command(JSONObject args) {
        String action = args.optString("action");
        if ("app_locks".equals(action)) {
            JSONArray entries = new JSONArray();
            rules.keys().forEachRemaining(pkg -> {
                if (blocked(pkg)) entries.put(rules.optJSONObject(pkg));
            });
            return PhoneService.json("ok", true, "why", "已读取当前应用锁", "locks", entries);
        }
        if ("clear_app_locks".equals(action)) {
            return update(new JSONObject(), "已解除全部应用锁");
        }
        PhoneService.Target target = service.resolve(args.optString("app"));
        if (target == null || protectedApp(target.pkg)) {
            return PhoneService.result(false, "找不到可锁定的普通 App，请提供安装名称或包名", "");
        }
        JSONObject next = new JSONObject();
        rules.keys().forEachRemaining(pkg -> {
            if (blocked(pkg)) copyRule(next, pkg, rules.optJSONObject(pkg));
        });
        if ("unlock_app".equals(action)) {
            if (!blocked(target.pkg)) return PhoneService.result(true, target.label + "当前没有应用锁", "");
            next.remove(target.pkg);
            return update(next, "已解除" + target.label + "的应用锁");
        }
        int minutes = args.optInt("minutes", 0);
        if (minutes < 1 || minutes > 1440) {
            return PhoneService.result(false, "请由角色指定 1–1440 分钟的锁定时长", "");
        }
        long until = System.currentTimeMillis() + minutes * 60_000L;
        String reason = args.optString("reason").trim();
        copyRule(next, target.pkg, PhoneService.json("app", target.label, "until", until,
                "reason", reason.substring(0, Math.min(80, reason.length()))));
        return update(next, "已锁定" + target.label + "，解锁时间 " + format(until));
    }

    private void copyRule(JSONObject target, String pkg, JSONObject rule) {
        try { target.put(pkg, rule); } catch (org.json.JSONException invalidKey) { throw new IllegalArgumentException(invalidKey); }
    }

    private JSONObject update(JSONObject next, String message) {
        if (!prefs.edit().putString(RULES, next.toString()).commit()) {
            return PhoneService.result(false, "无法保存应用锁", "");
        }
        rules = next;
        refreshExpiry();
        AccessibilityDiagnostics.lockStage(service, latestExpiry>System.currentTimeMillis()?"規則已儲存":"目前沒有有效鎖定");
        hide();
        resetVisit();
        inspect();
        return PhoneService.result(true, message, "");
    }

    private void refreshExpiry() {
        latestExpiry = 0;
        for (java.util.Iterator<String> keys = rules.keys(); keys.hasNext();) {
            JSONObject rule = rules.optJSONObject(keys.next());
            if (rule != null) latestExpiry = Math.max(latestExpiry, rule.optLong("until"));
        }
    }

    void onWindow(AccessibilityEvent event) {
        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && type != AccessibilityEvent.TYPE_WINDOWS_CHANGED) return;
        // The event accessor arrived in Android 13. Android 11/12 still enforce
        // the display boundary through getWindowsOnAllDisplays() in foreground().
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && event.getDisplayId() > Display.DEFAULT_DISPLAY) return;
        if (latestExpiry > System.currentTimeMillis() || cover != null || notice != null) inspect();
    }

    void inspect() {
        try {
            inspectForeground();
        } catch (RuntimeException | LinkageError error) {
            AccessibilityDiagnostics.fault(service, "检查应用锁前台", error);
            close();
            // Window changes or a new task can retry. Clear the cover immediately.
        }
    }

    private void inspectForeground() {
        handler.removeCallbacks(watchdog);
        long remaining = latestExpiry - System.currentTimeMillis();
        if (remaining <= 0 || PhoneService.instance != service) {
            if (remaining <= 0 && latestExpiry > 0 && expiryNotified != latestExpiry) {
                expiryNotified = latestExpiry;
                String[] gone = expiredRule();
                blockNoticedPkg = "";
                if (gone != null) record("expire", gone[0], gone[1]);
            }
            resetVisit();
            hide();
            return;
        }
        boolean interactive = usable();
        handler.postDelayed(watchdog, Math.min(remaining, interactive ? FOREGROUND_CHECK_MS : 1000));
        if (!interactive) {
            resetVisit();
            hide();
            return;
        }
        Foreground current = foreground();
        if (current == null) {
            removeCover();
            return;
        }
        if (!blocked(current.pkg)) {
            resetVisit();
            return;
        }
        long now = SystemClock.elapsedRealtime();
        AppLockAttempt.Action action = attempt.observe(current.pkg, current.windowId, now);
        if (action == AppLockAttempt.Action.BACK) {
            if (protectedApp(current.pkg)) {
                resetVisit();
                return;
            }
            showCover();
            boolean accepted = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
            AccessibilityDiagnostics.lockStage(service,accepted?"Android 接受返回請求":"Android 拒絕返回請求");
            show(rules.optJSONObject(current.pkg));
            if (accepted) {
                JSONObject rule = rules.optJSONObject(current.pkg);
                record("block", current.pkg, rule == null ? null : rule.optString("app"));
            }
            if (!accepted) {
                attempt.backRejected(now);
                handler.removeCallbacks(watchdog);
                handler.post(watchdog);
            }
        } else if (action == AppLockAttempt.Action.HOME) {
            if (protectedApp(current.pkg)) {
                resetVisit();
            } else {
                showCover();
                boolean accepted=service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME);
                AccessibilityDiagnostics.lockStage(service,accepted?"Android 接受回主屏請求":"Android 拒絕回主屏請求");
            }
        }
    }

    private void resetVisit() {
        attempt.observe(null, -1, 0);
        removeCover();
    }

    private void removeCover() {
        if (cover == null) return;
        WindowManager manager = service.getSystemService(WindowManager.class);
        try { if (manager != null) manager.removeViewImmediate(cover); } catch (RuntimeException ignored) {}
        cover = null;
    }

    private boolean usable() {
        KeyguardManager keyguard = service.getSystemService(KeyguardManager.class);
        PowerManager power = service.getSystemService(PowerManager.class);
        return PhoneService.instance == service && keyguard != null && !keyguard.isKeyguardLocked()
                && power != null && power.isInteractive();
    }

    private static final class Foreground {
        final String pkg;
        final int windowId;

        Foreground(String pkg, int windowId) { this.pkg = pkg; this.windowId = windowId; }
    }

    /** [pkg, label] of the rule that just ran out, newest expiry wins. */
    private String[] expiredRule() {
        for (java.util.Iterator<String> keys = rules.keys(); keys.hasNext();) {
            String pkg = keys.next();
            JSONObject rule = rules.optJSONObject(pkg);
            if (rule != null && rule.optLong("until") == latestExpiry)
                return new String[]{pkg, rule.optString("app")};
        }
        return null;
    }

    private Foreground foreground() {
        java.util.List<AccessibilityWindowInfo> windows = Build.VERSION.SDK_INT >= 30
                ? service.getWindowsOnAllDisplays().get(Display.DEFAULT_DISPLAY) : service.getWindows();
        AccessibilityWindowInfo first = null;
        if (windows != null) for (AccessibilityWindowInfo window : windows) {
            int type = window.getType();
            if (type == AccessibilityWindowInfo.TYPE_INPUT_METHOD || type == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY) continue;
            if (!window.isActive() && !window.isFocused()) continue;
            if (first == null || window.getLayer() > first.getLayer()) first = window;
        }
        if (first == null || first.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) return null;
        android.view.accessibility.AccessibilityNodeInfo root = first.getRoot();
        return root == null || root.getPackageName() == null ? null :
                new Foreground(root.getPackageName().toString(), first.getId());
    }

    private static String format(long until) {
        return DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(until));
    }

    private int dp(int value) { return Math.round(value * service.getResources().getDisplayMetrics().density); }
    private int color(String key, int fallback) { return prefs.getInt(key, fallback); }
    private TextView line(String text, int size, int ink, boolean strong) {
        TextView line = new TextView(service);
        line.setText(text);
        line.setTextSize(size);
        line.setTextColor(ink);
        if (strong) line.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return line;
    }

    private void showCover() {
        if (cover != null) return;
        WindowManager manager = service.getSystemService(WindowManager.class);
        if (manager == null) return;
        TextView view = line("应用已锁定", 16, color("ink", 0xFF302A27), true);
        view.setGravity(Gravity.CENTER);
        view.setBackgroundColor(color("surface", 0xFFF8F5F1) | 0xFF000000);
        view.setOnTouchListener((ignored, event) -> true);
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.OPAQUE);
        try { manager.addView(view, params); cover = view; } catch (RuntimeException ignored) {}
    }

    private void show(JSONObject rule) {
        hide();
        WindowManager manager = service.getSystemService(WindowManager.class);
        if (manager == null) return;
        LinearLayout card = new LinearLayout(service);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(14), dp(18), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color("surface", 0xFFF8F5F1));
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), color("border", 0xFFE5DCD3));
        card.setBackground(bg);
        card.setElevation(dp(8));
        card.addView(line("今天应用已被锁定", 16, color("ink", 0xFF302A27), true));
        TextView detail = line(rule.optString("app") + " · " + format(rule.optLong("until")) + " 解锁",
                13, color("muted", 0xFF645754), false);
        detail.setPadding(0, dp(5), 0, 0);
        card.addView(detail);
        String reason = rule.optString("reason");
        if (!reason.isEmpty()) {
            TextView note = line(reason, 12, color("muted", 0xFF645754), false);
            note.setMaxLines(2);
            note.setPadding(0, dp(4), 0, 0);
            card.addView(note);
        }
        int width = Math.min(service.getResources().getDisplayMetrics().widthPixels - dp(32), dp(360));
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(width,
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        params.y = dp(54);
        try {
            manager.addView(card, params);
            notice = card;
            handler.postDelayed(hideNotice, 3000);
        } catch (RuntimeException ignored) {
            android.widget.Toast.makeText(service, "应用已锁定 · " + detail.getText(), android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    private void hide() {
        handler.removeCallbacks(hideNotice);
        if (notice == null) return;
        WindowManager manager = service.getSystemService(WindowManager.class);
        try { if (manager != null) manager.removeViewImmediate(notice); } catch (RuntimeException ignored) {}
        notice = null;
    }

    void close() {
        handler.removeCallbacksAndMessages(null);
        resetVisit();
        hide();
    }
}
