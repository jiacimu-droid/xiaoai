package com.xiaoai.phone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Local-only Live2D model import/role binding. No private model or SDK is shipped. */
final class Live2DStore {
    private static final String ORIGIN="https://appassets.androidplatform.net";
    private static final int PICK_MODEL=8631,PICK_CORE=8632;
    private static final long MAX_ENTRY=70L*1024*1024,MAX_TOTAL=320L*1024*1024;
    private static final Set<String> TYPES=new HashSet<>(Arrays.asList("json","moc3","png","jpg","jpeg","webp","wav","mp3","ogg"));
    private final Activity host;
    private final File root;
    private final SharedPreferences prefs;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private Pending pending;
    private boolean installingCore;
    private static final String CORE_URL="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
    private static final String LICENSE_URL="https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_cn.html";
    private static final class Pending {
        final String id,role; final int request; final JavaScriptReplyProxy reply;
        Pending(String id,String role,int request,JavaScriptReplyProxy reply){this.id=id;this.role=role;this.request=request;this.reply=reply;}
    }
    Live2DStore(Activity host){
        this.host=host;root=new File(host.getFilesDir(),"live2d");root.mkdirs();
        prefs=host.getSharedPreferences("xa_live2d_bindings_v1",0);
    }
    void bind(WebView web){
        WebViewCompat.addWebMessageListener(web,"Live2DNative",Collections.singleton(ORIGIN),(view,message,origin,main,reply)->{
            if(!main||!ORIGIN.equals(origin.toString()))return;
            String id="";
            try {
                String raw=message.getData();
                if(raw==null||raw.length()>2048)return;
                JSONObject obj=new JSONObject(raw);id=obj.getString("id");
                String role=obj.optString("role","preview");
                if(role.isEmpty()||role.length()>200||id.length()>128)throw new IOException("角色識別資料不正確");
                String action=obj.optString("action");
                if("status".equals(action)){
                    final String rid=id;
                    io.execute(()->{try{respond(reply,rid,status(role));}catch(Exception e){respond(reply,rid,failure(e));}});
                    return;
                }
                if("install_core".equals(action)){
                    if(pending!=null||installingCore)throw new IOException("已有檔案處理中");
                    confirmOfficialCore(reply,id,role);return;
                }
                int request="pick_model".equals(action)?PICK_MODEL:"pick_core".equals(action)?PICK_CORE:0;
                if(request==0)throw new IOException("不支援的 Live2D 操作");
                if(pending!=null||installingCore)throw new IOException("已有檔案處理中");
                pending=new Pending(id,role,request,reply);
                try{
                    Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                    pick.setType("*/*");
                    pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try{host.startActivityForResult(pick,request);}
                    catch(ActivityNotFoundException unavailable){
                        Intent fallback=new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        host.startActivityForResult(fallback,request);
                    }
                }catch(Exception e){pending=null;throw e;}
            }catch(Exception e){respond(reply,id,failure(e));}
        });
    }
    void installScript(WebView web){
        web.evaluateJavascript("(function(){if(document.getElementById('xaLive2DEntryScript'))return;var s=document.createElement('script');s.id='xaLive2DEntryScript';s.src='/assets/live2d-entry.js';document.head.appendChild(s);})()",null);
    }
    boolean onResult(int request,int result,Intent data){
        if(request!=PICK_MODEL&&request!=PICK_CORE)return false;
        Pending p=pending;pending=null;
        if(p==null||p.request!=request)return true;
        Uri uri=data==null?null:data.getData();
        if(result!=Activity.RESULT_OK||uri==null){
            respond(p.reply,p.id,PhoneService.json("ok",false,"cancelled",true,"why","已取消"));return true;
        }
        io.execute(()->{
            try {
                if(request==PICK_CORE)importCore(uri);else importModel(p.role,uri);
                respond(p.reply,p.id,status(p.role));
            }catch(Exception|OutOfMemoryError e){respond(p.reply,p.id,failure(e));}
        });
        return true;
    }
    void close(){pending=null;io.shutdown();}
    private void respond(JavaScriptReplyProxy reply,String id,JSONObject result){
        host.runOnUiThread(()->{try{reply.postMessage(PhoneService.json("id",id,"result",result).toString());}catch(RuntimeException ignored){}});
    }
    private static JSONObject failure(Throwable error){
        String why=error.getMessage();
        if(why==null||why.isEmpty())why="Live2D 檔案處理失敗";
        return PhoneService.json("ok",false,"why",why.substring(0,Math.min(why.length(),250)));
    }
    private static String hexRole(String role)throws Exception{
        byte[] b=MessageDigest.getInstance("SHA-256").digest(role.getBytes(StandardCharsets.UTF_8));
        StringBuilder s=new StringBuilder();
        for(int i=0;i<16;i++)s.append(String.format(Locale.ROOT,"%02x",b[i]&255));
        return s.toString();
    }
    private static File relative(File base,String name)throws IOException{
        if(name==null||name.isEmpty()||name.startsWith("/")||name.contains("\\")||name.contains(":")||name.indexOf(0)>=0)
            throw new IOException("不安全的資源路徑");
        for(String part:name.split("/",-1))if(part.isEmpty()||part.equals(".")||part.equals(".."))throw new IOException("不安全的資源路徑");
        File f=new File(base,name).getCanonicalFile();
        if(!f.getPath().startsWith(base.getCanonicalPath()+File.separator))throw new IOException("資源路徑越界");
        return f;
    }
    private static File existing(File base,String name)throws IOException{
        File f=relative(base,name);
        if(!f.isFile())throw new IOException("模型缺少資源："+name);
        return f;
    }
    private static byte[] bytes(InputStream in,long max)throws IOException{
        try(InputStream src=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[16384];long n=0;int k;
            while((k=src.read(b))!=-1){n+=k;if(n>max)throw new IOException("檔案過大");out.write(b,0,k);}
            return out.toByteArray();
        }
    }
    private static JSONObject json(File f,long limit)throws Exception{
        if(f.length()>limit)throw new IOException("配置檔過大");
        return new JSONObject(new String(bytes(new FileInputStream(f),limit),StandardCharsets.UTF_8));
    }
    private static void write(File f,byte[] data)throws IOException{
        File parent=f.getParentFile();if(parent!=null&&!parent.isDirectory()&&!parent.mkdirs())throw new IOException("無法建立資料夾");
        try(FileOutputStream out=new FileOutputStream(f)){out.write(data);}
    }
    private static void delete(File f){File[] children=f.listFiles();if(children!=null)for(File c:children)delete(c);f.delete();}
    private static String ext(String n){int i=n.lastIndexOf('.');return i<0?"":n.substring(i+1).toLowerCase(Locale.ROOT);}
    private static String rel(File base,File f)throws IOException{
        return base.getCanonicalFile().toPath().relativize(f.getCanonicalFile().toPath()).toString().replace(File.separatorChar,'/');
    }
    private static void walk(File dir,List<File> list)throws IOException{
        File[] children=dir.listFiles();if(children==null)throw new IOException("無法讀取模型目錄");
        Arrays.sort(children,Comparator.comparing(File::getName));
        for(File c:children){if(c.isDirectory())walk(c,list);else list.add(c);}
    }
    private void importCore(Uri uri)throws Exception{
        InputStream in=host.getContentResolver().openInputStream(uri);
        if(in==null)throw new IOException("讀不到 Cubism Core");
        saveCore(bytes(in,12L*1024*1024));
    }
    private void confirmOfficialCore(JavaScriptReplyProxy reply,String id,String role){
        installingCore=true;
        try{
            new AlertDialog.Builder(host)
                .setTitle("安裝官方 Cubism Core")
                .setMessage("將從 Live2D 官方網站下載渲染核心到本機，不會上傳皮套。請先閱讀並同意 Live2D 專有軟體授權協議。")
                .setNeutralButton("查看授權",(dialog,which)->{
                    installingCore=false;
                    try{host.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(LICENSE_URL)));}catch(Exception ignored){}
                    respond(reply,id,PhoneService.json("ok",false,"cancelled",true,"why","閱讀授權後可重新安裝"));
                })
                .setNegativeButton("取消",(dialog,which)->{
                    installingCore=false;respond(reply,id,PhoneService.json("ok",false,"cancelled",true,"why","已取消"));
                })
                .setOnCancelListener(dialog->{
                    installingCore=false;respond(reply,id,PhoneService.json("ok",false,"cancelled",true,"why","已取消"));
                })
                .setPositiveButton("同意並安裝",(dialog,which)->io.execute(()->{
                    try{downloadOfficialCore();respond(reply,id,status(role));}
                    catch(Exception|OutOfMemoryError e){respond(reply,id,failure(e));}
                    finally{host.runOnUiThread(()->installingCore=false);}
                })).show();
        }catch(RuntimeException e){installingCore=false;respond(reply,id,failure(e));}
    }
    private void downloadOfficialCore()throws Exception{
        HttpsURLConnection connection=(HttpsURLConnection)new URL(CORE_URL).openConnection();
        try{
            connection.setConnectTimeout(20000);connection.setReadTimeout(45000);
            connection.setInstanceFollowRedirects(false);
            int code=connection.getResponseCode();
            if(code<200||code>=300)throw new IOException("官方 Core 下載失敗（HTTP "+code+"），可改用手動匯入");
            if(connection.getContentLengthLong()>12L*1024*1024)throw new IOException("官方 Core 檔案過大");
            saveCore(bytes(connection.getInputStream(),12L*1024*1024));
        }finally{connection.disconnect();}
    }
    private void saveCore(byte[] data)throws Exception{
        if(data.length<1000||!new String(data,StandardCharsets.UTF_8).contains("Live2DCubismCore"))
            throw new IOException("請選擇官方 Cubism SDK for Web 的 live2dcubismcore.min.js");
        File core=new File(root,"core/live2dcubismcore.min.js");
        File tmp=new File(root,"core/"+UUID.randomUUID()+".tmp");
        try{write(tmp,data);Files.move(tmp.toPath(),core.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}
        finally{tmp.delete();}
    }
    private void importModel(String role,Uri uri)throws Exception{
        String key=hexRole(role),stamp=UUID.randomUUID().toString();
        File staging=new File(root,"stage-"+stamp),dest=new File(root,"models/"+key+"/"+stamp);
        if(!staging.mkdirs())throw new IOException("無法建立暫存資料夾");
        boolean committed=false;
        try{
            InputStream source=host.getContentResolver().openInputStream(uri);
            if(source==null)throw new IOException("讀不到模型 ZIP");
            try(ZipInputStream zip=new ZipInputStream(new BufferedInputStream(source))){
                ZipEntry e;int entries=0;long total=0;byte[] buffer=new byte[16384];
                Set<String> seen=new HashSet<>();
                while((e=zip.getNextEntry())!=null){
                    if(++entries>3000)throw new IOException("ZIP 檔案數量過多");
                    String name=e.getName().replace('\\','/');
                    while(name.startsWith("./"))name=name.substring(2);
                    while(name.endsWith("/"))name=name.substring(0,name.length()-1);
                    if(e.isDirectory()&&(name.isEmpty()||".".equals(name))){zip.closeEntry();continue;}
                    File f=relative(staging,name);
                    if(e.isDirectory()){if(!f.isDirectory()&&!f.mkdirs())throw new IOException("無法建立模型資料夾");}
                    else{
                        if(!seen.add(f.getCanonicalPath()))throw new IOException("ZIP 含重複檔案");
                        String leaf=f.getName();
                        boolean allowed=TYPES.contains(ext(name))&&!name.startsWith("__MACOSX/")&&!leaf.startsWith("._");
                        if(allowed&&!f.getParentFile().isDirectory()&&!f.getParentFile().mkdirs())throw new IOException("無法建立模型資料夾");
                        long count=0;int n;
                        try(OutputStream out=allowed?new FileOutputStream(f):null){
                            while((n=zip.read(buffer))!=-1){
                                count+=n;total+=n;
                                if(count>MAX_ENTRY||total>MAX_TOTAL)throw new IOException("ZIP 解壓超出安全容量");
                                if(out!=null)out.write(buffer,0,n);
                            }
                        }
                    }
                    zip.closeEntry();
                }
            }
            List<File> files=new ArrayList<>();walk(staging,files);
            List<File> settings=new ArrayList<>();
            for(File f:files)if(f.getName().toLowerCase(Locale.ROOT).endsWith(".model3.json"))settings.add(f);
            if(settings.size()!=1)throw new IOException("ZIP 必須恰好包含一個 model3.json");
            File model=settings.get(0);JSONObject manifest=normalize(model);
            File sidecar=new File(model.getParentFile(),model.getName()+".xa-manifest.json");
            write(sidecar,manifest.toString().getBytes(StandardCharsets.UTF_8));
            String relative="models/"+key+"/"+stamp+"/"+rel(staging,model);
            if(!dest.getParentFile().isDirectory()&&!dest.getParentFile().mkdirs())throw new IOException("無法儲存模型");
            if(!staging.renameTo(dest))throw new IOException("無法提交模型");
            if(!prefs.edit().putString(key,relative).commit())throw new IOException("無法保存角色模型綁定");
            committed=true;
        }finally{delete(staging);if(!committed)delete(dest);}
    }
    private static JSONObject normalize(File model)throws Exception{
        File base=model.getParentFile();
        JSONObject manifest=json(model,2L*1024*1024),refs=manifest.getJSONObject("FileReferences");
        manifest.remove("luluResolvedRigProfiles");
        if(manifest.has("LuluRigProfile")){
            JSONObject desc=manifest.getJSONObject("LuluRigProfile"),profiles=new JSONObject();
            if(desc.getInt("version")!=1)throw new IOException("不支援的皮套調校配置版本");
            for(String k:new String[]{"rig","interaction"}){
                if(!desc.has(k))continue;
                File file=existing(base,desc.getString(k));
                if(!"json".equals(ext(file.getName())))throw new IOException("皮套調校配置必須為 JSON");
                JSONObject p=json(file,262144);
                if(p.getInt("schemaVersion")!=1)throw new IOException("不支援的皮套調校配置版本");
                profiles.put(k,p);
            }
            if(!profiles.has("rig"))throw new IOException("缺少骨架調校配置");
            manifest.put("luluResolvedRigProfiles",profiles);
        }
        existing(base,refs.getString("Moc"));
        JSONArray textures=refs.getJSONArray("Textures");
        if(textures.length()<1)throw new IOException("模型缺少貼圖");
        for(int i=0;i<textures.length();i++){
            File original=existing(base,textures.getString(i));
            BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
            BitmapFactory.decodeFile(original.getPath(),bounds);
            if(bounds.outWidth<=0||bounds.outHeight<=0||Math.max(bounds.outWidth,bounds.outHeight)>32768)throw new IOException("貼圖尺寸不正確");
            int max=Math.max(bounds.outWidth,bounds.outHeight);
            if(max>4096){
                BitmapFactory.Options op=new BitmapFactory.Options();op.inSampleSize=1;
                while((max+op.inSampleSize-1)/op.inSampleSize>4096)op.inSampleSize*=2;
                Bitmap bmp=BitmapFactory.decodeFile(original.getPath(),op);
                if(bmp==null)throw new IOException("手機無法解碼貼圖");
                File optimized=new File(original.getParentFile(),".xa-"+UUID.randomUUID()+".png");
                try(FileOutputStream out=new FileOutputStream(optimized)){
                    if(!bmp.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("無法優化貼圖");
                }finally{bmp.recycle();}
                textures.put(i,rel(base,optimized));
            }
        }
        for(String key:new String[]{"Physics","Pose","UserData","DisplayInfo"}){
            if(refs.isNull(key))refs.remove(key);
            else if(refs.has(key)&&!refs.optString(key).isEmpty())existing(base,refs.getString(key));
        }
        JSONArray expressions=refs.optJSONArray("Expressions");if(expressions==null)expressions=new JSONArray();
        JSONObject motions=refs.optJSONObject("Motions");if(motions==null)motions=new JSONObject();
        Set<String> seenExp=new HashSet<>(),seenMotion=new HashSet<>(),names=new HashSet<>();
        for(int i=0;i<expressions.length();i++){
            JSONObject e=expressions.getJSONObject(i);
            seenExp.add(existing(base,e.getString("File")).getCanonicalPath());names.add(e.getString("Name"));
        }
        Iterator<String> groups=motions.keys();
        while(groups.hasNext()){
            JSONArray a=motions.getJSONArray(groups.next());
            for(int i=0;i<a.length();i++){
                JSONObject e=a.getJSONObject(i);
                seenMotion.add(existing(base,e.getString("File")).getCanonicalPath());
                if(!e.optString("Sound").isEmpty())existing(base,e.getString("Sound"));
            }
        }
        List<File> files=new ArrayList<>();walk(base,files);
        JSONArray discovered=motions.optJSONArray("Lulu");if(discovered==null)discovered=new JSONArray();
        for(File f:files){
            String n=f.getName().toLowerCase(Locale.ROOT),file=rel(base,f);
            if(n.endsWith(".exp3.json")&&seenExp.add(f.getCanonicalPath())){
                String name=f.getName().substring(0,f.getName().length()-10);
                if(!names.add(name))name=file.substring(0,file.length()-10);
                expressions.put(new JSONObject().put("Name",name).put("File",file));
            }
            if(n.endsWith(".motion3.json")&&seenMotion.add(f.getCanonicalPath()))discovered.put(new JSONObject().put("File",file));
        }
        if(discovered.length()>0)motions.put("Lulu",discovered);
        if(expressions.length()>0)refs.put("Expressions",expressions);
        if(motions.length()>0)refs.put("Motions",motions);
        return manifest;
    }
    private static String url(String relative){
        StringBuilder s=new StringBuilder("https://live2d.xiaoai.invalid/private/");
        String[] parts=relative.split("/");
        for(int i=0;i<parts.length;i++){if(i>0)s.append('/');s.append(Uri.encode(parts[i]));}
        return s.toString();
    }
    private JSONObject status(String role)throws Exception{
        JSONObject out=new JSONObject().put("ok",true).put("core",new File(root,"core/live2dcubismcore.min.js").isFile());
        String relative=prefs.getString(hexRole(role),"");
        if(relative.isEmpty())return out.put("model","").put("motions",new JSONArray()).put("expressions",new JSONArray());
        File f=existing(root,relative);
        JSONObject manifest=json(new File(f.getParentFile(),f.getName()+".xa-manifest.json"),4L*1024*1024);
        JSONObject refs=manifest.getJSONObject("FileReferences"),groups=refs.optJSONObject("Motions");
        JSONObject profiles=manifest.optJSONObject("luluResolvedRigProfiles");
        JSONObject rig=profiles==null?null:profiles.optJSONObject("rig");
        JSONArray catalog=rig==null?null:rig.optJSONArray("motionCatalog"),motions=new JSONArray(),expressions=new JSONArray();
        if(groups!=null){
            Iterator<String> names=groups.keys();while(names.hasNext()){
                String group=names.next();JSONArray clips=groups.getJSONArray(group);
                for(int i=0;i<clips.length();i++){
                    String file=clips.getJSONObject(i).getString("File");
                    String name=file.substring(file.lastIndexOf('/')+1).replace(".motion3.json","");
                    JSONObject entry=new JSONObject().put("group",group).put("index",i).put("name",name);
                    if(catalog!=null&&group.equals(rig.optString("motionGroup")))for(int j=0;j<catalog.length();j++){
                        JSONObject item=catalog.optJSONObject(j);
                        if(item!=null&&item.optInt("index",-1)==i&&file.equals(item.optString("file"))){
                            for(String k:new String[]{"name","fits","expression","face"})if(item.has(k))entry.put(k,item.get(k));
                            break;
                        }
                    }
                    motions.put(entry);
                }
            }
        }
        JSONArray ex=refs.optJSONArray("Expressions");
        if(ex!=null)for(int i=0;i<ex.length();i++)expressions.put(ex.getJSONObject(i).getString("Name"));
        return out.put("model",url(relative)).put("label",f.getName().replace(".model3.json","")).put("motions",motions).put("expressions",expressions);
    }
    WebResourceResponse serve(String name){
        try{
            if(name==null||(!name.startsWith("models/")&&!"core/live2dcubismcore.min.js".equals(name)))return denied();
            File f=existing(root,name);
            if(name.toLowerCase(Locale.ROOT).endsWith(".model3.json"))
                f=existing(f.getParentFile(),f.getName()+".xa-manifest.json");
            String suffix=ext(f.getName());
            String mime;
            switch(suffix){
                case "json":mime="application/json";break;case "js":mime="application/javascript";break;
                case "png":mime="image/png";break;case "jpg":case "jpeg":mime="image/jpeg";break;
                case "webp":mime="image/webp";break;case "moc3":mime="application/octet-stream";break;
                case "wav":mime="audio/wav";break;case "mp3":mime="audio/mpeg";break;case "ogg":mime="audio/ogg";break;
                default:return denied();
            }
            return new WebResourceResponse(mime,("json".equals(suffix)||"js".equals(suffix))?"UTF-8":null,200,"OK",
                Collections.singletonMap("Cache-Control","no-store"),new FileInputStream(f));
        }catch(Exception e){return denied();}
    }
    private static WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
}
