const MIN_REASON_LENGTH=4;
const MAX_REASON_LENGTH=500;

export class SensitiveActionCancelledError extends Error{
  constructor(){super("");this.name="SensitiveActionCancelledError";this.cancelled=true;}
}

export function validateSensitiveReason(value,{required=false}={}){
  const reason=String(value??"").trim();
  if(!reason&&!required)return{ok:true,value:""};
  if(reason.length<MIN_REASON_LENGTH)return{ok:false,error:`Reason must be at least ${MIN_REASON_LENGTH} characters.`};
  if(reason.length>MAX_REASON_LENGTH)return{ok:false,error:`Reason must be ${MAX_REASON_LENGTH} characters or fewer.`};
  return{ok:true,value:reason};
}

function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;}

export function runSensitiveAction({title,subject,impact,details=[],confirmLabel="Confirm",danger=false,reasonRequired=false,reasonLabel="Reason",execute}){
  return new Promise((resolve,reject)=>{
    const backdrop=el("div","sensitive-modal-backdrop");backdrop.setAttribute("role","presentation");
    const form=el("form","sensitive-modal");form.setAttribute("role","dialog");form.setAttribute("aria-modal","true");
    const risk=el("small",danger?"sensitive-risk danger":"sensitive-risk",danger?"HIGH-RISK ADMIN ACTION":"ADMIN CONFIRMATION");
    const heading=el("h2",null,title);heading.id="sensitive-action-runtime-title";form.setAttribute("aria-labelledby",heading.id);
    form.append(risk,heading,el("div","sensitive-subject",subject),el("p",null,impact));
    if(details.length){const box=el("div","sensitive-details");for(const item of details){const row=el("div");row.append(el("span",null,item.label),el("b",null,item.value));box.append(row)}form.append(box)}
    let textarea=null,counter=null;
    if(reasonRequired){const label=el("label","sensitive-reason");label.append(el("span",null,reasonLabel));textarea=el("textarea");textarea.rows=4;textarea.maxLength=MAX_REASON_LENGTH;textarea.placeholder="Brief operational reason";counter=el("small",null,`0/${MAX_REASON_LENGTH}`);textarea.addEventListener("input",()=>{counter.textContent=`${textarea.value.trim().length}/${MAX_REASON_LENGTH}`;error.textContent=""});label.append(textarea,counter);form.append(label)}
    const error=el("div","error");error.setAttribute("role","alert");error.hidden=true;form.append(error);
    const actions=el("div","sensitive-modal-actions");const cancel=el("button","secondary","Cancel");cancel.type="button";const confirm=el("button",danger?"danger":"",confirmLabel);confirm.type="submit";actions.append(cancel,confirm);form.append(actions);backdrop.append(form);document.body.append(backdrop);
    let locked=false;
    const showError=message=>{error.hidden=false;error.textContent=String(message||"Action failed. Nothing was changed.")};
    const cleanup=()=>backdrop.remove();
    cancel.addEventListener("click",()=>{if(locked)return;cleanup();reject(new SensitiveActionCancelledError())});
    form.addEventListener("submit",async event=>{
      event.preventDefault();if(locked)return;
      const checked=validateSensitiveReason(textarea?.value||"",{required:reasonRequired});if(!checked.ok){showError(checked.error);textarea?.focus();return}
      locked=true;confirm.disabled=true;cancel.disabled=true;if(textarea)textarea.disabled=true;confirm.textContent="Working...";error.hidden=true;error.textContent="";
      try{const result=await execute(checked.value);cleanup();resolve(result)}catch(err){locked=false;confirm.disabled=false;cancel.disabled=false;if(textarea)textarea.disabled=false;confirm.textContent=confirmLabel;showError(err?.message||"Action failed. Nothing was changed.")}
    });
    (textarea||confirm).focus();
  });
}

const locks=new Map();
export function runLockedSensitiveAction(key,factory){
  if(locks.has(key))return locks.get(key);
  const promise=Promise.resolve().then(factory).finally(()=>locks.delete(key));
  locks.set(key,promise);return promise;
}
