package com.xiaoai.phone;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** User-selected JSON backups, separate from the accessibility command channel. */
final class BackupFiles {
    private static final int SAVE=43;
    private static final long MAX_BYTES=128L*1024*1024;
    private final Activity activity;
    private File temp;
    private OutputStream out;
    private long bytes;
    private String filename;
    private boolean choosing;
    BackupFiles(Activity activity){this.activity=activity;}
    void installScript(WebView web){
        try(InputStream in=activity.getAssets().open("backup-bridge.js"); ByteArrayOutputStream buf=new ByteArrayOutputStream()){
            byte[] b=new byte[8192]; int n;
            while((n=in.read(b))!=-1)buf.write(b,0,n);
            web.evaluateJavascript(new String(buf.toByteArray(),StandardCharsets.UTF_8),null);
        }catch(IOException ignored){}
    }
    private void reply(JavaScriptReplyProxy proxy,String id,boolean ok,String why){
        try{proxy.postMessage(new JSONObject().put("id",id).put("ok",ok).put("why",why).toString());}catch(Exception ignored){}
    }
    void bind(WebView web,String origin){
        WebViewCompat.addWebMessageListener(web,"BackupNative",Collections.singleton(origin),(v,msg,source,main,proxy)->{
            if(!main||!origin.equals(source.toString()))return;
            String id="";
            try{
                String raw=msg.getData();
                if(raw==null||raw.length()>300000)throw new IOException("备份分块过大");
                JSONObject j=new JSONObject(raw);id=j.getString("id");
                switch(j.getString("action")){
                    case "begin":
                        if(choosing)throw new IOException("请先完成上一次保存");
                        clear();
                        filename=j.optString("name","小爱机备份.json").replaceAll("[/\\\\\\p{Cntrl}]","_");
                        if(!filename.endsWith(".json"))filename+=".json";
                        temp=File.createTempFile("backup-", ".json",activity.getCacheDir());
                        out=new BufferedOutputStream(new FileOutputStream(temp));
                        break;
                    case "chunk":
                        if(out==null)throw new IOException("备份尚未开始");
                        byte[] data=j.getString("text").getBytes(StandardCharsets.UTF_8);
                        if(bytes+data.length>MAX_BYTES)throw new IOException("备份超过128MB");
                        out.write(data);bytes+=data.length;
                        break;
                    case "finish":
                        if(out==null)throw new IOException("备份尚未开始");
                        out.close();out=null;
                        Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("application/json").putExtra(Intent.EXTRA_TITLE,filename);
                        activity.startActivityForResult(save,SAVE);choosing=true;
                        break;
                    case "cancel": if(!choosing)clear();break;
                    default: throw new IOException("未知备份操作");
                }
                reply(proxy,id,true,"");
            }catch(Exception e){if(!choosing||out!=null)clear();reply(proxy,id,false,e.getMessage()==null?"备份操作失败":e.getMessage());}
        });
    }
    boolean onResult(int request,int result,Intent data){
        if(request!=SAVE)return false;
        choosing=false;
        if(result!=Activity.RESULT_OK||data==null||data.getData()==null){clear();return true;}
        final Uri uri=data.getData(); final File input=temp;temp=null;bytes=0;
        if(input==null){notice("备份文件不存在");return true;}
        new Thread(()->{
            try(InputStream in=new FileInputStream(input);OutputStream dest=activity.getContentResolver().openOutputStream(uri,"wt")){
                if(dest==null)throw new IOException("无法打开目标文件");
                byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)dest.write(b,0,n);dest.flush();
                notice("备份已保存");
            }catch(Exception e){notice("保存备份失败："+e.getMessage());}
            finally{input.delete();}
        },"xiaoai-backup").start();
        return true;
    }
    private void notice(String text){activity.runOnUiThread(()->Toast.makeText(activity,text,Toast.LENGTH_LONG).show());}
    private void clear(){if(out!=null){try{out.close();}catch(IOException ignored){}out=null;}if(temp!=null){temp.delete();temp=null;}bytes=0;}
    void close(){clear();}
}
