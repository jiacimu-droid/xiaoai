package com.xiaoai.phone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.*;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net";
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private boolean resumed;
    private BackupFiles backupFiles;
    private boolean awaitingSettings;
    static volatile boolean enabled=false;
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        enabled=getPreferences(MODE_PRIVATE).getBoolean("role_phone_authorized",false);
        web=new WebView(this); setContentView(web);
        WebSettings s=web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        backupFiles=new BackupFiles(this);
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String url){
                super.onPageFinished(v,url);
                if((ORIGIN+"/assets/index.html").equals(url)) backupFiles.installScript(v);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
                if(!r.isForMainFrame())return false;
                Uri u=r.getUrl(); if(ORIGIN.equals(u.getScheme()+"://"+u.getHost())&&"/assets/index.html".equals(u.getPath()))return false;
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
            WebViewCompat.addWebMessageListener(web,"PhoneNative",Collections.singleton(ORIGIN),(view,msg,origin,main,reply)->{
                if(!main||!ORIGIN.equals(origin.toString()))return;
                try{
                    String raw=msg.getData(); if(raw==null||raw.length()>12000)return;
                    JSONObject req=new JSONObject(raw); String id=req.getString("id"); JSONObject command=req.getJSONObject("command");
                    java.util.function.Consumer<JSONObject> respond=r->runOnUiThread(()->{try{reply.postMessage(PhoneService.json("id",id,"result",r).toString());}catch(Exception ignored){}});
                    String action=command.optString("action");
                    if("status".equals(action)){respond.accept(status());return;}
                    if("disable".equals(action)){setAuthorized(false); if(PhoneService.instance!=null){PhoneService.instance.cancel();PhoneService.instance.disableSelf();}respond.accept(status());return;}
                    if("authorize".equals(action)){
                        if(!resumed){respond.accept(status());return;}
                        new AlertDialog.Builder(this).setTitle("授權無障礙")
                          .setMessage("允許角色操作你選擇的 App；畫面文字可能交給你設定的模型。")
                          .setPositiveButton("授權",(d,w)->{if(PhoneService.instance!=null){setAuthorized(true);}else{awaitingSettings=true;startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));}respond.accept(status());})
                          .setNegativeButton("取消",(d,w)->respond.accept(status())).setOnCancelListener(d->respond.accept(status())).show();return;
                    }
                    if(!enabled||PhoneService.instance==null){respond.accept(PhoneService.result(false,"請先授權無障礙", ""));return;}
                    if("cancel".equals(action)){PhoneService.instance.cancel();respond.accept(PhoneService.result(true,"已停止", ""));return;}
                    if("open_app".equals(action)){
                        if(!resumed){respond.accept(PhoneService.result(false,"請回到小愛機確認要開啟的 App", ""));return;}
                        PhoneService service=PhoneService.instance;
                        PhoneService.Target target=service.resolve(command.optString("app"));
                        if(target==null){respond.accept(PhoneService.result(false,"找不到可操作的 App", ""));return;}
                        new AlertDialog.Builder(this).setTitle("開啟 "+target.label+"？")
                         .setMessage("允許本次任務操作此 App 的可見畫面。")
                         .setPositiveButton("允許",(d,w)->service.launch(target,respond))
                         .setNegativeButton("取消",(d,w)->respond.accept(PhoneService.result(false,"使用者取消", "")))
                         .setOnCancelListener(d->respond.accept(PhoneService.result(false,"使用者取消", ""))).show();return;
                    }
                    PhoneService.instance.request(command,respond);
                }catch(Exception ignored){}
            });
        }
        web.loadUrl(ORIGIN+"/assets/index.html");
    }
    private void setAuthorized(boolean value){enabled=value;getPreferences(MODE_PRIVATE).edit().putBoolean("role_phone_authorized",value).apply();}
    private JSONObject status(){return PhoneService.json("ok",true,"enabled",enabled&&PhoneService.instance!=null,"connected",PhoneService.instance!=null);}
    @Override protected void onResume(){super.onResume();resumed=true;if(awaitingSettings){awaitingSettings=false;android.os.Handler handler=new android.os.Handler(getMainLooper());handler.postDelayed(()->{if(resumed&&PhoneService.instance!=null)setAuthorized(true);if(web!=null)web.evaluateJavascript("window.xaNativeRefresh&&window.xaNativeRefresh()",null);},700);}if(web!=null)web.evaluateJavascript("window.xaNativeRefresh&&window.xaNativeRefresh()",null);}
    @Override protected void onPause(){resumed=false;super.onPause();}
    @Override protected void onActivityResult(int r,int c,Intent d){super.onActivityResult(r,c,d);if(backupFiles!=null&&backupFiles.onResult(r,c,d))return;if(r==42&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(c,d));chooser=null;}}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){enabled=false;if(PhoneService.instance!=null)PhoneService.instance.cancel();if(backupFiles!=null)backupFiles.close();if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}if(web!=null)web.destroy();super.onDestroy();}
}
