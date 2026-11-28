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
import android.widget.ScrollView;
import android.widget.AdapterView;
import android.view.View;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import java.net.URI;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Local microphone capture for explicit chat recording or an active, unmuted call. */
final class SpeechInput {
    private static final int PERMISSION=8640;
    private static final String ELEVEN_ENDPOINT="https://api.elevenlabs.io/v1/speech-to-text";
    private static final String TENCENT_HOST="asr.tencentcloudapi.com";
    private static final String[] PROVIDERS={"","compatible","tencent","eleven"};
    private static final String[] PROVIDER_NAMES={"請選擇供應商","OpenAI 相容接口","騰訊雲","ElevenLabs"};
    private static final String[] LABELS={"自動辨識","粵語（香港／澳門）","普通話","英文"};
    private static final String[] LANGS={"","yue","zho","eng"};
    private static final String[] SCRIBE_MODELS={"scribe_v3_live","scribe_v3","scribe_v2_realtime","scribe_v2"};
    private static final String[] SCRIBE_LABELS={"Scribe v3 Live · 即時辨識","Scribe v3 · 錄音轉寫",
        "Scribe v2 Realtime · 即時辨識","Scribe v2 · 錄音轉寫"};
    private static final int DEFAULT_SCRIBE=3;
    private static final int LIMIT_MS=120000;
    private final Activity host;
    private final SharedPreferences prefs;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final ExecutorService voiceIo=Executors.newFixedThreadPool(2);
    private final Handler ui=new Handler(Looper.getMainLooper());
    private Request active;
    private MediaRecorder recorder;
    private ElevenRealtimeInput realtime;
    private AlertDialog keyDialog;
    private File audio;
    private AlertDialog dialog;
    private boolean waitingPermission, uploading, closed;
    private volatile HttpsURLConnection connection;
    private static final class Request {
        final String id; final JavaScriptReplyProxy reply; Config config; boolean call; volatile boolean cancelled;
        Request(String id,JavaScriptReplyProxy reply){this.id=id;this.reply=reply;}
    }
    private static final class Config {
        final int provider;
        final String key,address,model,secretId;
        final int language;
        Config(int provider,String key,String address,String model,String secretId,int language){
            this.provider=provider;this.key=key;this.address=address;this.model=model;this.secretId=secretId;this.language=language;
        }
        String name(){return PROVIDER_NAMES[provider];}
        boolean realtime(){return provider==3&&(model.equals(SCRIBE_MODELS[0])||model.equals(SCRIBE_MODELS[2]));}
        String batchModel(){return model.equals(SCRIBE_MODELS[0])||model.equals(SCRIBE_MODELS[1])?"scribe_v3":"scribe_v2";}
        int limitMs(){return provider==2?59000:LIMIT_MS;}
        void validate() throws Exception{
            if(provider==0)throw new IOException("請選擇辨識接口");
            if(!validCredential(key))throw new IOException("請輸入有效的 API Key 或 SecretKey");
            if(provider==2&&!secretId.matches("[A-Za-z0-9]+"))throw new IOException("請輸入有效的騰訊雲 SecretId");
            if(provider==1){
                transcriptionEndpoint(address);
                if(model.isEmpty()||model.length()>128||model.indexOf('\n')>=0||model.indexOf('\r')>=0)throw new IOException("請填寫轉寫模型名稱");
            }
        }
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
                if("elevenStatus".equals(action)){
                    reply(reply,id,PhoneService.json("ok",true,"configured",validCredential(readConfig(3).key)));return;
                }
                if("elevenKey".equals(action)){showElevenKey(reply,id);return;}
                if("elevenVoices".equals(action)||"elevenSpeak".equals(action)){
                    requestEleven(reply,id,action,request);return;
                }
                if("copy".equals(action)){
                    String value=request.optString("text");
                    if(value.length()>20000)throw new IOException("文字太長");
                    ClipboardManager clipboard=(ClipboardManager)host.getSystemService(Context.CLIPBOARD_SERVICE);
                    if(clipboard==null)throw new IOException("剪貼簿不可用");
                    clipboard.setPrimaryClip(ClipData.newPlainText("語音轉文字",value));
                    reply(reply,id,PhoneService.json("ok",true));return;
                }
                int selected=providerIndex();
                if("status".equals(action)){
                    String label=selected==0?"":PROVIDER_NAMES[selected];
                    if(selected==3)label+=" · "+SCRIBE_LABELS[scribeIndex(readConfig(3).model)];
                    reply(reply,id,PhoneService.json("ok",true,"provider",label));return;
                }
                if("cancelCall".equals(action)){
                    if(active!=null&&active.call)cancelCall();
                    reply(reply,id,PhoneService.json("ok",true));return;
                }
                if(!"record".equals(action)&&!"callRecord".equals(action)&&!"settings".equals(action))throw new IOException("不支援的語音操作");
                if(active!=null)throw new IOException("已有語音辨識工作進行中");
                active=new Request(id,reply);active.call="callRecord".equals(action);
                if("settings".equals(action)){showSettings();return;}
                Config config=readConfig(selected);
                try{config.validate();}
                catch(Exception invalid){finish(PhoneService.json("ok",false,"needsSettings",true,"why",invalid.getMessage()));return;}
                active.config=config;
                if(host.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
                    waitingPermission=true;host.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},PERMISSION);
                }else startRecording();
            }catch(Exception e){
                if(active!=null&&active.id.equals(id))finish(PhoneService.json("ok",false,"why","無法開啟語音功能"));
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
        if(realtime!=null){realtime.cancel();realtime=null;}
        Request req=active;active=null;dialog=null;waitingPermission=false;uploading=false;
        if(req!=null)reply(req.reply,req.id,result);
    }
    private void cancelled(String reason){finish(PhoneService.json("ok",false,"cancelled",true,"why",reason));}
    private int providerIndex(){
        String activeProvider=prefs.getString("provider","");
        for(int i=1;i<PROVIDERS.length;i++)if(PROVIDERS[i].equals(activeProvider))return i;
        return 0;
    }
    private Config readConfig(int provider){
        String prefix=PROVIDERS[provider]+".";
        String oldKey=provider==3?prefs.getString("key",""):"";
        int oldLanguage=provider==3?prefs.getInt("language",0):0;
        String model=prefs.getString(prefix+"model","");
        if(provider==3)model=SCRIBE_MODELS[scribeIndex(model)];
        return new Config(provider,prefs.getString(prefix+"key",oldKey),prefs.getString(prefix+"address",""),
            model,prefs.getString(prefix+"secretId",""),
            Math.max(0,Math.min(LANGS.length-1,prefs.getInt(prefix+"language",oldLanguage))));
    }
    private static int scribeIndex(String model){
        for(int i=0;i<SCRIBE_MODELS.length;i++)if(SCRIBE_MODELS[i].equals(model))return i;
        return DEFAULT_SCRIBE;
    }
    private static boolean validCredential(String value){
        return !value.isEmpty()&&value.length()<=512&&value.matches("[!-~]+");
    }
    private Spinner choices(String[] labels){
        Spinner field=new Spinner(host);
        ArrayAdapter<String> adapter=new ArrayAdapter<>(host,android.R.layout.simple_spinner_item,labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        field.setAdapter(adapter);
        return field;
    }
    private EditText textField(String hint,boolean secret){
        EditText field=new EditText(host);
        field.setSingleLine(true);field.setHint(hint);
        field.setInputType(InputType.TYPE_CLASS_TEXT|(secret?InputType.TYPE_TEXT_VARIATION_PASSWORD:InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS));
        return field;
    }
    private void showElevenKey(JavaScriptReplyProxy proxy,String id){
        if(keyDialog!=null){reply(proxy,id,PhoneService.json("ok",false,"why","ElevenLabs 設定已開啟"));return;}
        EditText key=textField("ElevenLabs API Key",true);
        key.setText(readConfig(3).key);
        keyDialog=new AlertDialog.Builder(host).setTitle("ElevenLabs 共用金鑰")
            .setMessage("語音轉文字和文字轉語音共用此金鑰。")
            .setView(key).setPositiveButton("保存",null).setNegativeButton("取消",null)
            .setOnDismissListener(d->{keyDialog=null;reply(proxy,id,PhoneService.json("ok",true));}).create();
        keyDialog.show();
        keyDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String value=key.getText().toString().trim();
            if(!validCredential(value)){key.setError("請輸入有效的 ElevenLabs API Key");return;}
            prefs.edit().putString("eleven.key",value).apply();
            keyDialog.dismiss();
        });
    }
    private void requestEleven(JavaScriptReplyProxy proxy,String id,String action,JSONObject request){
        String key=readConfig(3).key;
        if(!validCredential(key)){
            reply(proxy,id,PhoneService.json("ok",false,"why","請先設定 ElevenLabs 共用金鑰"));return;
        }
        voiceIo.execute(()->{
            JSONObject result;
            try{
                if("elevenVoices".equals(action)){
                    result=ElevenVoice.voices(key,request.optString("page"));
                }else{
                    byte[] audio=ElevenVoice.synthesize(key,request.optString("model"),request.optString("voice"),
                        request.optString("text").trim());
                    result=PhoneService.json("ok",true,"audio",Base64.getEncoder().encodeToString(audio));
                }
            }catch(IOException e){result=PhoneService.json("ok",false,"why",e.getMessage());}
            catch(Exception e){result=PhoneService.json("ok",false,"why","ElevenLabs 服務未返回可用結果");}
            JSONObject out=result;
            ui.post(()->reply(proxy,id,out));
        });
    }
    private void showSettings(){
        ScrollView scroll=new ScrollView(host);
        LinearLayout box=new LinearLayout(host);box.setOrientation(LinearLayout.VERTICAL);
        int pad=(int)(20*host.getResources().getDisplayMetrics().density);box.setPadding(pad,0,pad,pad);
        scroll.addView(box);
        TextView notice=new TextView(host);
        notice.setText("選擇供應商後保存。聊天錄音確認後送出；電話與視訊接通且麥克風開啟時，自動將說話片段送往同一接口。");
        box.addView(notice);
        Spinner provider=choices(PROVIDER_NAMES);provider.setContentDescription("辨識供應商");box.addView(provider);
        EditText address=textField("HTTPS 接口地址或 Base URL",false);
        EditText model=textField("轉寫模型名稱，例如 gpt-transcribe",false);
        EditText secretId=textField("騰訊雲 SecretId",false);
        EditText key=textField("API Key",true);
        box.addView(address);box.addView(model);box.addView(secretId);box.addView(key);
        Spinner scribe=choices(SCRIBE_LABELS);scribe.setContentDescription("ElevenLabs 辨識模型");box.addView(scribe);
        Spinner language=choices(LABELS);language.setContentDescription("辨識語言");box.addView(language);
        TextView status=new TextView(host);box.addView(status);
        provider.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
            @Override public void onItemSelected(AdapterView<?> parent,View view,int selected,long id){
                Config saved=readConfig(selected);
                address.setVisibility(selected==1?View.VISIBLE:View.GONE);address.setText(saved.address);
                model.setVisibility(selected==1?View.VISIBLE:View.GONE);model.setText(saved.model);
                secretId.setVisibility(selected==2?View.VISIBLE:View.GONE);secretId.setText(saved.secretId);
                key.setVisibility(selected==0?View.GONE:View.VISIBLE);key.setText(saved.key);
                key.setHint(selected==2?"騰訊雲 SecretKey":"API Key");
                scribe.setVisibility(selected==3?View.VISIBLE:View.GONE);
                scribe.setSelection(scribeIndex(saved.model));
                language.setVisibility(selected==0?View.GONE:View.VISIBLE);
                language.setSelection(saved.language);
                status.setText(selected==1?"接口需支援 /audio/transcriptions。選粵語時由接口自動辨識。"
                    :selected==2?"粵語可選專用模型，自動模式支援中英粵混說。"
                    :selected==3?"即時模型適用於電話與視訊。聊天錄音使用同版本的錄音轉寫。":"");
            }
            @Override public void onNothingSelected(AdapterView<?> parent){}
        });
        provider.setSelection(providerIndex());
        dialog=new AlertDialog.Builder(host).setTitle("語音轉文字設定").setView(scroll)
            .setNegativeButton("取消",(d,w)->cancelled("已取消"))
            .setNeutralButton("清除金鑰",(d,w)->{
                int selected=provider.getSelectedItemPosition();
                SharedPreferences.Editor changes=prefs.edit();
                if(selected>0){
                    changes.remove(PROVIDERS[selected]+".key");
                    if(selected==3)changes.remove("key");
                }
                if(selected==providerIndex())changes.remove("provider");
                changes.apply();finish(PhoneService.json("ok",true));
            })
            .setPositiveButton("保存",null).setOnCancelListener(d->cancelled("已取消")).create();
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            int selected=provider.getSelectedItemPosition();
            if(selected==0){
                prefs.edit().remove("provider").apply();
                dialog.dismiss();finish(PhoneService.json("ok",true));return;
            }
            Config config=new Config(selected,key.getText().toString().trim(),address.getText().toString().trim(),
                selected==3?SCRIBE_MODELS[scribe.getSelectedItemPosition()]:model.getText().toString().trim(),
                secretId.getText().toString().trim(),language.getSelectedItemPosition());
            try{config.validate();}
            catch(Exception e){status.setText(e.getMessage());return;}
            String prefix=PROVIDERS[selected]+".";
            prefs.edit().putString("provider",PROVIDERS[selected]).putString(prefix+"key",config.key)
                .putString(prefix+"address",config.address).putString(prefix+"model",config.model)
                .putString(prefix+"secretId",config.secretId).putInt(prefix+"language",config.language).apply();
            dialog.dismiss();finish(PhoneService.json("ok",true));
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
            if(active.call&&active.config.realtime()){
                Request req=active;
                realtime=new ElevenRealtimeInput(result->ui.post(()->{
                    if(active==req&&!req.cancelled)finish(result);
                }),text->ui.post(()->{
                    if(active==req&&!req.cancelled)reply(req.reply,req.id,PhoneService.json("partial",text));
                }));
                realtime.start(req.config.key,req.config.model,LANGS[req.config.language]);
                return;
            }
            audio=File.createTempFile("xa-stt-",".m4a",host.getCacheDir());
            recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);recorder.setAudioEncodingBitRate(64000);recorder.setAudioSamplingRate(active.config.provider==2?16000:44100);
            recorder.setOutputFile(audio.getAbsolutePath());recorder.prepare();recorder.start();
            if(active.call){
                callStarted=android.os.SystemClock.elapsedRealtime();callLastVoice=0;callVoiceFrames=0;
                ui.postDelayed(callVad,150);return;
            }
            dialog=new AlertDialog.Builder(host).setTitle("正在錄音…")
                .setMessage("最長 "+(active.config.limitMs()/1000)+" 秒。完成後會送到"+active.config.name()+"轉寫。")
                .setPositiveButton("完成並轉寫",(d,w)->submitRecording())
                .setNegativeButton("取消",(d,w)->discard("已取消錄音"))
                .setOnCancelListener(d->discard("已取消錄音")).create();
            dialog.show();ui.postDelayed(limit,active.config.limitMs());
        }catch(Exception e){
            releaseRecorder(false);deleteAudio();finish(PhoneService.json("ok",false,"why","無法啟動麥克風，請檢查權限或是否被其他 App 使用"));
        }
    }
    private long callStarted,callLastVoice;
    private int callVoiceFrames;
    private final Runnable callVad=this::pollCallVoice;
    private void pollCallVoice(){
        if(active==null||!active.call||recorder==null)return;
        long now=android.os.SystemClock.elapsedRealtime();
        try{
            int amp=recorder.getMaxAmplitude();
            if(amp>=900){callLastVoice=now;callVoiceFrames++;}
            boolean spoke=callVoiceFrames>=2;
            if(spoke&&(now-callLastVoice>=900||now-callStarted>=25000)){submitRecording();return;}
            if(!spoke&&now-callStarted>=12000){
                releaseRecorder(false);deleteAudio();finish(PhoneService.json("ok",true,"silence",true));return;
            }
            ui.postDelayed(callVad,150);
        }catch(RuntimeException e){
            releaseRecorder(false);deleteAudio();finish(PhoneService.json("ok",false,"why","通話錄音失敗"));
        }
    }
    private void cancelCall(){
        Request req=active;
        if(req==null||!req.call)return;
        req.cancelled=true;
        HttpsURLConnection c=connection;if(uploading&&c!=null)c.disconnect();
        discard("通話收音已停止");
    }
    private final Runnable limit=this::onLimit;
    private void onLimit(){
        if(recorder==null)return;
        boolean ok=releaseRecorder(true);
        if(dialog!=null)dialog.dismiss();
        if(!ok){deleteAudio();finish(PhoneService.json("ok",false,"why","錄音失敗"));return;}
        dialog=new AlertDialog.Builder(host).setTitle("已達錄音上限").setMessage("是否將這段錄音送出轉寫？")
            .setPositiveButton("轉寫",(d,w)->submitRecording())
            .setNegativeButton("取消",(d,w)->discard("已取消錄音"))
            .setOnCancelListener(d->discard("已取消錄音")).create();dialog.show();
    }
    private boolean releaseRecorder(boolean stop){
        ui.removeCallbacks(limit);ui.removeCallbacks(callVad);MediaRecorder r=recorder;recorder=null;
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
            try{if(req.cancelled)throw new IOException("已取消");result=PhoneService.json("ok",true,"text",transcribe(file,req.config,req));}
            catch(IOException e){result=PhoneService.json("ok",false,"why",e.getMessage());}
            catch(Exception e){result=PhoneService.json("ok",false,"why","轉寫失敗，請確認網路及 API 設定");}
            finally{file.delete();}
            final JSONObject out=result;
            ui.post(()->{if(!closed&&active==req)finish(out);});
        });
    }
    private static URL transcriptionEndpoint(String address)throws IOException{
        try{
            URI url=new URI(address);
            if(!"https".equalsIgnoreCase(url.getScheme())||url.getHost()==null||url.getUserInfo()!=null||url.getFragment()!=null||address.length()>2048)
                throw new IllegalArgumentException();
            String path=url.getRawPath().replaceFirst("/+$","");
            if(path.isEmpty())path="/v1/audio/transcriptions";
            else if(path.endsWith("/v1"))path+="/audio/transcriptions";
            else if(!path.endsWith("/audio/transcriptions"))return url.toURL();
            String query=url.getRawQuery()==null?"":"?"+url.getRawQuery();
            return new URL("https://"+url.getRawAuthority()+path+query);
        }catch(Exception e){throw new IOException("請填寫有效的 HTTPS 語音轉文字接口地址");}
    }
    private String transcribe(File file,Config config,Request req)throws Exception{
        boolean tencent=config.provider==2;
        if(file.length()>(tencent?3L:12L)*1024*1024)throw new IOException("錄音檔太大");
        URL endpoint=tencent?new URL("https://"+TENCENT_HOST+"/")
            :config.provider==3?new URL(ELEVEN_ENDPOINT):transcriptionEndpoint(config.address);
        HttpsURLConnection conn=(HttpsURLConnection)endpoint.openConnection();
        connection=conn;
        try{
            if(req.cancelled)throw new IOException("已取消");
            conn.setConnectTimeout(20000);conn.setReadTimeout(90000);conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("POST");conn.setDoOutput(true);conn.setRequestProperty("Accept","application/json");
            if(tencent)writeTencent(conn,file,config);
            else writeMultipart(conn,file,config);
            int code=conn.getResponseCode();
            if(code==401||code==403)throw new IOException(config.name()+" 憑證無效或沒有轉寫權限（HTTP "+code+"）");
            if(code==429)throw new IOException(config.name()+" 額度或請求頻率受限（HTTP 429）");
            if(code<200||code>=300)throw new IOException(config.name()+" 轉寫失敗（HTTP "+code+"）");
            try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>2*1024*1024)throw new IOException("轉寫回應過大");out.write(b,0,n);}
                JSONObject result=new JSONObject(out.toString("UTF-8"));
                String text;
                if(tencent){
                    JSONObject response=result.getJSONObject("Response");
                    if(response.has("Error")){
                        String errorCode=response.getJSONObject("Error").optString("Code");
                        throw new IOException("騰訊雲轉寫失敗（"+errorCode.replaceAll("[^A-Za-z0-9.]","")+"）");
                    }
                    text=response.optString("Result").trim();
                }else text=result.optString("text").trim();
                if(text.isEmpty())throw new IOException("未辨識到文字，請再試一次");
                if(text.length()>20000)throw new IOException("轉寫文字過長");
                return text;
            }
        }catch(java.net.SocketTimeoutException e){throw new IOException(config.name()+" 連線逾時，請檢查網路後重試");}
        catch(java.net.UnknownHostException e){throw new IOException("無法連線到"+config.name()+"，請檢查地址和網路");}
        finally{conn.disconnect();connection=null;}
    }
    private static void writeMultipart(HttpsURLConnection conn,File file,Config config)throws IOException{
        boolean eleven=config.provider==3;
        String boundary="xa-"+UUID.randomUUID();
        conn.setRequestProperty(eleven?"xi-api-key":"Authorization",eleven?config.key:"Bearer "+config.key);
        conn.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
        ByteArrayOutputStream headers=new ByteArrayOutputStream();
        if(eleven){
            field(headers,boundary,"model_id",config.batchModel());
            if(config.language!=0)field(headers,boundary,"language_code",LANGS[config.language]);
            field(headers,boundary,"tag_audio_events","false");
            field(headers,boundary,"timestamps_granularity","none");
        }else{
            field(headers,boundary,"model",config.model);
            if(config.language>=2)field(headers,boundary,"language",config.language==2?"zh":"en");
        }
        put(headers,"--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n");
        byte[] end=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(headers.size()+file.length()+end.length);
        try(OutputStream out=new BufferedOutputStream(conn.getOutputStream());InputStream in=new FileInputStream(file)){
            headers.writeTo(out);
            byte[] buf=new byte[16384];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);
            out.write(end);
        }
    }
    private static void writeTencent(HttpsURLConnection conn,File file,Config config)throws Exception{
        String[] engines={"16k_zh-PY","16k_yue","16k_zh","16k_en"};
        byte[] audio=Files.readAllBytes(file.toPath());
        byte[] body=new JSONObject().put("ProjectId",0).put("SubServiceType",2)
            .put("EngSerViceType",engines[config.language]).put("SourceType",1).put("VoiceFormat","m4a")
            .put("Data",Base64.getEncoder().encodeToString(audio)).put("DataLen",audio.length)
            .toString().getBytes(StandardCharsets.UTF_8);
        String type="application/json; charset=utf-8";
        String action="SentenceRecognition";
        Instant now=Instant.now();
        String scope=now.atOffset(ZoneOffset.UTC).toLocalDate()+"/asr/tc3_request";
        String canonical="POST\n/\n\ncontent-type:"+type+"\nhost:"+TENCENT_HOST+"\n\ncontent-type;host\n"+sha256(body);
        String sign="TC3-HMAC-SHA256\n"+now.getEpochSecond()+"\n"+scope+"\n"+sha256(canonical.getBytes(StandardCharsets.UTF_8));
        byte[] dateKey=hmac(("TC3"+config.key).getBytes(StandardCharsets.UTF_8),scope.substring(0,10));
        String signature=hex(hmac(hmac(hmac(dateKey,"asr"),"tc3_request"),sign));
        conn.setRequestProperty("Authorization","TC3-HMAC-SHA256 Credential="+config.secretId+"/"+scope+
            ", SignedHeaders=content-type;host, Signature="+signature);
        conn.setRequestProperty("Content-Type",type);
        conn.setRequestProperty("X-TC-Action",action);
        conn.setRequestProperty("X-TC-Version","2019-06-14");
        conn.setRequestProperty("X-TC-Timestamp",Long.toString(now.getEpochSecond()));
        conn.setFixedLengthStreamingMode(body.length);
        try(OutputStream out=conn.getOutputStream()){out.write(body);}
    }
    private static byte[] hmac(byte[] key,String value)throws Exception{
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));
        return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
    }
    private static String sha256(byte[] value)throws Exception{
        return hex(MessageDigest.getInstance("SHA-256").digest(value));
    }
    private static String hex(byte[] bytes){
        StringBuilder value=new StringBuilder(bytes.length*2);
        for(byte b:bytes)value.append(Character.forDigit((b>>4)&15,16)).append(Character.forDigit(b&15,16));
        return value.toString();
    }
    private static void put(OutputStream out,String s)throws IOException{out.write(s.getBytes(StandardCharsets.UTF_8));}
    private static void field(OutputStream out,String b,String k,String v)throws IOException{
        put(out,"--"+b+"\r\nContent-Disposition: form-data; name=\""+k+"\"\r\n\r\n"+v+"\r\n");
    }
    void onPause(){if(active!=null&&active.call&&!waitingPermission)cancelCall();else if(recorder!=null||audio!=null)discard("已離開錄音畫面，未傳送音訊");}
    void close(){
        closed=true;ui.removeCallbacks(limit);releaseRecorder(false);deleteAudio();
        if(realtime!=null){realtime.cancel();realtime=null;}
        if(keyDialog!=null){keyDialog.dismiss();keyDialog=null;}
        if(dialog!=null){dialog.dismiss();dialog=null;}
        HttpsURLConnection c=connection;if(c!=null)c.disconnect();
        io.shutdownNow();voiceIo.shutdownNow();active=null;
    }
}
