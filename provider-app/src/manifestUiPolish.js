function plural(count,singular,pluralForm){return `${count} ${count===1?singular:pluralForm}`;}
function personSummary(text){
  const match=String(text||'').match(/^(\d+) guest\(s\)(?: · (\d+)A\/(\d+)C)?$/);
  if(!match)return text;
  const guests=Number(match[1]);
  const adults=Number(match[2]||0);
  const children=Number(match[3]||0);
  const parts=[plural(guests,'guest','guests')];
  if(adults)parts.push(plural(adults,'adult','adults'));
  if(children)parts.push(plural(children,'child','children'));
  return parts.join(' · ');
}

function setTextIfChanged(el,next){
  if(!el)return;
  const current=(el.textContent||'').trim();
  if(current!==next)el.textContent=next;
}

function polishManifest(sheet){
  sheet.querySelectorAll('.manifest-stats span').forEach(el=>{
    const text=(el.textContent||'').trim().toLowerCase();
    if(text==='remaining')setTextIfChanged(el,'Not checked in');
  });

  const filters=sheet.querySelector('.booking-filters');
  if(filters){
    const buttons=[...filters.querySelectorAll('button')];
    buttons.forEach(button=>{
      const text=(button.textContent||'').trim().toLowerCase();
      if(text==='pending')setTextIfChanged(button,'Not checked in');
      if(text==='checked-in')setTextIfChanged(button,'Checked in');
    });

    const current=[...filters.querySelectorAll('button')];
    const all=current.find(b=>(b.textContent||'').trim()==='All');
    const waiting=current.find(b=>(b.textContent||'').trim()==='Not checked in');
    const checked=current.find(b=>(b.textContent||'').trim()==='Checked in');
    const desired=[all,waiting,checked].filter(Boolean);
    const alreadyOrdered=desired.length===current.length&&desired.every((button,index)=>current[index]===button);
    if(desired.length&& !alreadyOrdered)filters.append(...desired);
  }

  sheet.querySelectorAll('.manifest-main span').forEach(el=>{
    const before=(el.textContent||'').trim();
    const next=personSummary(before);
    if(next!==before)setTextIfChanged(el,next);
  });

  sheet.querySelectorAll('.manifest-main em.valid').forEach(el=>{
    const text=(el.textContent||'').trim().toUpperCase();
    if(text==='WAITING'||text==='PENDING')setTextIfChanged(el,'NOT CHECKED IN');
  });

  sheet.querySelectorAll('.manifest-actions button').forEach(button=>{
    if((button.textContent||'').trim()==='Details')button.classList.add('manifest-details-secondary');
  });
}

function polishAllManifests(){
  document.querySelectorAll('.manifest-sheet').forEach(polishManifest);
}

function nodeTouchesManifest(node){
  if(!(node instanceof Element))return false;
  return node.matches('.manifest-sheet')||Boolean(node.closest('.manifest-sheet'))||Boolean(node.querySelector('.manifest-sheet'));
}

export function enableManifestUiPolish(){
  let raf=0;
  let disposed=false;
  const run=()=>{
    if(disposed||raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      polishAllManifests();
    });
  };

  run();
  const root=document.getElementById('root')||document.body;
  const observer=new MutationObserver(mutations=>{
    const relevant=mutations.some(mutation=>{
      if(mutation.type!=='childList')return false;
      if(nodeTouchesManifest(mutation.target))return true;
      return [...mutation.addedNodes,...mutation.removedNodes].some(nodeTouchesManifest);
    });
    if(relevant)run();
  });
  observer.observe(root,{childList:true,subtree:true});

  return()=>{
    disposed=true;
    observer.disconnect();
    if(raf)cancelAnimationFrame(raf);
    raf=0;
  };
}
