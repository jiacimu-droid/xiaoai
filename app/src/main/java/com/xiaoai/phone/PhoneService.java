package com.xiaoai.phone;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.WindowManager;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONObject;
import java.util.*;
import java.util.function.Consumer;

/** Foreground-only, user-approved target. No persistent screen collection. */
public final class PhoneService extends AccessibilityService {
    static volatile PhoneService instance;
    private final Handler h=new Handler(Looper.getMainLooper());
    private String allowed=""; private long until=0, generation=0, observedAt=0;
    private boolean busy=false;
    static JSONObject json(Object... kv){JSONObject o=new JSONObject();try{for(int i=0;i<kv.length;i+=2)o.put((String)kv[i],kv[i+1]);}catch(Exception ignored){}return o;}
    static JSONObject result(boolean ok,String why,String screen){return json("ok",ok,"why",why,"screen",screen);}
    @Override protected void onServiceConnected(){instance=this;}
    @Override public void onAccessibilityEvent(AccessibilityEvent e){}
    @Override public void onInterrupt(){cancel();}
    @Override public boolean onUnbind(Intent i){cancel();instance=null;MainActivity.enabled=false;return super.onUnbind(i);}
    @Override public void onDestroy(){cancel();if(instance==this)instance=null;MainActivity.enabled=false;super.onDestroy();}
    void cancel(){generation++;allowed="";until=0;observedAt=0;busy=false;}
    static final class Target {final String pkg,label;Target(String p,String l){pkg=p;label=l;}}
    private boolean blockedPackage(String p){return p==null||p.isEmpty()||p.equals(getPackageName())||p.startsWith("com.android.")||p.startsWith("com.google.android.permissioncontroller")||p.contains("bank")||p.contains("alipay")||p.contains("wallet")||p.contains("password")||p.contains("authenticator");}
    Target resolve(String name){
        if(name==null||name.trim().isEmpty())return null;String n=name.trim();
        Map<String,String> aliases=new HashMap<>();aliases.put("微信","com.tencent.mm");aliases.put("wechat","com.tencent.mm");aliases.put("qq","com.tencent.mobileqq");aliases.put("抖音","com.ss.android.ugc.aweme");aliases.put("小紅書","com.xingin.xhs");aliases.put("小红书","com.xingin.xhs");aliases.put("拼多多","com.xunmeng.pinduoduo");aliases.put("b站","tv.danmaku.bili");
        String wanted=aliases.getOrDefault(n.toLowerCase(Locale.ROOT),n);Target found=null;
        Intent i=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        for(ResolveInfo ri:getPackageManager().queryIntentActivities(i,0)){
            String p=ri.activityInfo.packageName,l=ri.loadLabel(getPackageManager()).toString();
            if(!blockedPackage(p)&&(p.equalsIgnoreCase(wanted)||l.equalsIgnoreCase(wanted))){if(found!=null&&!found.pkg.equals(p))return null;found=new Target(p,l);}
        }return found;
    }
    void launch(Target t,Consumer<JSONObject> cb){
        cancel();if(!MainActivity.enabled||locked()){cb.accept(result(false,"無障礙已關閉或手機已鎖定",""));return;}
        Intent i=getPackageManager().getLaunchIntentForPackage(t.pkg);if(i==null){cb.accept(result(false,"無法開啟 App",""));return;}
        allowed=t.pkg;until=SystemClock.elapsedRealtime()+180000;long g=generation;busy=true;
        try{startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}catch(Exception e){cancel();cb.accept(result(false,"Android 拒絕啟動",""));return;}
        h.postDelayed(()->waitForLaunch(g,cb,0),500);
    }
    private void waitForLaunch(long g,Consumer<JSONObject> cb,int attempt){
        if(g!=generation){cb.accept(result(false,"任务已停止",""));return;}
        if(root()!=null){finish(g,cb,true,"已观察到目标 App");return;}
        if(attempt>=12){finish(g,cb,false,"未观察到目标 App，请检查手机前台");return;}
        h.postDelayed(()->waitForLaunch(g,cb,attempt+1),500);
    }
    private boolean locked(){KeyguardManager k=getSystemService(KeyguardManager.class);return k!=null&&k.isDeviceLocked();}
    private AccessibilityNodeInfo root(){
        if(!MainActivity.enabled||locked()||SystemClock.elapsedRealtime()>until||allowed.isEmpty())return null;
        AccessibilityNodeInfo r=getRootInActiveWindow();if(r==null)return null;
        if(r.getPackageName()==null||!allowed.contentEquals(r.getPackageName()))return null;
        if(sensitive(r,0,new int[]{0}))return null;
        return r;
    }
    private boolean sensitive(AccessibilityNodeInfo n,int d,int[] count){
        if(n==null)return false;if(d>30||++count[0]>1000)return true;
        if(n.isPassword())return true;
        String v=String.valueOf(n.getText())+" "+String.valueOf(n.getContentDescription());
        if(n.isVisibleToUser()&&v.matches("(?is).*(驗證碼|验证码|支付密碼|支付密码|付款密碼|付款密码|輸入密碼|输入密码|one.time password|verification code|confirm payment).*"))return true;
        for(int j=0;j<n.getChildCount();j++)if(sensitive(n.getChild(j),d+1,count))return true;return false;
    }
    private DisplayMetrics screenMetrics(){DisplayMetrics m=new DisplayMetrics();WindowManager wm=getSystemService(WindowManager.class);if(wm!=null)wm.getDefaultDisplay().getRealMetrics(m);else m.setTo(getResources().getDisplayMetrics());return m;}
    private void dump(AccessibilityNodeInfo n,StringBuilder b,int depth,int[] count){
        if(n==null||depth>25||++count[0]>400||b.length()>3400)return;
        if(n.isVisibleToUser()&&!n.isPassword()){
            String t=n.getText()!=null?n.getText().toString():n.getContentDescription()!=null?n.getContentDescription().toString():"";
            if(t.trim().isEmpty()&&n.isEditable()&&n.getHintText()!=null)t=n.getHintText().toString();
            if(t.trim().isEmpty()&&(n.isEditable()||n.isClickable()))t=n.getViewIdResourceName()!=null?n.getViewIdResourceName():String.valueOf(n.getClassName());
            if(!t.trim().isEmpty()){Rect r=new Rect();n.getBoundsInScreen(r);DisplayMetrics m=screenMetrics();int w=m.widthPixels,ht=m.heightPixels;
                b.append(t.replaceAll("[\\r\\n]+"," ").substring(0,Math.min(120,t.replaceAll("[\\r\\n]+"," ").length()))).append(String.format(Locale.ROOT," (%.2f,%.2f)%s; ",r.exactCenterX()/Math.max(1,w),r.exactCenterY()/Math.max(1,ht),n.isEditable()?"[输入框]":n.isClickable()?"[可点击]":""));}
        }
        for(int j=0;j<n.getChildCount();j++)dump(n.getChild(j),b,depth+1,count);
    }
    private String observe(AccessibilityNodeInfo r){StringBuilder b=new StringBuilder();dump(r,b,0,new int[]{0});observedAt=SystemClock.elapsedRealtime();return "前台应用："+allowed+"；屏幕："+screenMetrics().widthPixels+"×"+screenMetrics().heightPixels+"；"+(b.length()==0?"没有可读控件；不要猜坐标":b.substring(0,Math.min(3500,b.length())));}
    private void finish(long g,Consumer<JSONObject> cb,boolean accepted,String why){
        if(g!=generation){cb.accept(result(false,"任務已停止", ""));return;}busy=false;AccessibilityNodeInfo r=root();
        if(r==null){observedAt=0;cb.accept(result(false,"目標畫面未確認、已離開授權 App 或受保護；不要盲目重試", ""));return;}
        cb.accept(result(accepted,why+"；僅為動作回執，不代表任務完成",observe(r)));
    }
    // Only the currently approved app window, not the whole display.
    // The caller asks explicitly for a fresh frame; secure windows remain inaccessible.
    private void captureWindow(AccessibilityNodeInfo r,Consumer<JSONObject> cb){
        if(android.os.Build.VERSION.SDK_INT<34){
            cb.accept(result(false,"Android 14 以下不支持独立窗口截图，请使用控件树",observe(r)));return;
        }
        final long g=generation;final int window=r.getWindowId();
        busy=true;
        try{
            takeScreenshotOfWindow(window,getMainExecutor(),new TakeScreenshotCallback(){
                @Override public void onSuccess(ScreenshotResult shot){
                    android.graphics.Bitmap hardware=null,software=null,scaled=null;
                    try{
                        AccessibilityNodeInfo current=root();
                        if(g!=generation||current==null||current.getWindowId()!=window){
                            cb.accept(result(false,"窗口已经变化，丢弃旧截图",""));return;
                        }
                        hardware=android.graphics.Bitmap.wrapHardwareBuffer(shot.getHardwareBuffer(),shot.getColorSpace());
                        if(hardware==null)throw new IllegalStateException("窗口截图不可用");
                        software=hardware.copy(android.graphics.Bitmap.Config.ARGB_8888,false);
                        if(software==null)throw new IllegalStateException("无法读取窗口截图");
                        float scale=Math.min(1f,1000f/Math.max(software.getWidth(),software.getHeight()));
                        scaled=android.graphics.Bitmap.createScaledBitmap(software,Math.max(1,Math.round(software.getWidth()*scale)),Math.max(1,Math.round(software.getHeight()*scale)),true);
                        java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
                        if(!scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG,75,out))throw new IllegalStateException("截图编码失败");
                        cb.accept(json("ok",true,"why","已读取目标窗口图片；坐标以控件树为准","screen",observe(current),"image","data:image/jpeg;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP)));
                    }catch(Exception e){cb.accept(result(false,"截图失败："+e.getMessage(),""));}
                    finally{if(scaled!=null&&scaled!=software)scaled.recycle();if(software!=null)software.recycle();if(hardware!=null)hardware.recycle();shot.getHardwareBuffer().close();if(g==generation)busy=false;}
                }
                @Override public void onFailure(int errorCode){if(g==generation)busy=false;AccessibilityNodeInfo current=root();cb.accept(result(false,"系统窗口截图不可用（"+errorCode+"），继续使用控件树",current==null?"":observe(current)));}
            });
        }catch(Exception e){busy=false;cb.accept(result(false,"窗口截图不可用："+e.getMessage(),observe(r)));}
    }
    private static double coord(JSONObject a,String k){double v=a.optDouble(k,Double.NaN);if(!Double.isFinite(v)||v<0||v>1)throw new IllegalArgumentException("座標須在 0~1");return v;}
    private boolean risky(String s){return s!=null&&s.matches("(?is).*(發送|发送|付款|支付|下單|下单|轉帳|转账|刪除|删除|確認購買|确认购买|send|purchase|pay now|delete).*" );}
    private AccessibilityNodeInfo exact(AccessibilityNodeInfo r,String s){
        List<AccessibilityNodeInfo> matches=r.findAccessibilityNodeInfosByText(s);AccessibilityNodeInfo found=null;
        for(AccessibilityNodeInfo n:matches){if(!n.isVisibleToUser())continue;String t=String.valueOf(n.getText()),d=String.valueOf(n.getContentDescription());if(!s.equals(t)&&!s.equals(d))continue;if(found!=null)return null;found=n;}return found;
    }
    private boolean click(AccessibilityNodeInfo n){for(int i=0;n!=null&&i<6;i++,n=n.getParent()){if(n.isClickable()&&n.isEnabled())return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);}return false;}
    private boolean dangerousAt(AccessibilityNodeInfo n,int x,int y,int d){if(n==null||d>30)return false;Rect b=new Rect();n.getBoundsInScreen(b);if(!b.contains(x,y))return false;if(risky(String.valueOf(n.getText())+" "+String.valueOf(n.getContentDescription())))return true;for(int j=0;j<n.getChildCount();j++)if(dangerousAt(n.getChild(j),x,y,d+1))return true;return false;}
    void request(JSONObject a,Consumer<JSONObject> cb){
        if(busy){cb.accept(result(false,"另一動作尚未結束", ""));return;}
        AccessibilityNodeInfo r=root();if(r==null){cb.accept(result(false,"請先開啟並授權目標 App；受保護或非目標畫面不可操作", ""));return;}
        String action=a.optString("action");if(action.equals("screenshot")||action.equals("inspect")){cb.accept(result(true,"已读取当前控件树",observe(r)));return;}
        if(action.equals("capture_window")){captureWindow(r,cb);return;}
        if(SystemClock.elapsedRealtime()-observedAt>60000||observedAt==0){cb.accept(result(false,"畫面已過期，請重新觀察", ""));return;}
        boolean ok=false;String why="Android 已接受動作";long g=generation;busy=true;
        try{
            switch(action){
                case "tap_text": {String t=a.optString("text");if(t.trim().isEmpty()||risky(t))throw new IllegalArgumentException("此操作需由使用者親手完成");ok=click(exact(r,t));break;}
                case "type_text": {String t=a.optString("text");AccessibilityNodeInfo f=r.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);if(f==null||!f.isEditable()||f.isPassword()||t.isEmpty()||t.length()>500)throw new IllegalArgumentException("找不到安全的已聚焦輸入框，或文字過長");Bundle b=new Bundle();b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,t);ok=f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,b);break;}
                case "back":ok=performGlobalAction(GLOBAL_ACTION_BACK);break;
                case "send_key":throw new IllegalArgumentException("發送或提交請由使用者親手完成");
                case "tap_xy":case "long_press":case "swipe": {
                    DisplayMetrics m=screenMetrics();int w=m.widthPixels,ht=m.heightPixels;
                    boolean sw=action.equals("swipe");float x=(float)(coord(a,sw?"startX":"x")*(w-1)),y=(float)(coord(a,sw?"startY":"y")*(ht-1));
                    Rect bounds=new Rect();r.getBoundsInScreen(bounds);if(!bounds.contains((int)x,(int)y))throw new IllegalArgumentException("座標超出目標畫面");
                    if(!sw&&dangerousAt(r,(int)x,(int)y,0))throw new IllegalArgumentException("此操作需由使用者親手完成");
                    Path path=new Path();path.moveTo(x,y);long dur=action.equals("long_press")?650:80;
                    if(sw){float ex=(float)(coord(a,"endX")*(w-1)),ey=(float)(coord(a,"endY")*(ht-1));if(!bounds.contains((int)ex,(int)ey))throw new IllegalArgumentException("滑動超出目標畫面");path.lineTo(ex,ey);dur=Math.max(180,Math.min(1500,a.optInt("durationMs",400)));}
                    GestureDescription gesture=new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,dur)).build();
                    ok=dispatchGesture(gesture,new GestureResultCallback(){@Override public void onCompleted(GestureDescription gd){h.postDelayed(()->finish(g,cb,true,"手勢已執行"),350);}@Override public void onCancelled(GestureDescription gd){finish(g,cb,false,"手勢被系統取消");}},h);
                    if(ok)return;break;}
                default:throw new IllegalArgumentException("未知動作");
            }
        }catch(Exception e){busy=false;cb.accept(result(false,String.valueOf(e.getMessage()),""));return;}
        final boolean accepted=ok;h.postDelayed(()->finish(g,cb,accepted,accepted?why:"Android 未接受動作"),350);
    }
}
