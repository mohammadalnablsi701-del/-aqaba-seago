let tripCommissions=new Map();

const SUPPORTED_TYPES=new Set(["percentage","fixed_per_person","fixed_per_booking"]);

function nonNegativeNumber(value){
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:null;
}

function normalizeCommission(pricing){
  if(!pricing||typeof pricing!=="object")return null;
  const type=String(pricing.commissionType||"").trim();
  const value=nonNegativeNumber(pricing.commissionValue);
  if(!SUPPORTED_TYPES.has(type)||value===null)return null;

  const currency=String(pricing.currency||"JOD").trim()||"JOD";
  const commission={type,value,currency,buffetEnabled:Boolean(pricing.buffetEnabled)};

  if(type==="fixed_per_person"){
    for(const key of ["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"]){
      if(pricing[key]===undefined||pricing[key]===null)continue;
      const tierValue=nonNegativeNumber(pricing[key]);
      if(tierValue===null)return null;
      commission[key]=tierValue;
    }
  }

  return commission;
}

function rememberTrips(payload){
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:[];
  tripCommissions=new Map();
  for(const trip of rows){
    const title=String(trip?.titleEn||trip?.titleAr||"").trim();
    if(!title)continue;
    tripCommissions.set(title,normalizeCommission(trip?.pricing));
  }
}

function commissionForForm(form,card){
  const mode=String(form.closest(".trip-form-simple")?.querySelector(".manage-form-head small")?.textContent||"").trim().toUpperCase();
  if(mode!=="EDIT TRIP")return null;

  const title=String(form.querySelector('input[placeholder="Example: Red Sea Snorkeling"]')?.value||"").trim();
  if(tripCommissions.has(title)){
    const commission=tripCommissions.get(title);
    card.__seagoCommission=commission;
    return commission;
  }

  return card.__seagoCommission??null;
}

function money(value,currency){
  return `${Number(value).toFixed(2)} ${currency}`;
}

function percentage(value){
  return Number.isInteger(value)?String(value):Number(value).toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
}

function commissionLabel(commission){
  if(!commission)return "Commission not configured";

  if(commission.type==="percentage"){
    return `${percentage(commission.value)}% of total booking`;
  }

  if(commission.type==="fixed_per_booking"){
    return `${money(commission.value,commission.currency)} per booking`;
  }

  if(commission.type==="fixed_per_person"){
    const hasTieredValues=[
      commission.adultCommission,
      commission.childCommission,
      commission.buffetAdultCommission,
      commission.buffetChildCommission
    ].some(value=>value!==undefined);

    if(!hasTieredValues){
      return `${money(commission.value,commission.currency)} per guest`;
    }

    const adult=commission.adultCommission??commission.value;
    const child=commission.childCommission??commission.value;
    const buffetAdult=commission.buffetAdultCommission??commission.adultCommission??commission.value;
    const buffetChild=commission.buffetChildCommission??commission.childCommission??commission.value;
    let label=`${money(adult,commission.currency)} adult · ${money(child,commission.currency)} child per guest`;
    if(commission.buffetAdultCommission!==undefined||commission.buffetChildCommission!==undefined){
      label+=` · buffet: ${money(buffetAdult,commission.currency)} adult / ${money(buffetChild,commission.currency)} child`;
    }
    return label;
  }

  return "Commission not configured";
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
    const next=commissionLabel(commissionForForm(form,card));
    const strong=card.querySelector("strong");
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
