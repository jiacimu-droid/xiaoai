/* ============================================================
   ===== v1217：運行日誌 =====
   這一台自己記的賬。腳本報錯、接口叫不通、圖片音檔載入失敗、
   辦事辦到一半卡住、存檔存不進去——全部寫進一份環形清單，
   設定頁按「打開運行日誌」就是一份看得見的報告。
   最早的錯誤（載入階段的）由檔頭那段 shim 先收著，這邊再撈回來。
   ============================================================ */
var XAL={list:null,last:{},timer:0,f:'all',fold:{},shown:0,stat:null,frames:0};
var XA_LOG_CAP=400,XA_LOG_KEEP=220,XA_LOG_SHOWN=140;

/* v1221：報告頭與開機行的版本由首頁膠囊讀，不要再寫死。
   之前這裡硬寫 v1217，害匯出的報告一直報舊版本，
   看不出手機上跑的到底是哪一份，排查全被帶偏。 */
function xaVerNow(){
  try{
    var v=((document.getElementById('verPill')||{}).textContent||'').trim().split(/\s|[·]/)[0];
    return /^v\d{3,}$/.test(v)?v:'當前版本';
  }catch(e){return '當前版本'}
}

function xaLogLoad(){
  if(XAL.list)return XAL.list;
  var a=[];
  try{var old=DB.get('xaLog',[]);if(Array.isArray(old))a=old.filter(function(x){return x&&x.t})}catch(e){}
  XAL.list=a;return a;
}
function xaLogStatLoad(){
  if(XAL.stat)return XAL.stat;
  var s={api:0,apiErr:0,xa:0,xaFail:0,err:0,boots:0,ovf:0,since:Date.now()};
  try{var o=DB.get('xaLogStat',null);if(o&&typeof o==='object'){for(var k in s){if(typeof o[k]==='number'&&isFinite(o[k]))s[k]=o[k]}}}catch(e){}
  XAL.stat=s;return s;
}
function xaLogTick(){
  if(XAL.timer)return;
  try{XAL.timer=setTimeout(xaLogFlush,1500)}catch(e){}
}
function xaLogFlush(){
  XAL.timer=0;
  try{
    var L=xaLogLoad();
    var cut=L.slice(-XA_LOG_KEEP).map(function(e){return {t:e.t,k:e.k,m:String(e.m||'').slice(0,300),d:String(e.d||'').slice(0,260),n:e.n||1,l:e.l||0}});
    DB.set('xaLog',cut);
    DB.set('xaLogStat',xaLogStatLoad());
  }catch(e){}
}
/* 同一種錯 4 秒內只記一條，後面重來的只加次數，不會把清單刷爆 */
function xaLogSink(t,k,m,d){
  try{
    var L=xaLogLoad(),st=xaLogStatLoad();
    m=String(m==null?'':m).replace(/\s+$/,'').slice(0,300)||'（空訊息）';
    d=String(d==null?'':d).slice(0,800);
    var key=k+'\u0001'+m;
    if(k==='err'||k==='cerr'||k==='promise'||k==='iframe')st.err++;
    var last=XAL.last[key];
    if(last&&t-last.t<4000){last.l=t;last.n=(last.n||1)+1;if(d&&!last.d)last.d=d;xaLogTick();return 0}
    var e={t:t,k:k,m:m,d:d,n:1};
    L.push(e);XAL.last[key]=e;
    if(L.length>XA_LOG_CAP)L.splice(0,L.length-XA_LOG_CAP);
    if(Object.keys(XAL.last).length>600)XAL.last={};
    xaLogTick();
    return 1;
  }catch(_){return 0}
}
function xaLog(k,m,d){try{return xaLogSink(Date.now(),k,m,d)}catch(e){return 0}}

