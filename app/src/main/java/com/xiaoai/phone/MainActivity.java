package com.xiaoai.phone;

import android.app.Activity;
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
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
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
                    PhoneService service=PhoneService.instance;
                    if("disable".equals(action)){
                        if(service!=null)service.revoke();
                        respond.accept(PhoneService.json("ok",true,"enabled",false,"connected",false));return;
                    }
                    if("authorize".equals(action)){
                        if(resumed&&service==null)startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                        respond.accept(status());return;
                    }
                    if(service==null){respond.accept(PhoneService.result(false,"請先授權無障礙", ""));return;}
                    if("cancel".equals(action)){service.cancel();respond.accept(PhoneService.result(true,"已停止", ""));return;}
                    if("open_app".equals(action)){
                        if(!resumed&&!service.hasTargetOnScreen()){respond.accept(PhoneService.result(false,"請回到小愛機，或切回此任務正在操作的 App", ""));return;}
                        PhoneService.Target target=service.resolve(command.optString("app"));
                        if(target==null){respond.accept(PhoneService.result(false,"找不到可操作的 App", ""));return;}
                        service.launch(target,respond);return;
                    }
                    service.request(command,respond);
                }catch(Exception ignored){}
            });
        }
        web.loadUrl(ORIGIN+"/assets/index.html");
    }
    private JSONObject status(){boolean connected=PhoneService.instance!=null;return PhoneService.json("ok",true,"enabled",connected,"connected",connected);}
    @Override protected void onResume(){super.onResume();resumed=true;if(web!=null)web.evaluateJavascript("window.xaNativeRefresh&&window.xaNativeRefresh()",null);}
    @Override protected void onPause(){resumed=false;super.onPause();}
    @Override protected void onActivityResult(int r,int c,Intent d){super.onActivityResult(r,c,d);if(backupFiles!=null&&backupFiles.onResult(r,c,d))return;if(r==42&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(c,d));chooser=null;}}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(PhoneService.instance!=null)PhoneService.instance.cancel();if(backupFiles!=null)backupFiles.close();if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}if(web!=null)web.destroy();super.onDestroy();}
}
