package com.xiaoai.phone;

/** Tracks one foreground visit. The short settle times only pace repeat actions in that visit. */
final class AppLockAttempt {
    enum Action { NONE, BACK, HOME }

    private String target;
    private int windowId;
    private long nextAction;

    Action observe(String blockedPackage, int observedWindow, long now) {
        if (blockedPackage == null) {
            target = null;
            return Action.NONE;
        }
        if (!blockedPackage.equals(target)) {
            target = blockedPackage;
            windowId = observedWindow;
            nextAction = now + 150;
            return Action.BACK;
        }
        if (observedWindow != windowId) {
            windowId = observedWindow;
            nextAction = now + 400;
            return Action.HOME;
        }
        if (now < nextAction) return Action.NONE;
        nextAction = now + 400;
        return Action.HOME;
    }

    void backRejected(long now) {
        nextAction = now;
    }
}
