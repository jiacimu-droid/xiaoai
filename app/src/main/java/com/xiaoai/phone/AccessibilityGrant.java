package com.xiaoai.phone;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;
import java.util.List;

final class AccessibilityGrant {
    private AccessibilityGrant() {}
    static final class Snapshot {
        int secure=GrantEvidence.UNKNOWN, manager=GrantEvidence.UNKNOWN, global=GrantEvidence.UNKNOWN;
        String secureShape="未讀取", secureError="", managerError="", globalError="";
        int state(){return GrantEvidence.resolve(secure,manager);}
        boolean conflict(){return GrantEvidence.conflict(secure,manager);}
    }
    static Snapshot inspect(Context context) {
        Snapshot s=new Snapshot();
        ComponentName service=new ComponentName(context,PhoneService.class);
        try {
            String enabled=Settings.Secure.getString(context.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            s.secureShape=enabled==null?"null":enabled.trim().isEmpty()?"空清單":"非空清單";
            s.secure=contains(enabled,service)?GrantEvidence.YES:GrantEvidence.NO;
        } catch(RuntimeException | LinkageError e) {
            s.secureError=e.getClass().getSimpleName();
        }
        try {
            int global=Settings.Secure.getInt(context.getContentResolver(),Settings.Secure.ACCESSIBILITY_ENABLED,-1);
            s.global=global==1?GrantEvidence.YES:global==0?GrantEvidence.NO:GrantEvidence.UNKNOWN;
        } catch(RuntimeException | LinkageError e) {s.globalError=e.getClass().getSimpleName();}
        try {
            AccessibilityManager manager=context.getSystemService(AccessibilityManager.class);
            if(manager!=null){
                List<AccessibilityServiceInfo> list=manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
                if(list!=null){
                    s.manager=GrantEvidence.NO;
                    for(AccessibilityServiceInfo info:list){
                        if(info==null)continue;
                        if(matches(info.getId(),service)){s.manager=GrantEvidence.YES;break;}
                        android.content.pm.ResolveInfo ri=info.getResolveInfo();
                        if(ri!=null&&ri.serviceInfo!=null){
                            String pkg=ri.serviceInfo.packageName, cls=ri.serviceInfo.name;
                            if(pkg!=null&&cls!=null&&service.equals(new ComponentName(pkg,cls.startsWith(".")?pkg+cls:cls))){
                                s.manager=GrantEvidence.YES;break;
                            }
                        }
                    }
                }
            }
        } catch(RuntimeException | LinkageError e) {
            s.manager=GrantEvidence.UNKNOWN;s.managerError=e.getClass().getSimpleName();
        }
        return s;
    }
    static boolean matches(String raw, ComponentName expected){
        if(raw==null)return false;
        return expected.equals(ComponentName.unflattenFromString(raw.trim()));
    }
    static boolean contains(String enabled, ComponentName expected){
        if(enabled==null)return false;
        for(String component:enabled.split(":"))if(matches(component,expected))return true;
        return false;
    }
}
