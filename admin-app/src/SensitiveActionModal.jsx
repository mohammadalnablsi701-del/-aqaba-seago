import React,{useRef,useState}from"react";

export const REASON_MIN_LENGTH=4;
export const REASON_MAX_LENGTH=500;

export function validateSensitiveReason(value,{required=false}={}){
  const reason=String(value??"").trim();
  if(!reason&&!required)return{ok:true,value:""};
  if(reason.length<REASON_MIN_LENGTH)return{ok:false,error:`Reason must be at least ${REASON_MIN_LENGTH} characters.`};
  if(reason.length>REASON_MAX_LENGTH)return{ok:false,error:`Reason must be ${REASON_MAX_LENGTH} characters or fewer.`};
  return{ok:true,value:reason};
}

export default function SensitiveActionModal({title,subject,impact,details=[],confirmLabel="Confirm",danger=false,reasonRequired=false,reasonLabel="Reason",onCancel,onConfirm}){
  const[reason,setReason]=useState("");
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const locked=useRef(false);

  async function submit(e){
    e.preventDefault();
    if(locked.current)return;
    const checked=validateSensitiveReason(reason,{required:reasonRequired});
    if(!checked.ok){setError(checked.error);return;}
    locked.current=true;setBusy(true);setError("");
    try{await onConfirm(checked.value)}
    catch(err){setError(err?.message||"Action failed. Nothing was changed.")}
    finally{locked.current=false;setBusy(false)}
  }

  return <div className="sensitive-modal-backdrop" role="presentation">
    <form className="sensitive-modal" role="dialog" aria-modal="true" aria-labelledby="sensitive-action-title" onSubmit={submit}>
      <small className={danger?"sensitive-risk danger":"sensitive-risk"}>{danger?"HIGH-RISK ADMIN ACTION":"ADMIN CONFIRMATION"}</small>
      <h2 id="sensitive-action-title">{title}</h2>
      <div className="sensitive-subject">{subject}</div>
      <p>{impact}</p>
      {details.length>0&&<div className="sensitive-details">{details.map((item,i)=><div key={i}><span>{item.label}</span><b>{item.value}</b></div>)}</div>}
      {reasonRequired&&<label className="sensitive-reason"><span>{reasonLabel}</span><textarea value={reason} onChange={e=>{setReason(e.target.value);if(error)setError("")}} maxLength={REASON_MAX_LENGTH} rows="4" placeholder="Brief operational reason" disabled={busy}/><small>{reason.trim().length}/{REASON_MAX_LENGTH}</small></label>}
      {error&&<div className="error" role="alert">{error}</div>}
      <div className="sensitive-modal-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className={danger?"danger":""} disabled={busy}>{busy?"Working...":confirmLabel}</button>
      </div>
    </form>
  </div>;
}
