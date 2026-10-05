const TARGET_TEXT="Loading provider account...";

function enhanceLoading(root=document){
  const loading=[...root.querySelectorAll?.('.onboarding-shell .loading')||[]].find(el=>el.textContent?.trim()===TARGET_TEXT||el.dataset.coldStartEnhanced==="1");
  if(!loading||loading.dataset.coldStartEnhanced==="1")return;
  loading.dataset.coldStartEnhanced="1";
  loading.classList.add('cold-start-loading');
  loading.innerHTML='<div class="cold-start-spinner" aria-hidden="true"></div><b>Connecting to SeaGo…</b><span class="cold-start-note">Loading your provider account.</span><button type="button" class="cold-start-retry" hidden>Retry</button>';
  const note=loading.querySelector('.cold-start-note');
  const retry=loading.querySelector('.cold-start-retry');
  const slowTimer=setTimeout(()=>{
    if(!document.body.contains(loading))return;
    note.textContent='Server is waking up — this may take a moment.';
  },3500);
  const retryTimer=setTimeout(()=>{
    if(!document.body.contains(loading))return;
    retry.hidden=false;
  },9000);
  retry?.addEventListener('click',()=>window.location.reload());
  const cleanup=()=>{clearTimeout(slowTimer);clearTimeout(retryTimer)};
  const watcher=new MutationObserver(()=>{if(!document.body.contains(loading)){cleanup();watcher.disconnect()}});
  watcher.observe(document.body,{childList:true,subtree:true});
}

export function enableColdStartUiPolish(){
  enhanceLoading();
  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(node.nodeType===Node.ELEMENT_NODE){
          enhanceLoading(node.matches?.('.onboarding-shell')?node:document);
        }
      }
    }
  });
  observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
}
