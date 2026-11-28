package com.xiaoai.phone;

import android.app.Activity;
import android.content.Intent;
import android.database.ContentObserver;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.*;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Collections;
import java.util.Locale;
import java.util.TreeSet;

public final class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net";
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private boolean resumed;
    private BackupFiles backupFiles;
    private Live2DStore live2d;
    private SpeechInput speechInput;
    private static final String STAGE_HOST="live2d.xiaoai.invalid";
    private static WebResourceResponse notFound(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new java.io.ByteArrayInputStream(new byte[0]));}
    private JavaScriptReplyProxy statusReply;
    private long statusRevision;
    private final Handler statusHandler=new Handler(Looper.getMainLooper());
    private final Runnable refreshStatus=()->{if(resumed)publishStatus();};
    private final Runnable connectionListener=this::publishStatus;
    private final ContentObserver grantObserver=new ContentObserver(new Handler(Looper.getMainLooper())){
        @Override public void onChange(boolean selfChange){publishStatus();}
    };
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        web=new WebView(this); setContentView(web);
        WebSettings s=web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        backupFiles=new BackupFiles(this);
        live2d=new Live2DStore(this);
        speechInput=new SpeechInput(this);
        WebViewAssetLoader.AssetsPathHandler stageAssets=new WebViewAssetLoader.AssetsPathHandler(this);
        WebViewAssetLoader stageLoader=new WebViewAssetLoader.Builder().setDomain(STAGE_HOST)
            .addPathHandler("/assets/live2d/",path->java.util.Arrays.asList("stage.html","bootstrap.js","renderer.js","host.js").contains(path)?stageAssets.handle("live2d/"+path):notFound())
            .addPathHandler("/private/",live2d::serve).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap favicon){
                statusReply=null;
                super.onPageStarted(v,url,favicon);
            }
            @Override public void onPageFinished(WebView v,String url){
                super.onPageFinished(v,url);
                if((ORIGIN+"/assets/index.html").equals(url)){backupFiles.installScript(v);live2d.installScript(v);speechInput.installScript(v); }
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r){if(STAGE_HOST.equals(r.getUrl().getHost())){WebResourceResponse response=stageLoader.shouldInterceptRequest(r.getUrl());return response!=null?response:notFound();}return loader.shouldInterceptRequest(r.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
                if(!r.isForMainFrame())return false;
                Uri u=r.getUrl();
                if(isAppOrigin(u)&&"/accessibility-diagnostics".equals(u.getPath())){
                    startActivity(new Intent(MainActivity.this,AccessibilityDiagnosticsActivity.class)
                            .putExtra("page_reported",statusReply!=null));
                    return true;
                }
                if(isAppOrigin(u)&&"/assets/index.html".equals(u.getPath()))return false;
                if("https".equals(u.getScheme())||"http".equals(u.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView w,ValueCallback<Uri[]> cb,FileChooserParams p){
                if(chooser!=null)chooser.onReceiveValue(null); chooser=cb;
                try{startActivityForResult(p.createIntent(),42);return true;}catch(Exception e){chooser=null;cb.onReceiveValue(null);return true;}
            }
        });
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            backupFiles.bind(web,ORIGIN);
            live2d.bind(web);
            speechInput.bind(web,ORIGIN);
            WebViewCompat.addWebMessageListener(web,"PhoneNative",Collections.singleton(ORIGIN),(view,msg,origin,main,reply)->{
                if(!main||!isAppOrigin(origin))return;
                String requestId=null;
                try{
                    String raw=msg.getData(); if(raw==null||raw.length()>12000)return;
                    JSONObject req=new JSONObject(raw); String id=req.getString("id"); requestId=id; JSONObject command=req.getJSONObject("command");
                    java.util.function.Consumer<JSONObject> respond=r->runOnUiThread(()->{try{reply.postMessage(PhoneService.json("id",id,"result",r).toString());}catch(Exception ignored){}});
                    String action=command.optString("action");
                    if("status".equals(action)){statusReply=reply;respond.accept(status());return;}
                    if("accessibility_diagnostics_report".equals(action)){
                        respond.accept(PhoneService.json("ok",true,"report",AccessibilityDiagnostics.report(this,true,statusReply!=null)));
                        return;
                    }
                    if("app_lock_palette".equals(action)){
                        AppLocks.savePalette(this,command);respond.accept(PhoneService.result(true,"",""));return;
                    }
                    if("list_launchable_apps".equals(action)){respond.accept(listLaunchable(command.optString("filter"),command.optInt("limit",80)));return;}
                    if("app_lock_events".equals(action)){respond.accept(PhoneService.json("ok",true,"why","已讀取攔截紀錄","events",AppLocks.events(this)));return;}
                    if("notify_status".equals(action)){respond.accept(Notifier.status(this));return;}
                    if("notify_post".equals(action)){respond.accept(postNotify(command));return;}
                    if("notify_clear".equals(action)){Notifier.clear(this);respond.accept(PhoneService.result(true,"已清空通知欄",""));return;}
                    if("notify_permission".equals(action)){
                        if(!resumed){respond.accept(PhoneService.result(false,"請先回到小愛機再請求通知權限",""));return;}
                        Notifier.requestPermission(this);respond.accept(Notifier.status(this));return;
                    }
                    PhoneService service=PhoneService.instance;
                    if("disable".equals(action)){
                        if(service!=null)service.revoke();
                        respond.accept(status());return;
                    }
                    if("authorize".equals(action)){
                        if(resumed){
                            try{startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));}
                            catch(android.content.ActivityNotFoundException e){
                                respond.accept(PhoneService.result(false,"無法打開系統無障礙設置", ""));return;
                            }
                        }
                        respond.accept(status());return;
                    }
                    if(service==null){
                        int grant=AccessibilityGrant.inspect(this).state();
                        String why=grant==GrantEvidence.YES
                                ?"系統已授權，無障礙服務未連接。可在設置查看「連接診斷」。"
                                :grant==GrantEvidence.UNKNOWN
                                ?"無法確認系統授權，請查看「連接診斷」，並非已確認未授權。"
                                :"系統未檢測到小愛機的授權，請查看「連接診斷」或系統設置。";
                        respond.accept(PhoneService.result(false,why,""));return;
                    }
                    if("cancel".equals(action)){service.cancel();respond.accept(PhoneService.result(true,"已停止", ""));return;}
                    if("lock_app".equals(action)||"unlock_app".equals(action)||"app_locks".equals(action)||"clear_app_locks".equals(action)){
                        if(!resumed){respond.accept(PhoneService.result(false,"请回到小爱机管理应用锁",""));return;}
                        respond.accept(service.appLockCommand(command));return;
                    }
                    if("open_app".equals(action)){
                        if(!resumed&&!service.hasTargetOnScreen()){respond.accept(PhoneService.result(false,"請回到小愛機，或切回此任務正在操作的 App", ""));return;}
                        PhoneService.Target target=service.resolve(command.optString("app"));
                        if(target==null){respond.accept(PhoneService.result(false,"找不到可操作的 App", ""));return;}
                        service.launch(target,respond);return;
                    }
                    service.request(command,respond);
                }catch(RuntimeException | org.json.JSONException | LinkageError error){
                    AccessibilityDiagnostics.fault(this,"原生橋接命令處理",error);
                    if(requestId!=null){
                        try{reply.postMessage(PhoneService.json("id",requestId,"result",PhoneService.result(false,"原生橋接異常，請匯出連接診斷","")).toString());}
                        catch(RuntimeException ignored){}
                    }
                }
            });
        }
        try {
            getContentResolver().registerContentObserver(
                    Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),false,grantObserver);
            getContentResolver().registerContentObserver(
                    Settings.Secure.getUriFor(Settings.Secure.ACCESSIBILITY_ENABLED),false,grantObserver);
        } catch(RuntimeException error){AccessibilityDiagnostics.fault(this,"監聽無障礙授權",error);}
        PhoneService.addConnectionListener(connectionListener);
        Notifier.ensure(this);
        // Android 13+ needs a runtime grant before the tray can carry anything.
        if(!Notifier.granted(this))Notifier.requestPermission(this);
        web.loadUrl(ORIGIN+"/assets/index.html");
    }
    private JSONObject postNotify(JSONObject command){
        String kind=command.optString("kind");
        String channel="lock".equals(kind)||"guard".equals(kind)?Notifier.CHANNEL_GUARD:Notifier.CHANNEL_MSG;
        String fault=Notifier.post(this,channel,command.optString("title"),command.optString("body"));
        if(fault.isEmpty())return PhoneService.result(true,"已送出系統通知","");
        return PhoneService.json("ok",false,"need_permission","no_perm".equals(fault),"why","通知發不出去（"+fault+"）","screen","");
    }

    /** Launchable, non-system apps the page may offer for locking. Read-only, no service needed. */
    private JSONObject listLaunchable(String filter,int limit){
        int cap=(limit<1||limit>120)?80:limit;
        String want=filter==null?"":filter.trim().toLowerCase(Locale.ROOT);
        java.util.List<android.content.pm.ResolveInfo> found;
        try{
            found=getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0);
        }catch(RuntimeException | LinkageError bad){
            AccessibilityDiagnostics.fault(this,"讀取已安裝 App",bad);
            return PhoneService.result(false,"讀不到已安裝的 App 清單","");
        }
        android.content.pm.PackageManager pm=getPackageManager();
        TreeSet<String> seen=new TreeSet<>();
        JSONArray apps=new JSONArray();
        int total=0;
        for(android.content.pm.ResolveInfo r:found){
            String pkg=r.activityInfo==null?"":r.activityInfo.packageName;
            if(pkg.isEmpty()||!seen.add(pkg))continue;
            String label="";
            try{label=r.loadLabel(pm).toString().trim();}catch(RuntimeException | LinkageError ignored){}
            if(label.isEmpty())label=pkg;
            String hay=(label+" "+pkg).toLowerCase(Locale.ROOT);
            if(!want.isEmpty()&&!hay.contains(want))continue;
            total++;
            if(apps.length()>=cap)continue;
            if(label.length()>24)label=label.substring(0,24)+"…";
            apps.put(PhoneService.json("pkg",pkg,"label",label,"lockable",AppLocks.lockable(this,pkg)));
        }
        return PhoneService.json("ok",true,"why","已列出 App","apps",apps,"total",total,"limit",cap);
    }

    private boolean isAppOrigin(Uri origin){
        int port=origin.getPort();
        return "https".equals(origin.getScheme())&&"appassets.androidplatform.net".equals(origin.getHost())
                &&origin.getUserInfo()==null&&(port==-1||port==443);
    }
    private JSONObject status(){
        boolean connected=PhoneService.instance!=null;
        AccessibilityGrant.Snapshot grant=AccessibilityGrant.inspect(this);
        int state=connected?GrantEvidence.YES:grant.state();
        return PhoneService.json("ok",true,"enabled",state==GrantEvidence.YES,"grantKnown",state!=GrantEvidence.UNKNOWN,
                "grantConflict",grant.conflict(),"connected",connected,"revision",++statusRevision);
    }
    private void publishStatus(){
        if(statusReply==null)return;
        try{statusReply.postMessage(PhoneService.json("event","accessibility_status","result",status()).toString());}
        catch(RuntimeException error){statusReply=null;AccessibilityDiagnostics.fault(this,"網頁狀態推送",error);}
    }
    @Override protected void onResume(){
        super.onResume();resumed=true;publishStatus();
        // Huawei's permission UI may return before the service binding finishes.
        // Recheck briefly; never treat a settings grant as a real connection.
        statusHandler.removeCallbacks(refreshStatus);
        for(long delay:new long[]{250,750,1500,3000,6000})statusHandler.postDelayed(refreshStatus,delay);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(speechInput!=null)speechInput.onPermissionResult(request);}
    @Override protected void onPause(){if(speechInput!=null)speechInput.onPause();resumed=false;statusHandler.removeCallbacks(refreshStatus);super.onPause();}
    @Override protected void onActivityResult(int r,int c,Intent d){super.onActivityResult(r,c,d);if(live2d!=null&&live2d.onResult(r,c,d))return;if(backupFiles!=null&&backupFiles.onResult(r,c,d))return;if(r==42&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(c,d));chooser=null;}}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){
        statusHandler.removeCallbacks(refreshStatus);
        PhoneService.removeConnectionListener(connectionListener);
        getContentResolver().unregisterContentObserver(grantObserver);
        statusReply=null;
        if(PhoneService.instance!=null)PhoneService.instance.cancel();
        if(backupFiles!=null)backupFiles.close();
        if(live2d!=null)live2d.close();
        if(speechInput!=null)speechInput.close();
        if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}
        if(web!=null)web.destroy();
        super.onDestroy();
    }
}
