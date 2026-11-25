package com.xiaoai.phone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.WebViewFeature;

/** Native entry point also available from Android's accessibility service details. */
public final class AccessibilityDiagnosticsActivity extends Activity {
    private final Runnable connectionListener=this::update;
    private TextView body;
    private final android.os.Handler refreshHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable refresh=this::update;

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        ScrollView scroll=new ScrollView(this);
        body=new TextView(this);
        body.setTextIsSelectable(true);
        int padding=Math.round(22*getResources().getDisplayMetrics().density);
        body.setPadding(padding,padding,padding,padding);
        scroll.addView(body);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("無障礙連接診斷")
                .setView(scroll).setPositiveButton("複製診斷",null)
                .setNeutralButton("系統無障礙設置",null)
                .setNegativeButton("關閉",(d,w)->finish()).create();
        dialog.setOnDismissListener(d->finish());
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            ClipboardManager clipboard=getSystemService(ClipboardManager.class);
            if(clipboard==null)return;
            update();
            clipboard.setPrimaryClip(ClipData.newPlainText("小愛機無障礙診斷",body.getText()));
            Toast.makeText(this,"診斷已複製",Toast.LENGTH_SHORT).show();
        });
        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->{
            try{startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));}
            catch(android.content.ActivityNotFoundException ignored){}
        });
        PhoneService.addConnectionListener(connectionListener);
        update();
    }

    @Override protected void onResume(){
        super.onResume();update();
        refreshHandler.removeCallbacks(refresh);
        for(long delay:new long[]{250,750,1500,3000,6000})refreshHandler.postDelayed(refresh,delay);
    }
    @Override protected void onPause(){refreshHandler.removeCallbacks(refresh);super.onPause();}
    @Override protected void onDestroy(){refreshHandler.removeCallbacks(refresh);PhoneService.removeConnectionListener(connectionListener);super.onDestroy();}

    private void update(){
        if(body==null)return;
        body.setText(AccessibilityDiagnostics.report(this,
                WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER),
                getIntent().getBooleanExtra("page_reported",false)));
    }
}
