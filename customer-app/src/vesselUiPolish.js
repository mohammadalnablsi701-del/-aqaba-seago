function store(){return window.__seagoVesselStore||{byId:{},byTitle:{}};}
function vesselForText(text){
  const raw=String(text||"").trim();
  if(!raw)return"";
  const byTitle=store().byTitle||{};
  if(byTitle[raw])return byTitle[raw];
  const match=Object.keys(byTitle).sort((a,b)=>b.length-a.length).find(title=>raw.includes(title));
  return match?byTitle[match]:"";
}
function ensureLine(parent,className,text,label="Vessel"){
  if(!parent)return;
  let line=parent.querySelector(`:scope > .${className}`);
  if(!text){line?.remove();return;}
  if(!line){line=document.createElement("span");line.className=className;parent.appendChild(line);}
  line.textContent=`${label} · ${text}`;
}
function decorateTripCards(){
  document.querySelectorAll(".trip-card").forEach(card=>{
    const h3=card.querySelector("h3");
    const vessel=vesselForText(h3?.textContent);
    const facts=card.querySelector(".trip-card__facts")||h3?.parentElement;
    ensureLine(facts,"seago-vessel-card",vessel);
  });
}
function decorateDetail(){
  document.querySelectorAll("h1").forEach(h1=>{
    const vessel=vesselForText(h1.textContent);
    if(!vessel)return;
    const host=h1.parentElement;
    ensureLine(host,"seago-vessel-detail",vessel);
  });
}
function decorateBooking(){
  document.querySelectorAll(".booking-summary").forEach(summary=>{
    const h3=summary.querySelector("h3");
    const vessel=vesselForText(h3?.textContent);
    const host=h3?.parentElement;
    ensureLine(host,"seago-vessel-booking",vessel);
  });
}
function decorateTickets(){
  document.querySelectorAll(".ticket-card").forEach(card=>{
    const h2=card.querySelector(".ticket-card__top h2");
    const vessel=vesselForText(h2?.textContent);
    const host=h2?.parentElement;
    ensureLine(host,"seago-vessel-ticket",vessel);
  });
}
function polish(){decorateTripCards();decorateDetail();decorateBooking();decorateTickets();}
export function enableVesselUiPolish(){
  let raf=0;
  const run=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(polish);};
  run();
  const root=document.getElementById("root")||document.body;
  const observer=new MutationObserver(run);
  observer.observe(root,{childList:true,subtree:true,characterData:true});
  window.addEventListener("seago:vessels-updated",run);
  const interval=setInterval(polish,500);
  return()=>{observer.disconnect();window.removeEventListener("seago:vessels-updated",run);clearInterval(interval);cancelAnimationFrame(raf);};
}
