package com.xiaoai.phone;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

final class AccessibilityGrant {
    private AccessibilityGrant() {}

    static boolean isEnabled(Context context) {
        ComponentName service = new ComponentName(context, PhoneService.class);
        String full = service.flattenToString();
        String abbreviated = service.flattenToShortString();
        try {
            String enabled = Settings.Secure.getString(context.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (enabled != null) return contains(enabled, full, abbreviated);
        } catch (SecurityException ignored) {
            // Some providers restrict direct reads. Use the public manager if available.
        }
        AccessibilityManager manager = context.getSystemService(AccessibilityManager.class);
        if (manager == null) return false;
        for (AccessibilityServiceInfo info : manager.getEnabledAccessibilityServiceList(
                AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            String id = info.getId();
            if (full.equals(id) || abbreviated.equals(id)) return true;
        }
        return false;
    }

    static boolean contains(String enabled, String full, String abbreviated) {
        for (String component : enabled.split(":")) {
            if (full.equals(component) || abbreviated.equals(component)) return true;
        }
        return false;
    }
}
