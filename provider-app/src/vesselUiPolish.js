function store(){
  return window.__seagoProviderVesselStore||{byId:{},byTitle:{},lastInspected:null};
}
function vesselForText(text){
  const raw=String(text||"").trim();
  if(!raw)return"";
  const byTitle=store().byTitle||{};
  if(byTitle[raw])return byTitle[raw];
  const match=Object.keys(byTitle).sort((a,b)=>b.length-a.length).find(title=>raw.includes(title));
  return match?byTitle[match]:"";
}
function ensureLine(parent,className,text){
  if(!parent)return;
  let line=parent.querySelector(`:scope > .${className}`);
  if(!text){line?.remove();return;}
  const next=`Vessel · ${text}`;
  if(!line){line=document.createElement("span");line.className=className;line.textContent=next;parent.appendChild(line);return;}
  if(line.textContent!==next)line.textContent=next;
}

function decorateTripCards(){
  document.querySelectorAll(".trip-card").forEach(card=>{
    const h3=card.querySelector("h3");
    const vessel=vesselForText(h3?.textContent);
    const host=card.querySelector(".trip-card-title > div")||h3?.parentElement;
    ensureLine(host,"seago-vessel-provider-line",vessel);
  });
  document.querySelectorAll(".quick-trip-card").forEach(card=>{
    const h3=card.querySelector("h3");
    ensureLine(h3?.parentElement,"seago-vessel-provider-line",vesselForText(h3?.textContent));
  });
}
function decorateBookings(){
  document.querySelectorAll(".booking-card").forEach(card=>{
    const host=card.querySelector(".booking-card-main > div");
    const vessel=vesselForText(host?.textContent);
    ensureLine(host,"seago-vessel-provider-line",vessel);
  });
}
function decorateManifest(){
  document.querySelectorAll(".manifest-sheet").forEach(sheet=>{
    const h2=sheet.querySelector(".manage-form-head h2");
    const vessel=vesselForText(h2?.textContent);
    const host=h2?.parentElement;
    ensureLine(host,"seago-vessel-provider-line",vessel);
  });
}
function decorateScanner(){
  document.querySelectorAll(".ticket-preview").forEach(preview=>{
    const h2=preview.querySelector("h2");
    const vessel=vesselForText(h2?.textContent)||store().lastInspected||"";
    ensureLine(h2?.parentElement,"seago-vessel-provider-line",vessel);
  });
}
function decorateDetails(){
  document.querySelectorAll(".detail-sheet").forEach(sheet=>{
    if(sheet.classList.contains("manifest-sheet"))return;
    const h2=sheet.querySelector("h2");
    const vessel=vesselForText(h2?.textContent)||vesselForText(sheet.textContent);
    ensureLine(h2?.parentElement,"seago-vessel-provider-line",vessel);
  });
}
function polish(){
  decorateTripCards();
  decorateBookings();
  decorateManifest();
  decorateScanner();
  decorateDetails();
}
export function enableVesselUiPolish(){
  let raf=0;
  const run=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(polish);};
  run();
  const root=document.getElementById("root")||document.body;
  const observer=new MutationObserver(run);
  observer.observe(root,{childList:true,subtree:true});
  window.addEventListener("seago:provider-vessels-updated",run);
  return()=>{observer.disconnect();window.removeEventListener("seago:provider-vessels-updated",run);cancelAnimationFrame(raf);};
}
