package com.xiaoai.phone;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Explicit, local microphone capture; only confirmed recordings go to the selected STT API. */
final class SpeechInput {
    private static final int PERMISSION=8640;
    private static final String ENDPOINT="https://api.elevenlabs.io/v1/speech-to-text";
    private static final String[] LABELS={"自動辨識","粵語（香港／澳門）","普通話","英文"};
    private static final String[] LANGS={"","yue","zho","eng"};
    private static final int LIMIT_MS=120000;
    private final Activity host;
    private final SharedPreferences prefs;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Handler ui=new Handler(Looper.getMainLooper());
    private Request active;
    private MediaRecorder recorder;
    private File audio;
    private AlertDialog dialog;
    private boolean waitingPermission, uploading, closed;
    private volatile HttpsURLConnection connection;
    private static final class Request {
        final String id; final JavaScriptReplyProxy reply; String key,lang;
        Request(String id,JavaScriptReplyProxy reply){this.id=id;this.reply=reply;}
    }
    SpeechInput(Activity host){
        this.host=host;prefs=host.getSharedPreferences("xa_stt_v1",Context.MODE_PRIVATE);
    }
    void bind(WebView web,String origin){
        WebViewCompat.addWebMessageListener(web,"SpeechInputNative",Collections.singleton(origin),(view,msg,from,main,reply)->{
            if(!main||!origin.equals(from.toString())||closed)return;
            String id="";
            try{
                String raw=msg.getData();if(raw==null||raw.length()>32000)return;
                JSONObject request=new JSONObject(raw);id=request.getString("id");
                if(id.length()>100)return;
                String action=request.optString("action");
                if("copy".equals(action)){
                    String value=request.optString("text");
                    if(value.length()>20000)throw new IOException("文字太長");
                    ClipboardManager clipboard=(ClipboardManager)host.getSystemService(Context.CLIPBOARD_SERVICE);
                    if(clipboard==null)throw new IOException("剪貼簿不可用");
                    clipboard.setPrimaryClip(ClipData.newPlainText("語音轉文字",value));
                    reply(reply,id,PhoneService.json("ok",true));return;
                }
                if(!"record".equals(action))throw new IOException("不支援的語音操作");
                if(active!=null)throw new IOException("已有語音辨識工作進行中");
                active=new Request(id,reply);showSettings();
            }catch(Exception e){
                if(active!=null&&active.id.equals(id))finish(PhoneService.json("ok",false,"why","無法開啟語音設定"));
                else reply(reply,id,PhoneService.json("ok",false,"why",e.getMessage()));
            }
        });
    }
    void installScript(WebView web){
        web.evaluateJavascript("(function(){if(document.getElementById('xaSpeechInputScript'))return;var s=document.createElement('script');s.id='xaSpeechInputScript';s.src='/assets/speech-input.js';document.head.appendChild(s);})()",null);
    }
    private void reply(JavaScriptReplyProxy proxy,String id,JSONObject result){
        if(closed)return;
        try{proxy.postMessage(PhoneService.json("id",id,"result",result).toString());}catch(RuntimeException ignored){}
    }
    private void finish(JSONObject result){
        Request req=active;active=null;waitingPermission=false;uploading=false;
        if(req!=null)reply(req.reply,req.id,result);
    }
    private void cancelled(String reason){finish(PhoneService.json("ok",false,"cancelled",true,"why",reason));}
    private void showSettings(){
        LinearLayout box=new LinearLayout(host);box.setOrientation(LinearLayout.VERTICAL);
        int pad=(int)(20*host.getResources().getDisplayMetrics().density);box.setPadding(pad,0,pad,0);
        TextView notice=new TextView(host);notice.setText("ElevenLabs Scribe v2｜錄音完成並確認後才會傳送到 ElevenLabs，可能產生 API 用量。Key 只儲存在本機私有設定，不會加入對話。");
        box.addView(notice);
        EditText key=new EditText(host);key.setSingleLine(true);key.setHint("ElevenLabs API Key");
        key.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        key.setText(prefs.getString("key",""));box.addView(key);
        Spinner language=new Spinner(host);
        ArrayAdapter<String> adapter=new ArrayAdapter<>(host,android.R.layout.simple_spinner_dropdown_item,LABELS);
        language.setAdapter(adapter);language.setSelection(Math.max(0,Math.min(LANGS.length-1,prefs.getInt("language",0))));box.addView(language);
        dialog=new AlertDialog.Builder(host).setTitle("語音轉文字設定").setView(box)
            .setNegativeButton("取消",(d,w)->cancelled("已取消"))
            .setNeutralButton("清除 Key",(d,w)->{prefs.edit().remove("key").apply();cancelled("已清除本機 Key");})
            .setPositiveButton("開始錄音",null).setOnCancelListener(d->cancelled("已取消")).create();
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String value=key.getText().toString().trim();
            if(value.isEmpty()||value.length()>512||value.indexOf('\n')>=0||value.indexOf('\r')>=0){key.setError("請輸入有效 API Key");return;}
            if(active==null)return;
            int selected=language.getSelectedItemPosition();
            active.key=value;active.lang=LANGS[selected];
            prefs.edit().putString("key",value).putInt("language",selected).apply();
            dialog.dismiss();dialog=null;
            if(host.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
                waitingPermission=true;host.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},PERMISSION);
            }else startRecording();
        });
    }
    void onPermissionResult(int request){
        if(request!=PERMISSION||!waitingPermission||active==null||closed)return;
        waitingPermission=false;
        if(host.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)startRecording();
        else finish(PhoneService.json("ok",false,"why","麥克風權限未授予，請在系統設定允許小愛機錄音"));
    }
    @SuppressWarnings("deprecation") private void startRecording(){
        try{
            audio=File.createTempFile("xa-stt-",".m4a",host.getCacheDir());
            recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);recorder.setAudioEncodingBitRate(64000);recorder.setAudioSamplingRate(44100);
            recorder.setOutputFile(audio.getAbsolutePath());recorder.prepare();recorder.start();
            dialog=new AlertDialog.Builder(host).setTitle("正在錄音…")
                .setMessage("最多 120 秒。說完按「完成並轉寫」，取消或切到其他 App 不會傳送。")
                .setPositiveButton("完成並轉寫",(d,w)->submitRecording())
                .setNegativeButton("取消",(d,w)->discard("已取消錄音"))
                .setOnCancelListener(d->discard("已取消錄音")).create();
            dialog.show();ui.postDelayed(limit,LIMIT_MS);
        }catch(Exception e){
            releaseRecorder(false);deleteAudio();finish(PhoneService.json("ok",false,"why","無法啟動麥克風，請檢查權限或是否被其他 App 使用"));
        }
    }
    private final Runnable limit=()->{
        if(recorder==null)return;
        boolean ok=releaseRecorder(true);
        if(dialog!=null)dialog.dismiss();
        if(!ok){deleteAudio();finish(PhoneService.json("ok",false,"why","錄音失敗"));return;}
        dialog=new AlertDialog.Builder(host).setTitle("已達錄音上限").setMessage("是否將這段錄音送出轉寫？")
            .setPositiveButton("轉寫",(d,w)->submitRecording())
            .setNegativeButton("取消",(d,w)->discard("已取消錄音"))
            .setOnCancelListener(d->discard("已取消錄音")).create();dialog.show();
    };
    private boolean releaseRecorder(boolean stop){
        ui.removeCallbacks(limit);MediaRecorder r=recorder;recorder=null;
        if(r==null)return true;
        boolean ok=true;
        try{if(stop)r.stop();}catch(RuntimeException e){ok=false;}
        finally{try{r.release();}catch(RuntimeException ignored){}}
        return ok;
    }
    private void deleteAudio(){if(audio!=null){audio.delete();audio=null;}}
    private void discard(String why){releaseRecorder(false);deleteAudio();if(dialog!=null){dialog.dismiss();dialog=null;}cancelled(why);}
    private void submitRecording(){
        dialog=null;
        if(active==null||uploading)return;
        if(!releaseRecorder(true)||audio==null||audio.length()<256){deleteAudio();finish(PhoneService.json("ok",false,"why","錄音太短或錄音失敗，請重新錄音"));return;}
        final File file=audio;audio=null;final Request req=active;uploading=true;
        io.execute(()->{
            JSONObject result;
            try{result=PhoneService.json("ok",true,"text",transcribe(file,req.key,req.lang));}
            catch(IOException e){result=PhoneService.json("ok",false,"why",e.getMessage());}
            catch(Exception e){result=PhoneService.json("ok",false,"why","轉寫失敗，請確認網路及 API 設定");}
            finally{file.delete();}
            final JSONObject out=result;
            ui.post(()->{if(!closed&&active==req)finish(out);});
        });
    }
    private String transcribe(File file,String key,String lang)throws Exception{
        if(file.length()>12L*1024*1024)throw new IOException("錄音檔太大");
        String boundary="xa-"+UUID.randomUUID();
        HttpsURLConnection conn=(HttpsURLConnection)new URL(ENDPOINT).openConnection();
        connection=conn;
        try{
            conn.setConnectTimeout(20000);conn.setReadTimeout(90000);conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("POST");conn.setDoOutput(true);conn.setChunkedStreamingMode(16384);
            conn.setRequestProperty("xi-api-key",key);
            conn.setRequestProperty("Accept","application/json");
            conn.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
            try(OutputStream out=new BufferedOutputStream(conn.getOutputStream())){
                field(out,boundary,"model_id","scribe_v2");
                if(!lang.isEmpty())field(out,boundary,"language_code",lang);
                field(out,boundary,"tag_audio_events","false");
                field(out,boundary,"timestamps_granularity","none");
                put(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n");
                try(InputStream in=new FileInputStream(file)){byte[] buf=new byte[16384];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);}
                put(out,"\r\n--"+boundary+"--\r\n");
            }
            int code=conn.getResponseCode();
            if(code==401||code==403)throw new IOException("ElevenLabs API Key 無效或沒有語音轉文字權限（HTTP "+code+"）");
            if(code==429)throw new IOException("ElevenLabs 額度或請求頻率受限（HTTP 429）");
            if(code<200||code>=300)throw new IOException("ElevenLabs 轉寫失敗（HTTP "+code+"）");
            try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>2*1024*1024)throw new IOException("轉寫回應過大");out.write(b,0,n);}
                String text=new JSONObject(out.toString("UTF-8")).optString("text").trim();
                if(text.isEmpty())throw new IOException("未辨識到文字，請再試一次");
                if(text.length()>20000)throw new IOException("轉寫文字過長");
                return text;
            }
        }catch(java.net.SocketTimeoutException e){throw new IOException("ElevenLabs 連線逾時，請檢查網路後重試");}
        catch(java.net.UnknownHostException e){throw new IOException("無法連線到 ElevenLabs，請檢查網路");}
        finally{conn.disconnect();connection=null;}
    }
    private static void put(OutputStream out,String s)throws IOException{out.write(s.getBytes(StandardCharsets.UTF_8));}
    private static void field(OutputStream out,String b,String k,String v)throws IOException{
        put(out,"--"+b+"\r\nContent-Disposition: form-data; name=\""+k+"\"\r\n\r\n"+v+"\r\n");
    }
    void onPause(){if(recorder!=null||audio!=null)discard("已離開錄音畫面，未傳送音訊");}
    void close(){
        closed=true;ui.removeCallbacks(limit);releaseRecorder(false);deleteAudio();
        if(dialog!=null){dialog.dismiss();dialog=null;}
        HttpsURLConnection c=connection;if(c!=null)c.disconnect();
        io.shutdownNow();active=null;
    }
}
