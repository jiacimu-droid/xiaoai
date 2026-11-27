package com.xiaoai.phone;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.KeyguardManager;
import android.content.Context;
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
import android.view.accessibility.AccessibilityWindowInfo;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.function.Consumer;

/** Operates on the foreground application selected by the active phone task. */
public final class PhoneService extends AccessibilityService {
    static volatile PhoneService instance;
    private static final Set<Runnable> CONNECTION_LISTENERS = new CopyOnWriteArraySet<>();
    private final Handler h=new Handler(Looper.getMainLooper());
    private String allowed=""; private long until=0, generation=0, observedAt=0;
    private boolean busy=false;
    private String draft="";
    private int draftWindow=-1;
    private boolean submitted=false;
    private AppLocks appLocks;
    private boolean acceptsEvents;
    private boolean firstEvent;
    static JSONObject json(Object... kv){JSONObject o=new JSONObject();try{for(int i=0;i<kv.length;i+=2)o.put((String)kv[i],kv[i+1]);}catch(Exception ignored){}return o;}
    static JSONObject result(boolean ok,String why,String screen){return json("ok",ok,"why",why,"screen",screen);}
    static void addConnectionListener(Runnable listener) { CONNECTION_LISTENERS.add(listener); }
    static void removeConnectionListener(Runnable listener) { CONNECTION_LISTENERS.remove(listener); }
    private void notifyConnection() {
        for (Runnable listener : CONNECTION_LISTENERS) {
            try { listener.run(); }
            catch (RuntimeException error) { AccessibilityDiagnostics.fault(this,"通知连接状态",error); }
        }
    }
    @Override public void onCreate(){
        super.onCreate();
        acceptsEvents=true;
        AccessibilityDiagnostics.created(this);
        // Enforcement announces itself through the tray, so the channels must
        // exist even when the activity has never been opened.
        Notifier.ensure(this);
    }
    @Override protected void onServiceConnected(){
        super.onServiceConnected();
        acceptsEvents=true;
        connected("callback");
    }
    private void connected(String evidence){
        AccessibilityDiagnostics.stage(this,evidence);
        if(instance==this)return;
        // Publish the actual system callback before optional lock initialization.
        // A vendor-specific failure in lock inspection must not break the service.
        instance=this;
        notifyConnection();
        try {
            appLocks=new AppLocks(this);
            appLocks.inspect();
        } catch (RuntimeException | LinkageError error) {
            AccessibilityDiagnostics.fault(this,"初始化应用锁",error);
            closeLocksSafely();
        }
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent e){
        if(!acceptsEvents||e==null||(instance!=null&&instance!=this))return;
        // A real system-delivered event proves this instance is reachable even
        // on devices where it arrives before the connection callback.
        if(instance==null)connected("event");
        if(!firstEvent){firstEvent=true;AccessibilityDiagnostics.firstEvent(this);}
        if(appLocks!=null){
            try { appLocks.onWindow(e); }
            catch (RuntimeException | LinkageError error) {
                AccessibilityDiagnostics.fault(this,"處理無障礙窗口事件",error);
                closeLocksSafely();
            }
        }
    }
    @Override public void onInterrupt(){cancel();}
    @Override public boolean onUnbind(Intent i){disconnect("unbind");return super.onUnbind(i);}
    @Override public void onDestroy(){disconnect("destroy");super.onDestroy();}
    private void disconnect(String reason){
        boolean wasActive=acceptsEvents;
        acceptsEvents=false;
        firstEvent=false;
        cancel();
        closeLocksSafely();
        if(wasActive&&(instance==null||instance==this))AccessibilityDiagnostics.stage(this,reason);
        if(instance==this){instance=null;notifyConnection();}
    }
    private void closeLocksSafely(){
        AppLocks locks=appLocks;
        appLocks=null;
        if(locks==null)return;
        try{locks.close();}
        catch(RuntimeException | LinkageError error){
            AccessibilityDiagnostics.fault(this,"關閉應用鎖",error);
        }
    }
    void cancel(){generation++;allowed="";until=0;observedAt=0;busy=false;clearDraft();submitted=false;}
    void revoke(){if(appLocks!=null)appLocks.command(json("action","clear_app_locks"));disconnect("disabled");disableSelf();}
    JSONObject appLockCommand(JSONObject command){return appLocks==null?result(false,"无障碍服务尚未连接",""):appLocks.command(command);}
    private void clearDraft(){draft="";draftWindow=-1;}
    static final class Target {final String pkg,label;Target(String p,String l){pkg=p;label=l;}}
    static boolean blockedPackage(Context c,String p){return p==null||p.isEmpty()||p.equals(c.getPackageName())||p.startsWith("com.android.")||p.startsWith("com.google.android.permissioncontroller")||p.contains("bank")||p.contains("alipay")||p.contains("wallet")||p.contains("password")||p.contains("authenticator");}
    private boolean blockedPackage(String p){return blockedPackage(this,p);}
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
        if(busy){cb.accept(result(false,"另一動作尚未結束", ""));return;}
        if(appLocks!=null&&appLocks.blocked(t.pkg)){cb.accept(result(false,"这个应用目前已锁定", ""));return;}
        cancel();if(instance!=this||locked()){cb.accept(result(false,"無障礙已關閉或手機已鎖定",""));return;}
        Intent i=getPackageManager().getLaunchIntentForPackage(t.pkg);if(i==null){cb.accept(result(false,"無法開啟 App",""));return;}
        allowed=t.pkg;until=SystemClock.elapsedRealtime()+180000;long g=generation;busy=true;
        try{startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}catch(Exception e){cancel();cb.accept(result(false,"Android 拒絕啟動",""));return;}
        h.postDelayed(()->waitForLaunch(g,cb,0),500);
    }
    private void waitForLaunch(long g,Consumer<JSONObject> cb,int attempt){
        if(g!=generation){cb.accept(result(false,"任务已停止",""));return;}
        if(root()!=null){finish(g,cb,true,"已观察到目标 App");return;}
        if(attempt>=20){busy=false;cb.accept(result(false,"未观察到目标 App，请检查是否已登录或被系统弹窗挡住",""));return;}
        h.postDelayed(()->waitForLaunch(g,cb,attempt+1),500);
    }
    private boolean locked(){KeyguardManager k=getSystemService(KeyguardManager.class);return k!=null&&k.isDeviceLocked();}
    boolean hasTargetOnScreen(){return !allowed.isEmpty()&&foregroundTarget()!=null;}
    private AccessibilityNodeInfo foregroundTarget(){
        AccessibilityNodeInfo active=getRootInActiveWindow();
        if(belongsToTarget(active))return active;
        List<AccessibilityWindowInfo> windows=getWindows();
        boolean keyboardActive=false;
        for(AccessibilityWindowInfo w:windows){
            if(w.getType()==AccessibilityWindowInfo.TYPE_INPUT_METHOD&&w.isActive())keyboardActive=true;
        }
        if(!keyboardActive)return null;
        for(AccessibilityWindowInfo w:windows){
            if(w.getType()!=AccessibilityWindowInfo.TYPE_APPLICATION||!w.isFocused())continue;
            AccessibilityNodeInfo r=w.getRoot();
            if(belongsToTarget(r))return r;
        }
        return null;
    }
    private boolean belongsToTarget(AccessibilityNodeInfo n){return n!=null&&n.getPackageName()!=null&&allowed.contentEquals(n.getPackageName());}
    private AccessibilityNodeInfo root(){
        if(instance!=this||locked()||SystemClock.elapsedRealtime()>until||allowed.isEmpty())return null;
        if(appLocks!=null&&appLocks.blocked(allowed))return null;
        AccessibilityNodeInfo r=foregroundTarget();if(r==null)return null;
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
    private String observe(AccessibilityNodeInfo r){StringBuilder b=new StringBuilder();dump(r,b,0,new int[]{0});observedAt=SystemClock.elapsedRealtime();until=observedAt+180000;return "前台应用："+allowed+"；屏幕："+screenMetrics().widthPixels+"×"+screenMetrics().heightPixels+"；"+(b.length()==0?"没有可读控件；不要猜坐标":b.substring(0,Math.min(3500,b.length())));}
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
    private boolean risky(String s){return s!=null&&s.trim().matches("(?i)(發送|发送|送出|发表|發表|发布|發布|付款|支付|下單|下单|轉帳|转账|刪除|删除|確認購買|确认购买|send|post|purchase|pay now|delete)");}
    private AccessibilityNodeInfo exact(AccessibilityNodeInfo r,String s){
        List<AccessibilityNodeInfo> matches=r.findAccessibilityNodeInfosByText(s);AccessibilityNodeInfo found=null;
        for(AccessibilityNodeInfo n:matches){if(!n.isVisibleToUser())continue;String t=String.valueOf(n.getText()),d=String.valueOf(n.getContentDescription());if(!s.equals(t)&&!s.equals(d))continue;if(found!=null)return null;found=n;}return found;
    }
    private boolean click(AccessibilityNodeInfo n){for(int i=0;n!=null&&i<6;i++,n=n.getParent()){if(n.isClickable()&&n.isEnabled())return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);}return false;}
    private boolean dangerousAt(AccessibilityNodeInfo n,int x,int y,int d){if(n==null||d>30)return false;Rect b=new Rect();n.getBoundsInScreen(b);if(!b.contains(x,y))return false;if(risky(String.valueOf(n.getText()))||risky(String.valueOf(n.getContentDescription())))return true;for(int j=0;j<n.getChildCount();j++)if(dangerousAt(n.getChild(j),x,y,d+1))return true;return false;}
    private AccessibilityNodeInfo input(AccessibilityNodeInfo r){
        AccessibilityNodeInfo f=r.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        return f!=null&&f.isVisibleToUser()&&f.isEnabled()&&f.isEditable()&&!f.isPassword()?f:null;
    }
    private boolean hasText(AccessibilityNodeInfo n,String text){return n!=null&&n.getText()!=null&&text.contentEquals(n.getText());}
    private int visibleMessages(AccessibilityNodeInfo r,String text){
        int count=0;
        for(AccessibilityNodeInfo n:r.findAccessibilityNodeInfosByText(text)){
            if(n.isVisibleToUser()&&!n.isEditable()&&hasText(n,text))count++;
        }
        return count;
    }
    private void submitSocial(AccessibilityNodeInfo r,JSONObject a,Consumer<JSONObject> cb){
        boolean moments="publish_moments".equals(a.optString("action"));
        boolean wechat="com.tencent.mm".equals(allowed);
        if(!wechat&&(moments||!"com.tencent.mobileqq".equals(allowed))){
            cb.accept(result(false,"此应用没有匹配的消息或朋友圈发布入口",observe(r)));return;
        }
        if(submitted){cb.accept(result(false,"已经点过发送或发布，请查看结果，避免重复提交",observe(r)));return;}
        if(draft.isEmpty()||draftWindow!=r.getWindowId()||!hasText(input(r),draft)){
            cb.accept(result(false,"当前输入框里没有刚核对过的草稿，请重新定位并输入",observe(r)));return;
        }
        if(!moments){
            String recipient=a.optString("recipient").trim();
            AccessibilityNodeInfo title=recipient.isEmpty()?null:exact(r,recipient);
            Rect screen=new Rect(), bounds=new Rect();r.getBoundsInScreen(screen);
            if(title!=null)title.getBoundsInScreen(bounds);
            if(title==null||bounds.isEmpty()||bounds.centerY()>screen.top+screen.height()/4){
                cb.accept(result(false,"聊天标题与指定收件人未匹配，请重新核对当前会话",observe(r)));return;
            }
        }
        String label=a.optString("label").trim();
        String labels=moments?"(?i)(发表|發表|发布|發布|Post)":"(?i)(发送|發送|送出|Send)";
        AccessibilityNodeInfo button=label.matches(labels)?exact(r,label):null;
        if(button==null){cb.accept(result(false,"当前页面没有唯一对应的发送或发布按钮",observe(r)));return;}
        String text=draft;
        int before=visibleMessages(r,text);
        long g=generation;
        if(!click(button)){cb.accept(result(false,"Android 未接受当前按钮的点击，请重新观察",observe(r)));return;}
        submitted=true;busy=true;clearDraft();
        h.postDelayed(()->verifySubmission(g,moments,text,label,before,0,cb),400);
    }
    private void verifySubmission(long g,boolean moments,String text,String label,int before,int attempt,Consumer<JSONObject> cb){
        if(g!=generation){cb.accept(result(false,"任务已停止", ""));return;}
        AccessibilityNodeInfo r=root();
        boolean verified=r!=null&&!hasText(input(r),text)&&visibleMessages(r,text)>before&&(!moments||exact(r,label)==null);
        if(!verified&&attempt<12){
            h.postDelayed(()->verifySubmission(g,moments,text,label,before,attempt+1,cb),450);return;
        }
        busy=false;
        cb.accept(json("ok",verified,"submitted",true,"verified",verified,
                "why",verified?(moments?"已在朋友圈看到刚发布的内容":"已在会话中看到刚发出的消息"):"已点击提交，应用未显示可核实的结果，请先查看，避免重复发送",
                "screen",r==null?"":observe(r)));
    }
    void request(JSONObject a,Consumer<JSONObject> cb){
        if(busy){cb.accept(result(false,"另一動作尚未結束", ""));return;}
        AccessibilityNodeInfo r=root();if(r==null){cb.accept(result(false,"請先開啟並授權目標 App；受保護或非目標畫面不可操作", ""));return;}
        String action=a.optString("action");if(action.equals("screenshot")||action.equals("inspect")){cb.accept(result(true,"已读取当前控件树",observe(r)));return;}
        if(action.equals("capture_window")){captureWindow(r,cb);return;}
        if(SystemClock.elapsedRealtime()-observedAt>60000||observedAt==0){cb.accept(result(false,"畫面已過期，請重新觀察", ""));return;}
        if(action.equals("send_message")||action.equals("publish_moments")){submitSocial(r,a,cb);return;}
        boolean ok=false;String why="Android 已接受動作";long g=generation;busy=true;
        try{
            switch(action){
                case "tap_text": {String t=a.optString("text");if(t.trim().isEmpty()||risky(t))throw new IllegalArgumentException("此操作需由使用者親手完成");AccessibilityNodeInfo node=exact(r,t);ok=click(node);
                    if(!ok&&node!=null){
                        Rect b=new Rect();node.getBoundsInScreen(b);Rect window=new Rect();r.getBoundsInScreen(window);
                        if(!b.isEmpty()&&window.contains(b.centerX(),b.centerY())&&!dangerousAt(r,b.centerX(),b.centerY(),0)){
                            Path path=new Path();path.moveTo(b.centerX(),b.centerY());
                            GestureDescription gesture=new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,80)).build();
                            ok=dispatchGesture(gesture,new GestureResultCallback(){
                                @Override public void onCompleted(GestureDescription gd){h.postDelayed(()->finish(g,cb,true,"已执行文字定位点击"),400);}
                                @Override public void onCancelled(GestureDescription gd){finish(g,cb,false,"点击手势被取消");}
                            },h);
                            if(ok)return;
                        }
                    }
                    break;}
                case "type_text": {clearDraft();String t=a.optString("text");AccessibilityNodeInfo f=input(r);if(f==null||t.isEmpty()||t.length()>800)throw new IllegalArgumentException("找不到已聚焦的输入框，或文字过长");Bundle b=new Bundle();b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,t);ok=f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,b);
                    if(ok){h.postDelayed(()->{
                        if(g!=generation){cb.accept(result(false,"任务已停止",""));return;}
                        AccessibilityNodeInfo updated=root();
                        boolean verified=updated!=null&&hasText(input(updated),t);
                        if(verified){draft=t;draftWindow=updated.getWindowId();}
                        finish(g,cb,verified,verified?"已观察到输入框文字与请求一致":"输入请求已接受，但未确认文字，请重新定位输入框");
                    },450);return;}
                    break;}
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
