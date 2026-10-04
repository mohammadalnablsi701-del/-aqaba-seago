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

function polishManifest(root=document){
  const sheet=root.matches?.('.manifest-sheet')?root:root.querySelector?.('.manifest-sheet');
  if(!sheet)return;

  sheet.querySelectorAll('.manifest-stats span').forEach(el=>{
    if(el.textContent?.trim()==='Remaining')el.textContent='Not checked in';
  });

  const filters=sheet.querySelector('.booking-filters');
  if(filters){
    const buttons=[...filters.querySelectorAll('button')];
    buttons.forEach(button=>{
      const text=button.textContent?.trim();
      if(text==='Pending')button.textContent='Not checked in';
      if(text==='Checked-in')button.textContent='Checked in';
    });
    const all=buttons.find(b=>b.textContent.trim()==='All');
    const waiting=buttons.find(b=>b.textContent.trim()==='Not checked in');
    const checked=buttons.find(b=>b.textContent.trim()==='Checked in');
    [all,waiting,checked].filter(Boolean).forEach(b=>filters.appendChild(b));
  }

  sheet.querySelectorAll('.manifest-main span').forEach(el=>{
    const next=personSummary(el.textContent?.trim());
    if(next!==el.textContent?.trim())el.textContent=next;
  });

  sheet.querySelectorAll('.manifest-main em.valid').forEach(el=>{
    if(['WAITING','PENDING'].includes(el.textContent?.trim()))el.textContent='NOT CHECKED IN';
  });

  sheet.querySelectorAll('.manifest-actions button').forEach(button=>{
    if(button.textContent?.trim()==='Details')button.classList.add('manifest-details-secondary');
  });
}

export function enableManifestUiPolish(){
  polishManifest();
  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(node.nodeType===Node.ELEMENT_NODE)polishManifest(node);
      }
    }
  });
  observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
}
