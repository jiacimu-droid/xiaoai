package com.xiaoai.phone;

import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/** One call turn. Only a committed transcript is returned to the chat model. */
final class ElevenRealtimeInput extends WebSocketListener {
    private static final int SAMPLE_RATE = 16000;
    private static final int CHUNK_SIZE = 3200;
    private final Consumer<JSONObject> result;
    private final Consumer<String> partial;
    private final AtomicBoolean done = new AtomicBoolean();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable connectTimeout = () -> fail("ElevenLabs 即時辨識連線逾時");
    private volatile WebSocket socket;
    private volatile boolean heardSpeech;

    ElevenRealtimeInput(Consumer<JSONObject> result, Consumer<String> partial) {
        this.result = result;
        this.partial = partial;
    }

    void start(String key, String model, String language) {
        boolean v3 = "scribe_v3_live".equals(model);
        String query = "?model_id=" + model + "&audio_format=pcm_16000&commit_strategy="
            + (v3 ? "turn_prediction" : "vad") + "&vad_silence_threshold_secs=0.9";
        if (!language.isEmpty()) query += "&language_code=" + language;
        else if (v3) query += "&multilang_mode=true";
        handler.postDelayed(connectTimeout, 12000);
        WebSocket ws = ElevenVoice.socket(ElevenVoice.request("/v1/speech-to-text/realtime" + query, key).build(), this);
        socket = ws;
        if (done.get()) ws.cancel();
    }

    @Override public void onMessage(WebSocket ws, String raw) {
        if (done.get()) return;
        try {
            JSONObject event = new JSONObject(raw);
            String type = event.optString("message_type");
            String text = event.optString("text").trim();
            switch (type) {
                case "session_started":
                    handler.removeCallbacks(connectTimeout);
                    Thread thread = new Thread(() -> capture(ws), "xiaoai-scribe");
                    thread.start();
                    break;
                case "partial_transcript":
                    if (!text.isEmpty()) {
                        heardSpeech = true;
                        partial.accept(text);
                    }
                    break;
                case "committed_transcript":
                    if (!text.isEmpty()) finish(PhoneService.json("ok", true, "text", text));
                    break;
                case "auth_error":
                    fail("ElevenLabs 金鑰無效或缺少即時辨識權限");
                    break;
                case "quota_exceeded":
                case "rate_limited":
                    fail("ElevenLabs 額度或請求頻率受限");
                    break;
                default:
                    if (event.has("error") || type.endsWith("_error"))
                        fail("ElevenLabs 即時辨識失敗，請檢查模型及權限");
            }
        } catch (Exception e) {
            fail("ElevenLabs 即時辨識回應無法解析");
        }
    }

    @SuppressLint("MissingPermission")
    private void capture(WebSocket ws) {
        AudioRecord mic = null;
        try {
            if (done.get()) return;
            int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minBuffer < 0) throw new IllegalStateException();
            mic = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minBuffer, 2 * CHUNK_SIZE));
            mic.startRecording();
            byte[] pcm = new byte[CHUNK_SIZE];
            long start = SystemClock.elapsedRealtime();
            boolean committed = false;
            while (!done.get()) {
                int count = mic.read(pcm, 0, pcm.length);
                if (done.get()) return;
                if (count < 0) throw new IllegalStateException();
                if (count == 0) continue;
                long elapsed = SystemClock.elapsedRealtime() - start;
                if (!heardSpeech && elapsed >= 15000) {
                    finish(PhoneService.json("ok", true, "silence", true));
                    return;
                }
                if (elapsed >= 50000) {
                    fail("ElevenLabs 未能在時限內完成辨識");
                    return;
                }
                boolean commit = !committed && elapsed >= 45000;
                String data = Base64.getEncoder().encodeToString(count == pcm.length ? pcm : Arrays.copyOf(pcm, count));
                if (!ws.send(new JSONObject().put("message_type", "input_audio_chunk").put("audio_base_64", data)
                    .put("sample_rate", SAMPLE_RATE).put("commit", commit).toString())) {
                    fail("ElevenLabs 即時辨識連線已中斷");
                    return;
                }
                committed |= commit;
            }
        } catch (Exception e) {
            fail("無法使用麥克風進行即時辨識");
        } finally {
            if (mic != null) mic.release();
        }
    }

    @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
        fail(response == null ? "ElevenLabs 即時辨識連線失敗" : ElevenVoice.httpError(response.code()));
    }

    @Override public void onClosing(WebSocket ws, int code, String reason) {
        fail("ElevenLabs 即時辨識連線已關閉");
    }

    void cancel() {
        if (!done.compareAndSet(false, true)) return;
        handler.removeCallbacks(connectTimeout);
        WebSocket ws = socket;
        if (ws != null) ws.cancel();
    }

    private void finish(JSONObject value) {
        if (!done.compareAndSet(false, true)) return;
        handler.removeCallbacks(connectTimeout);
        WebSocket ws = socket;
        if (ws != null) ws.cancel();
        result.accept(value);
    }

    private void fail(String why) {
        finish(PhoneService.json("ok", false, "why", why));
    }
}
