let tripCommissions=new Map();

function rememberTrips(payload){
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:[];
  for(const trip of rows){
    const title=String(trip?.titleEn||trip?.titleAr||"").trim();
    if(!title)continue;
    const rate=trip?.pricing?.commissionType==="percentage"?Number(trip?.pricing?.commissionValue):20;
    tripCommissions.set(title,Number.isFinite(rate)?rate:20);
  }
}

function commissionForForm(form){
  const title=String(form.querySelector('input[placeholder="Example: Red Sea Snorkeling"]')?.value||"").trim();
  return tripCommissions.get(title)??20;
}

function polish(){
  document.querySelectorAll(".trip-form-simple form").forEach(form=>{
    let card=form.querySelector(".provider-commission-readonly");
    if(!card){
      card=document.createElement("div");
      card.className="provider-commission-readonly";
      card.innerHTML='<div><span>SeaGo commission</span><strong></strong></div><small>Managed by SeaGo admin · Read only</small>';
      const grid=form.querySelector(".form-grid");
      if(grid)grid.insertAdjacentElement("afterend",card);else form.prepend(card);
    }
    const rate=commissionForForm(form);
    const strong=card.querySelector("strong");
    const next=`${rate}% of total booking`;
    if(strong&&strong.textContent!==next)strong.textContent=next;
  });
}

export function enableCommissionUiPolish(){
  if(window.__seagoCommissionUiPolish)return;
  window.__seagoCommissionUiPolish=true;
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const response=await originalFetch(...args);
    try{
      const url=String(args[0]?.url||args[0]||"");
      if(url.includes("/api/providers/me/trips")&&response.ok){
        const payload=await response.clone().json();
        rememberTrips(payload);
        queueMicrotask(polish);
      }
    }catch{}
    return response;
  };
  let raf=0;
  const schedulePolish=()=>{
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(polish);
  };
  const observer=new MutationObserver(schedulePolish);
  observer.observe(document.getElementById("root")||document.body,{childList:true,subtree:true});
  document.addEventListener("input",e=>{if(e.target?.closest?.(".trip-form-simple"))schedulePolish()});
  polish();
}
