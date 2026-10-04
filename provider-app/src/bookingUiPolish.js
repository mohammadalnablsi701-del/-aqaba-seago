function polishBookingUi(root=document){
  root.querySelectorAll('.booking-card-main em.valid,.booking-detail-hero em.valid').forEach(el=>{
    if(el.textContent?.trim()==='PENDING')el.textContent='NOT CHECKED IN';
  });

  root.querySelectorAll('.booking-card-main span').forEach(el=>{
    const text=el.textContent||'';
    const match=text.match(/^(\d+) guest\(s\)(.*)$/);
    if(!match)return;
    const count=Number(match[1]);
    el.textContent=`${count} ${count===1?'guest':'guests'}${match[2]}`;
  });

  root.querySelectorAll('.booking-filters button').forEach(button=>{
    const text=button.textContent?.trim();
    if(text==='Not checked-in')button.textContent='Not checked in';
    if(text==='Checked-in')button.textContent='Checked in';
  });

  root.querySelectorAll('.booking-quick-actions button').forEach(button=>{
    if(button.textContent?.trim()==='Details')button.classList.add('details-secondary');
  });
}

export function enableBookingUiPolish(){
  polishBookingUi();
  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(node.nodeType===Node.ELEMENT_NODE)polishBookingUi(node);
      }
    }
  });
  observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
}
