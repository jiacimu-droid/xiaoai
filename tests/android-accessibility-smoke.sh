#!/usr/bin/env bash
set -euo pipefail

# Run only on the clean emulator provisioned by the APK workflow.
apk=${1:?APK path is required}
package=com.xiaoai.phone
component=$package/.PhoneService
prefs=shared_prefs/accessibility_diagnostics.xml

diagnostics() { adb shell run-as "$package" cat "$prefs" 2>/dev/null; }
app_pid() { adb shell pidof "$package" | tr -d '\r'; }
has_connection() {
    local pid state
    pid=$(app_pid)
    test -n "$pid" || return 1
    state=$(diagnostics) || return 1
    grep -Eq 'name="stage">(callback|event)<' <<<"$state" &&
        grep -Fq "name=\"pid\" value=\"$pid\"" <<<"$state" &&
        grep -Fq 'name="firstEventAt"' <<<"$state"
}
has_disconnected() { diagnostics | grep -Eq 'name="stage">(unbind|destroy)<' ; }
window_events() {
    adb shell am start -W -a android.settings.SETTINGS >/dev/null
    adb shell am start -W -n "$package/.AccessibilityDiagnosticsActivity" >/dev/null
}
wait_for_connection() {
    local message=$1
    for _ in {1..3}; do
        # Service binding is asynchronous. A window can open before Android
        # has finished binding, so drive additional real events while waiting.
        window_events
        for _ in {1..8}; do
            if has_connection; then
                printf '%s\n' "$message"
                return 0
            fi
            sleep 1
        done
    done
    printf 'Timed out: %s\n' "$message" >&2
    return 1
}
wait_for() {
    local message=$1
    shift
    for _ in {1..25}; do
        if "$@"; then
            printf '%s\n' "$message"
            return 0
        fi
        sleep 1
    done
    printf 'Timed out: %s\n' "$message" >&2
    return 1
}
on_failure() {
    local code=$?
    if [ "$code" -ne 0 ]; then
        printf 'Emulator accessibility settings and app process:\n'
        adb shell settings --user current get secure accessibility_enabled || true
        adb shell settings --user current get secure enabled_accessibility_services || true
        app_pid || true
        diagnostics || true
        adb shell dumpsys accessibility | awk '/User state|Service|com\.xiaoai\.phone/' | cut -c1-400 | tail -80 || true
        adb logcat -d -s XiaoAiAccessibility:I AndroidRuntime:E | tail -100 || true
        adb logcat -d -b crash | tail -60 || true
    fi
}
trap on_failure EXIT

test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 31
adb install "$apk"
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
# Start the native activity first to confirm the clean installation binds
# even while Android's WebView provider is still initializing.
adb shell am start -W -n "$package/.AccessibilityDiagnosticsActivity"
adb shell settings --user current put secure enabled_accessibility_services "$component"
adb shell settings --user current put secure accessibility_enabled 1
wait_for_connection 'System enabled the service, and the same app process received an actual window event.'
pid_before=$(app_pid)
adb shell am start -W -n "$package/.MainActivity"
adb shell am start -W -a android.settings.SETTINGS
adb shell input keyevent KEYCODE_BACK
sleep 1
test "$(app_pid)" = "$pid_before"
has_connection

adb install -r "$apk"
wait_for_connection 'The existing grant reconnected after an APK replacement and delivered a new window event.'
adb shell am start -W -n "$package/.MainActivity"
has_connection

adb shell settings --user current delete secure enabled_accessibility_services
adb shell settings --user current put secure accessibility_enabled 0
wait_for 'Android revocation disconnected the service.' has_disconnected
