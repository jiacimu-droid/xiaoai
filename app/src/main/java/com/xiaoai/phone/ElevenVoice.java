package com.xiaoai.phone;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Base64;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

final class ElevenVoice {
    private static final String API = "https://api.elevenlabs.io";
    private static final String MP3 = "mp3_44100_64";
    private static final int AUDIO_LIMIT = 2 * 1024 * 1024;
    private static final MediaType JSON = MediaType.get("application/json");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(35, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build();

    static Request.Builder request(String path, String key) {
        return new Request.Builder().url(API + path).header("xi-api-key", key);
    }

    static WebSocket socket(Request request, WebSocketListener listener) {
        return HTTP.newWebSocket(request, listener);
    }

    static JSONObject voices(String key, String page) throws IOException, JSONException {
        HttpUrl.Builder url = HttpUrl.get(API + "/v2/voices").newBuilder()
            .addQueryParameter("page_size", "100")
            .addQueryParameter("include_total_count", "false");
        if (!page.isEmpty()) url.addQueryParameter("next_page_token", page);
        byte[] result = fetch(request("/v2/voices", key).url(url.build()).build(), AUDIO_LIMIT);
        JSONObject json = new JSONObject(new String(result, java.nio.charset.StandardCharsets.UTF_8));
        JSONArray source = json.getJSONArray("voices");
        JSONArray choices = new JSONArray();
        for (int i = 0; i < source.length(); i++) {
            JSONObject voice = source.getJSONObject(i);
            String id = voice.optString("voice_id");
            String name = voice.optString("name").trim();
            if (validVoice(id)) choices.put(new JSONObject().put("id", id).put("name", name.isEmpty() ? id : name));
        }
        String next = json.optBoolean("has_more") ? json.optString("next_page_token", "") : "";
        return PhoneService.json("ok", true, "voices", choices, "next", next);
    }

    static boolean validVoice(String voice) {
        return voice.matches("[A-Za-z0-9_-]{1,80}");
    }

    static byte[] synthesize(String key, String model, String voice, String text) throws Exception {
        if (!validVoice(voice)) throw new IOException("請先從音色清單選擇音色");
        if (text.isEmpty() || text.length() > 4000) throw new IOException("合成文字長度須在 1 到 4000 字之間");
        JSONObject body = new JSONObject().put("model_id", model);
        String path;
        switch (model) {
            case "eleven_v4_turbo":
            case "eleven_v3_conversational":
                return dialogueSocket(key, model, voice, text);
            case "eleven_v4":
            case "eleven_v3":
                path = "/v1/text-to-dialogue/stream";
                body.put("inputs", inputs(voice, text));
                break;
            case "eleven_flash_v2_5":
            case "eleven_multilingual_v2":
            case "eleven_turbo_v2_5":
                path = "/v1/text-to-speech/" + voice + "/stream";
                body.put("text", text);
                break;
            default:
                throw new IOException("請選擇支援的 ElevenLabs 語音模型");
        }
        return fetch(request(path + "?output_format=" + MP3, key).header("Accept", "audio/mpeg")
            .post(RequestBody.create(body.toString(), JSON)).build(), AUDIO_LIMIT);
    }

    private static JSONArray inputs(String voice, String text) throws JSONException {
        return new JSONArray().put(new JSONObject().put("text", text).put("voice_id", voice));
    }

    private static byte[] dialogueSocket(String key, String model, String voice, String text) throws Exception {
        String setup = new JSONObject().put("voices", new JSONArray().put(voice)).toString();
        String input = new JSONObject().put("inputs", inputs(voice, text)).toString();
        ByteArrayOutputStream audio = new ByteArrayOutputStream();
        CountDownLatch done = new CountDownLatch(1);
        String[] failure = {null};
        WebSocket ws = socket(request("/v1/text-to-dialogue/stream-input?model_id=" + model + "&output_format=" + MP3, key)
            .build(), new WebSocketListener() {
                @Override public void onOpen(WebSocket socket, Response response) {
                    if (!socket.send(setup) || !socket.send(input) || !socket.send("{\"close_socket\":true}")) {
                        failure[0] = "ElevenLabs 無法送出合成請求";
                        done.countDown();
                    }
                }

                @Override public void onMessage(WebSocket socket, String raw) {
                    if (done.getCount() == 0) return;
                    try {
                        JSONObject event = new JSONObject(raw);
                        if (event.has("error") || event.has("error_type")) throw new IOException("ElevenLabs 拒絕合成，請檢查模型與音色權限");
                        String encoded = event.optString("audio", "");
                        if (!encoded.isEmpty() && !encoded.equals("null")) {
                            if (encoded.length() > AUDIO_LIMIT * 2) throw new IOException("合成音訊過大");
                            byte[] part = Base64.getDecoder().decode(encoded);
                            if (audio.size() + part.length > AUDIO_LIMIT) throw new IOException("合成音訊過大");
                            audio.write(part);
                        }
                        if (event.optBoolean("is_final") || event.optBoolean("isFinal")) done.countDown();
                    } catch (Exception e) {
                        failure[0] = e instanceof IOException ? e.getMessage() : "ElevenLabs 合成回應無法解析";
                        done.countDown();
                    }
                }

                @Override public void onClosing(WebSocket socket, int code, String reason) {
                    if (done.getCount() == 0) return;
                    if (code != 1000) failure[0] = "ElevenLabs 語音連線中斷";
                    done.countDown();
                }

                @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                    if (done.getCount() == 0) return;
                    failure[0] = response == null ? "ElevenLabs 語音連線失敗" : httpError(response.code());
                    done.countDown();
                }
            });
        try {
            if (!done.await(30, TimeUnit.SECONDS)) throw new IOException("ElevenLabs 語音合成逾時");
            if (failure[0] != null) throw new IOException(failure[0]);
            if (audio.size() == 0) throw new IOException("ElevenLabs 未返回音訊");
            return audio.toByteArray();
        } finally {
            ws.cancel();
        }
    }

    private static byte[] fetch(Request request, int limit) throws IOException {
        try (Response response = HTTP.newCall(request).execute()) {
            if (!response.isSuccessful()) throw new IOException(httpError(response.code()));
            ResponseBody body = response.body();
            if (body == null) throw new IOException("ElevenLabs 未返回資料");
            try (InputStream in = body.byteStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int n; (n = in.read(buffer)) != -1;) {
                    if (out.size() + n > limit) throw new IOException("ElevenLabs 回應過大");
                    out.write(buffer, 0, n);
                }
                if (out.size() == 0) throw new IOException("ElevenLabs 未返回資料");
                return out.toByteArray();
            }
        } catch (java.net.SocketTimeoutException e) {
            throw new IOException("ElevenLabs 連線逾時");
        } catch (java.net.UnknownHostException e) {
            throw new IOException("無法連線到 ElevenLabs");
        }
    }

    static String httpError(int code) {
        if (code == 401 || code == 403) return "ElevenLabs 金鑰無效或缺少此功能的權限（HTTP " + code + "）";
        if (code == 429) return "ElevenLabs 額度或請求頻率受限（HTTP 429）";
        return "ElevenLabs 請求失敗（HTTP " + code + "）";
    }
}
