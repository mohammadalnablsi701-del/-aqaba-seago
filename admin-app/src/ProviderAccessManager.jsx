import React,{useState}from"react";
import{setProviderAccess}from"./api.js";

export default function ProviderAccessManager({provider,token,onSaved}){
  const owner=provider?.ownerUserId||{};
  const[open,setOpen]=useState(false);
  const[email,setEmail]=useState(owner.email||"");
  const[name,setName]=useState(owner.name||provider?.businessName||"");
  const[temporaryPassword,setTemporaryPassword]=useState("");
  const[busy,setBusy]=useState(false);
  const[msg,setMsg]=useState("");

  async function save(e){
    e.preventDefault();setBusy(true);setMsg("");
    try{
      await setProviderAccess(token,provider._id,{email:email.trim(),name:name.trim(),temporaryPassword});
      setMsg("Provider access updated");setTemporaryPassword("");
      if(onSaved)await onSaved();
    }catch(err){setMsg(err.message||"Could not update provider access")}
    finally{setBusy(false)}
  }

  if(!open)return <button className="secondary" type="button" onClick={()=>setOpen(true)}>Manage access</button>;
  return <form onSubmit={save} className="provider-access-manager">
    <label><span>Name</span><input value={name} onChange={e=>setName(e.target.value)} required/></label>
    <label><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label><span>Temporary password</span><input type="password" minLength="12" value={temporaryPassword} onChange={e=>setTemporaryPassword(e.target.value)} placeholder="At least 12 characters" required/></label>
    <div className="provider-access-actions"><button type="submit" disabled={busy}>{busy?"Saving...":"Save access"}</button><button className="secondary" type="button" disabled={busy} onClick={()=>{setOpen(false);setTemporaryPassword("");setMsg("")}}>Cancel</button></div>
    {msg&&<small>{msg}</small>}
  </form>;
}