/* ---- 計數用的三個小鉤子（插在 sendChatRaw / xaEnd 裡面） ---- */
function xaLogApiOK(){try{xaLogStatLoad().api++;xaLogTick()}catch(e){}}
function xaLogApiErr(error){
  try{
    var st=xaLogStatLoad();st.apiErr++;
    xaLog('api','接口呼叫失敗：'+window.xaLogError(error),'');
    xaLogTick();
  }catch(e){}
}
function xaLogXa(state,t){
  try{
    var st=xaLogStatLoad();
    if(state==='done'){st.xa++;xaLogTick();return}
    if(state!=='fail'&&state!=='stop'){return}
    st.xaFail++;
    var tr=(t.steps||[]).map(function(step,i){
      var action=String(step.a||'').match(/^[a-z_]{1,35}$/i);
      return (i+1)+'. '+(action?action[0]:'未知動作')+(step.ok?' · 成功':' · 未完成');
    });
    xaLog('xa','辦事'+(state==='fail'?'沒辦成':'中途叫停'),tr.join('\n'));
    xaLogTick();
  }catch(e){}
}
/* ---- iframe 裡（小電腦、擬真系統）的錯也想辦法收 ---- */
function xaLogFrame(w){
  try{
    if(!w||w.__xaLogHooked)return;
    w.__xaLogHooked=1;
    w.addEventListener('error',function(e){
      var tag=e.target&&e.target.tagName;
      if(tag)xaLog('res','組件內 '+tag+' 載入失敗','');
      else xaLog('iframe',window.xaLogError(e.error),window.xaLogLocation(e.filename,e.lineno));
    },true);
    w.addEventListener('unhandledrejection',function(e){
      xaLog('iframe',window.xaLogError(e.reason),'');
    });
  }catch(_){}
}
/* ---- 開機：把 shim 收的早期錯誤撈回來，標一筆本次開機 ---- */
function xaLogBoot(){
  try{
    var st=xaLogStatLoad();
    st.boots++;
    xaLogLoad();
    var buf=window.__xaLogBuf||[];
    for(var i=0;i<buf.length;i++){
      var b=buf[i];
      xaLogSink(b[0],b[1],b[2],b[3]);
    }
    window.__xaLogBuf=[];
    window.__xaLogSink=function(t,k,m,d){return xaLogSink(t,k,m,d)};
    var n=buf.length;
    xaLog('boot','開機完成 · '+xaVerNow()+'（Android 注入端）'+(n?('（載入階段先收到 '+n+' 條）'):''),
      (navigator.userAgent||'')+'\n螢幕 '+window.innerWidth+'×'+window.innerHeight+' · dpr '+(window.devicePixelRatio||1));
    xaLogFlush();
    document.querySelectorAll('iframe').forEach(function(frame){xaLogFrame(frame.contentWindow)});
    document.addEventListener('load',function(ev){
      try{var t=ev&&ev.target;if(t&&t.tagName==='IFRAME')xaLogFrame(t.contentWindow)}catch(e){}
    },true);
    window.addEventListener('pagehide',function(){try{xaLogFlush()}catch(e){}});
    xaLogStat();
  }catch(e){}
}
/* ---- 設定頁那行小字 ---- */
function xaLogStat(){
  try{
    var el=document.getElementById('xaLogStat');if(!el)return;
    xaLogLoad();
    var st=xaLogStatLoad();
    var bad=0;
    for(var i=0;i<XAL.list.length;i++){var k=XAL.list[i].k;if(k==='err'||k==='cerr'||k==='promise'||k==='iframe')bad+=XAL.list[i].n||1}
    el.innerHTML='目前收了 <b>'+XAL.list.length+'</b> 條，清單裡腳本報錯 <b>'+bad+'</b> 次。'
      +'累計 AI 呼叫 '+st.api+' 次成功、'+st.apiErr+' 次失敗；辦事完成 '+st.xa+' 單、卡住 '+st.xaFail+' 單。';
  }catch(e){}
}
var XA_LOG_KINDS={err:'腳本報錯',cerr:'console.error',promise:'Promise',iframe:'組件內',res:'資源載入',api:'接口',store:'存檔',xa:'辦事',warn:'提醒',boot:'開機',info:'記錄'};
function xaLogKind(k){return XA_LOG_KINDS[k]||k}
function xaLogGroup(k){
  if(k==='err'||k==='cerr'||k==='promise'||k==='iframe')return 'err';
  if(k==='api'||k==='res')return 'net';
  if(k==='xa')return 'xa';
  return 'other';
}
var XA_LOG_FILTERS=[['all','全部'],['err','報錯'],['net','網路'],['xa','辦事'],['other','其它']];
function xaLogMatch(e){
  var f=XAL.f||'all';
  if(f==='all')return 1;
  if(f==='err')return e.k==='err'||e.k==='cerr'||e.k==='promise'||e.k==='iframe';
  if(f==='net')return e.k==='api'||e.k==='res';
  if(f==='xa')return e.k==='xa';
  return !(e.k==='err'||e.k==='cerr'||e.k==='promise'||e.k==='iframe'||e.k==='api'||e.k==='res'||e.k==='xa');
}
function xaLogTime(t){
  try{
    var d=new Date(t),p=function(n){return (n<10?'0':'')+n};
    return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  }catch(e){return '--:--'}
}
function xaLogRows(){
  var out=[];
  try{
    var L=xaLogLoad();
    for(var i=L.length-1;i>=0;i--){if(xaLogMatch(L[i])){out.push(i);if(out.length>=XA_LOG_SHOWN)break}}
  }catch(e){}
  return out;
}
function xaLogBody(){
  var idxs=xaLogRows(),h='';
  XAL.shown=idxs.length;
  if(!idxs.length){
    return '<div class="xal-empty">'+(xaLogLoad().length?'這個篩選底下沒有東西，換一個看看。':'還沒有記錄。正常用一陣子再回來看，有出錯才會出現東西。')+'</div>';
  }
  for(var i=0;i<idxs.length;i++){
    var e=XAL.list[idxs[i]];
    if(!e)continue;
    var g=xaLogGroup(e.k);
    var det=String(e.d||'');
    var open=XAL.fold[idxs[i]];
    h+='<div class="xal-row xal-'+g+(e.n>1?' xal-multi':'')+'" id="xalr'+idxs[i]+'">'
      +'<div class="xal-hd">'
      +'<span class="xal-badge xal-b-'+g+'">'+esc(xaLogKind(e.k))+'</span>'
      +'<span class="xal-time">'+xaLogTime(e.t)+'</span>'
      +(e.n>1?('<span class="xal-n">×'+(e.n>99?'99+':e.n)+(e.l?(' 最近 '+xaLogTime(e.l)):'')+'</span>'):'')
      +'</div>'
      +'<div class="xal-msg" onclick="xaLogFold('+idxs[i]+')">'+esc(e.m)+(det?'<span class="xal-more">'+(open?'收起':'展開')+'</span>':'')+'</div>'
      +(det?('<div class="xal-det'+(open?' on':'')+'" id="xald'+idxs[i]+'">'+esc(det)+'</div>'):'')
      +'</div>';
  }
  return h;
}
function xaLogFold(i){
  try{
    XAL.fold[i]=!XAL.fold[i];
    var d=document.getElementById('xald'+i),r=document.getElementById('xalr'+i);
    if(d)d.classList.toggle('on',!!XAL.fold[i]);
    if(r){var mo=r.querySelector('.xal-more');if(mo)mo.textContent=XAL.fold[i]?'收起':'展開'}
  }catch(e){}
}
function xaLogSetFilter(f){XAL.f=f;xaLogRerender()}
function xaLogRerender(){
  try{
    var b=document.getElementById('xalBody');if(b)b.innerHTML=xaLogBody();
    var c=document.getElementById('xalChips');
    if(c)c.innerHTML=XA_LOG_FILTERS.map(function(x){return '<button class="xal-chip'+(XAL.f===x[0]?' on':'')+'" onclick="xaLogSetFilter(\''+x[0]+'\')">'+x[1]+'</button>'}).join('');
    var s=document.getElementById('xalSum');
    if(s){var st=xaLogStatLoad();s.innerHTML='共 '+xaLogLoad().length+' 條（這頁顯示 '+XAL.shown+' 條）· 腳本報錯累計 '+st.err+' 次 · AI 呼叫 '+st.api+' 成／'+st.apiErr+' 敗 · 辦事 '+st.xa+' 成／'+st.xaFail+' 卡'}
  }catch(e){}
}
function xaLogOpen(){
  try{
    XAL.fold={};XAL.armClear=0;
    xaLogLoad();
    var st=xaLogStatLoad();
    var h='<h3>運行日誌</h3>'
      +'<div style="font-size:11px;color:var(--ink-soft);line-height:1.6;margin-bottom:8px">'
      +'這一台自己記的：腳本報錯、接口叫不通、圖片音檔載入失敗、辦事卡住、存檔存不進去都會寫進來。清單留在這台裝置裡（記最後 '+XA_LOG_KEEP+' 條），重開網頁還在。'
      +'<br>本次開機已記 '+st.boots+' 次開機。點任何一條可以看詳細，右下角可以複製整份報告或匯出檔。'
      +'</div>'
      +'<div class="xal-chips" id="xalChips"></div>'
      +'<div class="xal-sum" id="xalSum"></div>'
      +'<div id="xalBody" class="xal-list"></div>'
      +'<div class="row" style="gap:8px;margin-top:12px">'
      +'<button class="btn full ghost" onclick="xaLogCopy()">複製報告</button>'
      +'<button class="btn full ghost" onclick="xaLogExport()">匯出 .txt</button>'
      +'</div>'
      +'<div class="row" style="gap:8px;margin-top:8px">'
      +'<button class="btn full ghost" id="xalClr" onclick="xaLogClear()">清空</button>'
      +'<button class="btn full" onclick="closeModal()">關閉</button>'
      +'</div>';
    modal(h);
    xaLogRerender();
    xaLogFlush();
  }catch(e){try{toast('日誌打不開：'+((e&&e.message)||''))}catch(_){}}
}
function xaLogText(){
  var L=[],push=function(s){L.push(s)};
  try{
    var st=xaLogStatLoad();
    push('小愛機 運行報告（'+xaVerNow()+'）');
    push('產生時間：'+new Date().toLocaleString());
    push('開機次數：累計 '+st.boots+' 次 · 本份記錄 '+xaLogLoad().length+' 條');
    push('AI 呼叫：成功 '+st.api+' 次／失敗 '+st.apiErr+' 次');
    push('辦事：完成 '+st.xa+' 單／卡住 '+st.xaFail+' 單');
    push('腳本報錯：累計 '+st.err+' 次');
    push('裝置：'+String(navigator.userAgent||'').slice(0,160));
    push('視窗：'+window.innerWidth+'×'+window.innerHeight+' · dpr '+(window.devicePixelRatio||1)+' · 語言 '+(navigator.language||''));
    try{
      var kb=0,n=0;
      for(var i=0;i<localStorage.length;i++){var kk=localStorage.key(i);var vv=localStorage.getItem(kk)||'';kb+=kk.length+vv.length;n++}
      push('本機存檔：'+n+' 個鍵 · 約 '+Math.round(kb/1024)+' KB（上限大約 5 MB）');
    }catch(e){push('本機存檔：讀不到')}
    push('超大資料改放 IndexedDB：'+(st.ovf||0)+' 次'+((st.ovf||0)?'':'（本機存檔還放得下）'));
    push('');
    push('—— 記錄（新的在前）——');
    for(var j=XAL.list.length-1;j>=0;j--){
      var e=XAL.list[j];
      push('['+new Date(e.t).toLocaleString()+'] '+(e.k==='boot'?'【開機】':'【'+xaLogKind(e.k)+'】')+e.m+(e.n>1?('（同一種 '+e.n+' 次'+(e.l?('，最近 '+new Date(e.l).toLocaleTimeString()):'')+'）'):''));
      if(e.d)e.d.split('\n').forEach(function(x){push('    '+x)});
    }
  }catch(err){push('（組報告時出錯：'+window.xaLogError(err)+'）')}
  return L.join('\n');
}
async function xaFullLogText(){
  var text=xaLogText();
  if(typeof window.xaPhoneDiagnostics!=='function')return text+'\n\n原生無障礙：未取得橋接回覆';
  var native=await window.xaPhoneDiagnostics();
  return text+'\n\n'+(native.ok?native.report:'原生無障礙：未取得橋接回覆');
}
async function xaLogCopy(){
  try{
    var t=await xaFullLogText();
    var done=function(){toast('報告已複製 ('+t.length+' 字)')};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){xaLogCopyFall(t,done)})}
    else xaLogCopyFall(t,done);
  }catch(e){try{toast('複製不成，改用匯出')}catch(_){}}
}
function xaLogCopyFall(t,done){
  try{
    var ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);ta.select();
    var copied=document.execCommand('copy');document.body.removeChild(ta);
    if(copied)done();else toast('複製不成，改用匯出');
  }catch(e){try{toast('複製不成，改用匯出')}catch(_){}}
}
async function xaLogExport(){
  try{
    var t=await xaFullLogText();
    var d=new Date(),p=function(n){return (n<10?'0':'')+n};
    var nm='xaiji_log_'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+'.txt';
    if(typeof window.xaSaveDiagnosticReport==='function'){
      await window.xaSaveDiagnosticReport(nm,t);return;
    }
    var bl=new Blob([t],{type:'text/plain;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(bl);a.download=nm;
    document.body.appendChild(a);a.click();
    setTimeout(function(){try{URL.revokeObjectURL(a.href);document.body.removeChild(a)}catch(e){}},800);
    toast('已匯出 '+nm);
  }catch(e){try{toast('匯出不成：'+((e&&e.message)||''))}catch(_){}}
}
function xaLogClear(){
  try{
    var b=document.getElementById('xalClr');
    if(!XAL.armClear){XAL.armClear=1;if(b)b.textContent='再按一次確定清空';toast('再按一次才會真的清空');return}
    XAL.armClear=0;
    XAL.list=[];XAL.last={};XAL.fold={};
    try{DB.set('xaLog',[])}catch(e){}
    xaLog('info','日誌已被機主清空','');
    xaLogFlush();xaLogRerender();xaLogStat();
  }catch(e){}
}
/* ---- 體檢裡面那一欄 ---- */
function v1217PeekRows(){
  try{
    var L=xaLogLoad(),st=xaLogStatLoad();
    var bad=0,i;
    for(i=0;i<L.length;i++){var k=L[i].k;if(k==='err'||k==='cerr'||k==='promise'||k==='iframe')bad+=L[i].n||1}
    var lastErr=null;
    for(i=L.length-1;i>=0;i--){var kk=L[i].k;if(kk==='err'||kk==='cerr'||kk==='promise'||kk==='iframe'){lastErr=L[i];break}}
    var out='<div class="pc-row'+(bad?' warn':'')+'"><div class="pc-t">運行日誌</div><div class="pc-s">'
      +esc('共 '+L.length+' 條 · 腳本報錯 '+bad+' 次 · 接口失敗 '+st.apiErr+' 次 · 辦事卡住 '+st.xaFail+' 單')
      +(lastErr?esc(' · 最近一次：'+xaCut(lastErr.m,44)):'')
      +'</div>'
      +'<span class="pc-a" onclick="closeModal();xaLogOpen()">打開</span>'
      +'</div>';
    if(lastErr){
      var ago=Math.max(0,Math.round((Date.now()-lastErr.t)/60000));
      out+='<div class="pc-row'+(ago>60?'':' warn')+'"><div class="pc-t">最近報錯</div><div class="pc-s">'
        +esc(xaLogKind(lastErr.k)+' · '+(ago<1?'剛剛':(ago<60?(ago+' 分鐘前'):Math.round(ago/60)+' 小時前'))+' · '+lastErr.m+(lastErr.d?('｜'+xaCut(String(lastErr.d).replace(/\n/g,' '),60)):''))
        +'</div></div>';
    }
    return out;
  }catch(e){return ''}
}
/* ---- 樣式自己插一個，不動原本的 ---- */
function xaLogCss(){
  try{
    if(document.getElementById('xaLogCss'))return;
    var s=document.createElement('style');s.id='xaLogCss';
    s.textContent=[
      '.xal-chips{display:flex;flex-wrap:wrap;gap:6px;position:sticky;top:-18px;padding:16px 0 6px;margin-top:-10px;background:var(--paper);z-index:2}',
      '.xal-chip{border:1px solid var(--line);background:none;border-radius:999px;padding:5px 12px;font-size:11.5px;color:var(--ink-soft);font-family:inherit}',
      '.xal-chip.on{background:#2a251f;color:#f6f1e8;border-color:#2a251f}',
      '.xal-sum{font-size:11px;color:var(--ink-soft);line-height:1.6;margin:8px 0 4px}',
      '.xal-list{display:flex;flex-direction:column}',
      '.xal-row{border-bottom:1px solid var(--line);padding:8px 0}',
      '.xal-hd{display:flex;align-items:center;gap:6px;margin-bottom:3px}',
      '.xal-badge{font-size:10px;padding:1.5px 7px;border-radius:999px;color:#fff;background:#8a8a8a;flex:none}',
      '.xal-b-err{background:#b8605b}.xal-b-net{background:#5b8db8}.xal-b-xa{background:#c98a3d}.xal-b-other{background:#8a8a8a}',
      '.xal-time{font-size:10.5px;color:var(--ink-soft);font-variant-numeric:tabular-nums}',
      '.xal-n{font-size:10.5px;color:#b8605b;font-weight:700}',
      '.xal-msg{font-size:12px;line-height:1.55;word-break:break-word}',
      '.xal-more{margin-left:6px;font-size:10.5px;color:#07c160;font-weight:700}',
      '.xal-det{display:none;margin-top:5px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 9px;font-size:10.5px;line-height:1.6;color:var(--ink-soft);white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto}',
      '.xal-det.on{display:block}',
      '.xal-multi .xal-msg{color:#b8605b}',
      '.xal-empty{font-size:11.5px;color:var(--ink-soft);line-height:1.7;padding:14px 2px}'
    ].join('');
    document.head.appendChild(s);
  }catch(e){}
}
xaLogCss();
try{
  xaLogBoot();
  /* 存檔失敗也要記一筆：把 DB.set 包一層，只多記一筆，不改它的行為 */
  try{
    var _ovf0=(typeof IDBX!=='undefined'&&IDBX.overflow)?IDBX.overflow:null;
    if(_ovf0&&!IDBX.__xaLogOvf){
      IDBX.__xaLogOvf=1;
      IDBX.overflow=function(k,v){
        try{xaLogStatLoad().ovf=(XAL.stat.ovf||0)+1}catch(e){}
        var r;
        try{r=_ovf0.apply(this,arguments)}catch(e){xaLog('store','超大資料改放 IndexedDB 直接炸（'+String(k)+'）：'+window.xaLogError(e),'');throw e}
        try{if(r&&typeof r.catch==='function')r.catch(function(e){xaLog('store','超大資料改放 IndexedDB 沒成功（'+String(k)+'）：'+window.xaLogError(e),'')})}catch(e){}
        return r;
      };
    }
    var _xalOldSet=DB.set;
    if(typeof _xalOldSet==='function'&&!DB.__xaLogWrapped){
      DB.__xaLogWrapped=1;
      DB.set=function(k,v){
        var ok=_xalOldSet.apply(this,arguments);
        try{
          if(!ok&&k!=='xaLog'&&k!=='xaLogStat'){
            var now=Date.now();
            if(!XAL.storeAt||now-XAL.storeAt>15000){XAL.storeAt=now;xaLog('store','有一個東西存不進去（'+String(k)+'），重新整理就會不見','')}
          }
        }catch(e){}
        return ok;
      };
    }
  }catch(e){}
}catch(e){}


/* Attach to the shared chat/model request and task termination paths.
   The same program also ships inline in index.html; wrapping a second time
   would double every counter, so whoever gets here first owns the hooks. */
if(typeof window!=='undefined'&&window.__xaLogInstalled){
  // inline copy already attached: nothing to do
}else{
if(typeof window!=='undefined')window.__xaLogInstalled=1;
if(typeof sendChatRaw==='function'){
  var xaOriginalChatCall=sendChatRaw;
  sendChatRaw=async function(){
    try{var result=await xaOriginalChatCall.apply(this,arguments);xaLogApiOK();return result;}
    catch(e){xaLogApiErr(e);throw e;}
  };
}
if(typeof xaEnd==='function'){
  var xaOriginalEndTask=xaEnd;
  xaEnd=function(task,state){
    var previous=task&&task.state;
    var result=xaOriginalEndTask.apply(this,arguments);
    if(task&&task.state!==previous)xaLogXa(state,task);
    return result;
  };
}
if(typeof renderSettings==='function'){
  var xaOriginalSettings=renderSettings;
  renderSettings=function(){
    var result=xaOriginalSettings.apply(this,arguments);xaLogStat();return result;
  };
}
if(typeof v1215PeekRows==='function'){
  var xaOriginalPeekRows=v1215PeekRows;
  v1215PeekRows=function(){return xaOriginalPeekRows.apply(this,arguments)+v1217PeekRows();};
}
}
