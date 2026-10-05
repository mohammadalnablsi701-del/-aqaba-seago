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

function polishManifest(){
  document.querySelectorAll('.manifest-sheet').forEach(sheet=>{
    sheet.querySelectorAll('.manifest-stats span').forEach(el=>{
      const text=(el.textContent||'').trim().toLowerCase();
      if(text==='remaining')el.textContent='Not checked in';
    });

    const filters=sheet.querySelector('.booking-filters');
    if(filters){
      const buttons=[...filters.querySelectorAll('button')];
      buttons.forEach(button=>{
        const text=(button.textContent||'').trim().toLowerCase();
        if(text==='pending')button.textContent='Not checked in';
        if(text==='checked-in')button.textContent='Checked in';
      });
      const current=[...filters.querySelectorAll('button')];
      const all=current.find(b=>(b.textContent||'').trim()==='All');
      const waiting=current.find(b=>(b.textContent||'').trim()==='Not checked in');
      const checked=current.find(b=>(b.textContent||'').trim()==='Checked in');
      [all,waiting,checked].filter(Boolean).forEach(b=>filters.appendChild(b));
    }

    sheet.querySelectorAll('.manifest-main span').forEach(el=>{
      const before=(el.textContent||'').trim();
      const next=personSummary(before);
      if(next!==before)el.textContent=next;
    });

    sheet.querySelectorAll('.manifest-main em.valid').forEach(el=>{
      const text=(el.textContent||'').trim().toUpperCase();
      if(text==='WAITING'||text==='PENDING')el.textContent='NOT CHECKED IN';
    });

    sheet.querySelectorAll('.manifest-actions button').forEach(button=>{
      if((button.textContent||'').trim()==='Details')button.classList.add('manifest-details-secondary');
    });
  });
}

export function enableManifestUiPolish(){
  let raf=0;
  const run=()=>{
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(polishManifest);
  };
  run();
  const observer=new MutationObserver(run);
  observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true,characterData:true});
  const interval=setInterval(polishManifest,500);
  return()=>{observer.disconnect();clearInterval(interval);cancelAnimationFrame(raf);};
}
