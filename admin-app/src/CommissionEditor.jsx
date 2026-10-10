import React,{useEffect,useState}from"react";
import{setCommission}from"./api.js";
import{commissionDisplay}from"./commissionDisplay.js";
import{
  COMMISSION_TYPE_OPTIONS,changeCommissionType,changeGuestStructure,commissionDraftFromPricing,
  setAdultCommission,validateCommissionDraft
}from"./commissionEditorModel.js";
import"./commission-editor.css";

const TIER_KEYS=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];

export default function CommissionEditor({trip,token,onSaved}){
  const source=trip?.pricing||{};
  const[currentPricing,setCurrentPricing]=useState(source);
  const[editing,setEditing]=useState(false);
  const[draft,setDraft]=useState(()=>commissionDraftFromPricing(source));
  const[saving,setSaving]=useState(false);
  const[msg,setMsg]=useState("");
  const signature=[source.commissionType,source.commissionValue,...TIER_KEYS.map(k=>source[k]),source.currency,source.buffetEnabled].join("|");
  useEffect(()=>{
    if(editing)return;
    setCurrentPricing(source);
    setDraft(commissionDraftFromPricing(source));
  },[trip?._id,signature]);

  const view=commissionDisplay(currentPricing);
  const currency=currentPricing.currency||"JOD";
  const canConfigureBuffet=Boolean(currentPricing.buffetEnabled||draft.buffetTiers);

  function begin(){setDraft(commissionDraftFromPricing(currentPricing));setMsg("");setEditing(true)}
  function cancel(){if(saving)return;setDraft(commissionDraftFromPricing(currentPricing));setMsg("");setEditing(false)}
  async function save(){
    if(saving)return;
    const checked=validateCommissionDraft(draft);
    if(!checked.ok){setMsg(checked.error);return}
    setSaving(true);setMsg("");
    try{
      const updated=await setCommission(token,trip._id,checked.payload);
      const trusted=updated?.pricing||currentPricing;
      setCurrentPricing(trusted);
      setDraft(commissionDraftFromPricing(trusted));
      setEditing(false);
      setMsg("Saved · applies to future bookings only");
      Promise.resolve(onSaved?.()).catch(()=>{});
    }catch(error){
      if(!error?.cancelled)setMsg(error?.message||"Commission update failed. Nothing was changed.");
    }finally{setSaving(false)}
  }

  return <section className="commission-manager" aria-label="Commission management">
    <div className="commission-manager__truth">
      <small>COMMISSION</small>
      <b>{view.title}</b>
      {view.summary&&view.summary!==view.title&&<span className={view.status==="configured"?"":"warning"}>{view.summary}</span>}
      {view.lines.map(line=><span className="commission-manager__line" key={line.label}><span>{line.label}</span><b>{line.value}</b></span>)}
    </div>
    {!editing?<button type="button" className="secondary commission-manager__edit" onClick={begin}>Edit commission</button>:<div className="commission-editor">
      <label className="commission-editor__field"><span>Commission type</span><select value={draft.commissionType} disabled={saving} onChange={e=>setDraft(d=>changeCommissionType(d,e.target.value))}><option value="" disabled>Select commission type</option>{COMMISSION_TYPE_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {draft.commissionType==="percentage"&&<MoneyField label="Commission rate" value={draft.commissionValue} suffix="%" disabled={saving} onChange={value=>setDraft(d=>({...d,commissionValue:value}))}/>} 
      {draft.commissionType==="fixed_per_booking"&&<MoneyField label="Commission per booking" value={draft.commissionValue} suffix={currency} disabled={saving} onChange={value=>setDraft(d=>({...d,commissionValue:value}))}/>} 
      {draft.commissionType==="fixed_per_person"&&<>
        <label className="commission-editor__field"><span>Per-guest structure</span><select value={draft.guestStructure} disabled={saving} onChange={e=>setDraft(d=>changeGuestStructure(d,e.target.value))}><option value="basic">One amount per guest</option><option value="tiered">Adult / child tiers</option></select></label>
        {draft.guestStructure==="basic"?<MoneyField label="Commission per guest" value={draft.commissionValue} suffix={currency} disabled={saving} onChange={value=>setDraft(d=>({...d,commissionValue:value}))}/>:<>
          <div className="commission-editor__grid">
            <MoneyField label="Adult" value={draft.adultCommission} suffix={currency} disabled={saving} onChange={value=>setDraft(d=>setAdultCommission(d,value))}/>
            <MoneyField label="Child" value={draft.childCommission} suffix={currency} disabled={saving} onChange={value=>setDraft(d=>({...d,childCommission:value}))}/>
          </div>
          {canConfigureBuffet&&<label className="commission-editor__check"><input type="checkbox" checked={draft.buffetTiers} disabled={saving} onChange={e=>setDraft(d=>({...d,buffetTiers:e.target.checked,buffetAdultCommission:e.target.checked?d.buffetAdultCommission:"",buffetChildCommission:e.target.checked?d.buffetChildCommission:""}))}/><span>Use separate buffet commission tiers</span></label>}
          {draft.buffetTiers&&<div className="commission-editor__grid">
            <MoneyField label="Adult + buffet" value={draft.buffetAdultCommission} suffix={currency} disabled={saving} onChange={value=>setDraft(d=>({...d,buffetAdultCommission:value}))}/>
            <MoneyField label="Child + buffet" value={draft.buffetChildCommission} suffix={currency} disabled={saving} onChange={value=>setDraft(d=>({...d,buffetChildCommission:value}))}/>
          </div>}
        </>}
      </>}
      <small className="commission-editor__history">This change applies to future bookings only. Existing booking pricing snapshots will remain unchanged.</small>
      {msg&&<div className="commission-editor__message" role="status">{msg}</div>}
      <div className="commission-editor__actions"><button type="button" onClick={save} disabled={saving}>{saving?"Saving...":"Save"}</button><button type="button" className="secondary" onClick={cancel} disabled={saving}>Cancel</button></div>
    </div>}
    {!editing&&<small className="commission-editor__history">Current agreement applies to future bookings only. Existing booking pricing snapshots are unchanged.</small>}
    {!editing&&msg&&<div className="commission-editor__message" role="status">{msg}</div>}
  </section>;
}

function MoneyField({label,value,suffix,disabled,onChange}){
  return <label className="commission-editor__field"><span>{label}</span><div className="commission-editor__input"><input inputMode="decimal" type="number" min="0" step="0.01" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)} placeholder="0.00"/><b>{suffix}</b></div></label>;
}
