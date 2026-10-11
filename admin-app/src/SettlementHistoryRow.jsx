import React,{useState}from"react";
import{reverseSettlementPayment}from"./api.js";

export default function SettlementHistoryRow({settlement,token,onChanged}){
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const reversed=settlement.paymentTruth==="reversed";
  const currency=settlement.currency||"JOD";
  async function reverse(){
    if(reversed||busy)return;
    setBusy(true);setError("");
    try{await reverseSettlementPayment(token,settlement);await onChanged?.();}
    catch(e){if(!e?.cancelled)setError(e?.message||"Could not reverse settlement payment");}
    finally{setBusy(false);}
  }
  return <div className="settlement-history-row">
    <div>
      <b>{settlement.providerName}</b>
      <span>{new Date(settlement.periodFrom).toLocaleDateString()} → {new Date(settlement.periodTo).toLocaleDateString()}</span>
      <small>Historical status: Paid · Effective: {reversed?"Reversed":"Paid"}</small>
      {settlement.reason&&<small>Reason: {settlement.reason}</small>}
    </div>
    <div>
      <b>{Number(settlement.amountPaid||0).toFixed(2)} {currency}</b>
      <span>Effective paid: {Number(settlement.effectiveAmountPaid??settlement.amountPaid??0).toFixed(2)} {currency}</span>
      <small>Paid {new Date(settlement.paidAt).toLocaleString()}</small>
      {settlement.paidBy&&<small>By {settlement.paidBy.name||settlement.paidBy.email||"Admin"}</small>}
      {(settlement.corrections||[]).map(c=><small key={c.id}>
        Reversal {Number(c.amountDelta||0).toFixed(2)} {c.currency||currency} · {new Date(c.reversedAt).toLocaleString()} · {c.actor?.name||c.actor?.email||"Admin"} · {c.reason}
      </small>)}
      {!reversed&&<button type="button" className="danger" disabled={busy} onClick={reverse}>{busy?"Working...":"Reverse payment record"}</button>}
      {reversed&&<small>Original payment record preserved; correction is append-only.</small>}
      {error&&<small className="error" role="alert">{error}</small>}
    </div>
  </div>;
}
