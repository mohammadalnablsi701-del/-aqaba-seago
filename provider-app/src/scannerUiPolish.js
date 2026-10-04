function pluralizePeople(adults, children){
  const parts=[];
  const a=Number(adults||0);
  const c=Number(children||0);
  if(a)parts.push(`${a} ${a===1?'adult':'adults'}`);
  if(c)parts.push(`${c} ${c===1?'child':'children'}`);
  return parts.join(' · ')||'No guests';
}

function polishScanner(root=document){
  const preview=root.querySelector?.('.ticket-preview');
  if(preview){
    const grid=preview.querySelector('.preview-grid');
    if(grid){
      const cells=[...grid.children];
      const byLabel=label=>cells.find(cell=>cell.querySelector('span')?.textContent?.trim()===label);
      const persons=byLabel('Persons');
      if(persons){
        const value=persons.querySelector('b');
        const text=value?.textContent||'';
        const m=text.match(/(\d+)\s+adult\(s\)\s*·\s*(\d+)\s+child\(ren\)/i);
        if(m)value.textContent=pluralizePeople(m[1],m[2]);
      }

      const tripTitle=preview.querySelector('h2')?.textContent?.trim();
      if(tripTitle&&!byLabel('Trip')){
        const trip=document.createElement('div');
        trip.className='scanner-trip-cell';
        trip.innerHTML='<span>Trip</span><b></b>';
        trip.querySelector('b').textContent=tripTitle;
        grid.prepend(trip);
        preview.querySelector('h2').style.display='none';
      }
    }

    const contact=preview.querySelector('.contact');
    if(contact&&!contact.closest('.scanner-phone-action')){
      const phone=contact.textContent?.trim();
      if(phone){
        const a=document.createElement('a');
        a.className='scanner-phone-action';
        a.href=`tel:${phone}`;
        a.innerHTML='<span>Phone</span><b></b><em>Call guest</em>';
        a.querySelector('b').textContent=phone;
        contact.replaceWith(a);
      }
    }

    const secondary=preview.querySelector('.secondary-scan');
    if(secondary)secondary.textContent='Scan another';
  }

  const success=root.querySelector?.('.scan-result.ok');
  if(success){
    const h2=success.querySelector('h2');
    if(h2)h2.textContent='CHECKED IN ✓';
    const p=success.querySelector('p');
    if(p){
      const text=p.textContent||'';
      const m=text.match(/(\d+)\s+person\(s\)\s+checked in/i);
      if(m){
        const n=Number(m[1]);
        p.textContent=`${n} ${n===1?'guest':'guests'} checked in successfully`;
      }
    }
    const button=success.querySelector('button');
    if(button)button.textContent='Scan next ticket';
  }
}

export function enableScannerUiPolish(){
  polishScanner();
  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(node.nodeType===Node.ELEMENT_NODE)polishScanner(node.closest?.('.scanner-screen')||node);
      }
    }
  });
  observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
}
