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
  if(!line){line=document.createElement("span");line.className=className;parent.appendChild(line);}
  line.textContent=`Vessel · ${text}`;
}

let activeForm=null;
let vesselDraft="";
function syncTripForm(){
  const form=document.querySelector(".trip-form-simple form");
  if(!form){activeForm=null;vesselDraft="";return;}
  const tripLabel=[...form.querySelectorAll("label")].find(label=>String(label.childNodes?.[0]?.textContent||label.textContent||"").trim().startsWith("Trip name"));
  if(!tripLabel)return;
  const titleInput=tripLabel.querySelector("input");
  if(form!==activeForm){
    activeForm=form;
    vesselDraft=vesselForText(titleInput?.value)||"";
  }
  let label=form.querySelector("[data-seago-vessel-field]");
  if(!label){
    label=document.createElement("label");
    label.dataset.seagoVesselField="1";
    label.appendChild(document.createTextNode("Vessel / boat name"));
    const input=document.createElement("input");
    input.dataset.seagoVesselInput="1";
    input.maxLength=120;
    input.placeholder="Example: بريز الخشبي";
    input.value=vesselDraft;
    input.addEventListener("input",()=>{vesselDraft=input.value;input.dataset.dirty="1";});
    label.appendChild(input);
    const help=document.createElement("small");
    help.className="field-help";
    help.textContent="Shown to customers on trip details, bookings and tickets.";
    label.appendChild(help);
    tripLabel.after(label);
  }else{
    const input=label.querySelector("[data-seago-vessel-input]");
    if(input&&!input.dataset.dirty&&!input.value){
      const cached=vesselForText(titleInput?.value);
      if(cached){input.value=cached;vesselDraft=cached;}
    }
  }
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
  syncTripForm();
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
  observer.observe(root,{childList:true,subtree:true,characterData:true});
  window.addEventListener("seago:provider-vessels-updated",run);
  const interval=setInterval(polish,500);
  return()=>{observer.disconnect();window.removeEventListener("seago:provider-vessels-updated",run);clearInterval(interval);cancelAnimationFrame(raf);};
}
