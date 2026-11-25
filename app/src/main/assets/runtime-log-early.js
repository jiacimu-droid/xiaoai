/* v1217 日誌 shim：這段排在全部程式碼最前面（連載入守門都在它後面），
   所以「檔案只抓到一半」「圖片載不出來」「某段腳本一開就炸」這種錯才收得到。
   它只往 window.__xaLogBuf 塞東西，不碰別的；主程式後段會把這些撈回去存檔。 */
(function(){
  try{
    if(window.__xaLogShim)return;
    window.__xaLogShim=1;
    if(window!==window.top)return;
    var B=window.__xaLogBuf=[];
    window.xaLogError=function(error){
      var name=String(error&&error.name||'Error');
      if(!/^[A-Za-z][A-Za-z0-9]*Error$/.test(name)&&name!=='Error')name='Error';
      var message=String(error&&error.message||'');
      var http=message.match(/(?:HTTP|API|status)\s*([1-5][0-9]{2})\b/i);
      return http?name+' HTTP '+http[1]:name;
    };
    window.xaLogLocation=function(url,line){
      try{
        var local=new URL(url,location.href);
        if(local.origin===location.origin&&/^\/assets\/[\w./-]+$/.test(local.pathname)){
          return local.pathname+(line?':'+line:'');
        }
      }catch(_){}
      return '';
    };
    function push(k,m,d){
      var t=Date.now();
      try{if(typeof window.__xaLogSink==='function')return window.__xaLogSink(t,k,m,d)}catch(e){}
      if(B.length>400)return;
      B.push([t,k,String(m==null?'':m).slice(0,300),String(d==null?'':d).slice(0,800)]);
    }
    window.__xaLogRaw=push;
    /* capture=true 才收得到圖片／音檔這種資源載入失敗 */
    window.addEventListener('error',function(e){
      try{
        var tg=e&&e.target;
        if(tg&&tg!==window&&tg.tagName){push('res',tg.tagName+' 載入失敗',window.xaLogLocation(tg.currentSrc||tg.src||tg.href));return}
        push('err',window.xaLogError(e&&e.error),window.xaLogLocation(e&&e.filename,e&&e.lineno));
      }catch(_){}
    },true);
    window.addEventListener('unhandledrejection',function(e){
      try{
        var r=e&&e.reason;
        push('promise',window.xaLogError(r),'');
      }catch(_){}
    });
    ['error','warn'].forEach(function(k){
      var original=console[k];
      if(typeof original!=='function')return;
      console[k]=function(){
        var error=arguments[0];
        push(k==='error'?'cerr':'warn',error instanceof Error?window.xaLogError(error):'console.'+k,'');
        return original.apply(console,arguments);
      };
    });
    push('boot','頁面開始載入','');
  }catch(_e){}
})();
