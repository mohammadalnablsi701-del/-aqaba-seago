import React,{useState}from"react";
import{setProviderAccess}from"./api.js";
import SensitiveActionModal from"./SensitiveActionModal.jsx";

function generatePassword(){
  const groups=["ABCDEFGHJKLMNPQRSTUVWXYZ","abcdefghijkmnopqrstuvwxyz","23456789","!@#$%&*?"];
  const all=groups.join("");
  const bytes=new Uint32Array(24);crypto.getRandomValues(bytes);
  const chars=groups.map((g,i)=>g[bytes[i]%g.length]);
  for(let i=chars.length;i<18;i++)chars.push(all[bytes[i]%all.length]);
  for(let i=chars.length-1;i>0;i--){const j=bytes[(i+4)%bytes.length]%(i+1);[chars[i],chars[j]]=[chars[j],chars[i]]}
  return chars.join("");
}

export default function ProviderAccessManager({provider,token,onSaved}){
  const owner=provider?.ownerUserId||{};
  const[open,setOpen]=useState(false);
  const[email,setEmail]=useState(owner.email||"");
  const[name,setName]=useState(owner.name||provider?.businessName||"");
  const[temporaryPassword,setTemporaryPassword]=useState("");
  const[showPassword,setShowPassword]=useState(false);
  const[confirming,setConfirming]=useState(false);
  const[msg,setMsg]=useState("");
  const[copied,setCopied]=useState(false);

  async function copyPassword(){
    if(!temporaryPassword)return;
    try{await navigator.clipboard.writeText(temporaryPassword);setCopied(true);setTimeout(()=>setCopied(false),1600)}catch{setMsg("Copy failed. Press and hold the password to copy it.")}
  }
  function requestSave(e){
    e.preventDefault();setMsg("");
    if(temporaryPassword.length<12){setMsg("Temporary password must be at least 12 characters");return}
    setConfirming(true);
  }
  async function confirmSave(reason){
    const result=await setProviderAccess(token,provider._id,{email:email.trim(),name:name.trim(),temporaryPassword,reason});
    if(result?.provider?.status!==provider.status)throw new Error("Access update returned an unexpected provider lifecycle state");
    setMsg("Provider access updated");setTemporaryPassword("");setShowPassword(false);setCopied(false);setConfirming(false);
    if(onSaved)await onSaved();
  }

  if(!open)return <button className="secondary" type="button" onClick={()=>setOpen(true)}>Manage access</button>;
  return <>
    <form onSubmit={requestSave} style={{display:"grid",gap:14,width:"100%",marginTop:8,textAlign:"left"}}>
      <div style={{fontWeight:800,fontSize:18,color:"#173a50"}}>Provider access</div>
      <label style={{display:"grid",gap:6,width:"100%"}}><span style={{fontWeight:700}}>Name</span><input style={{boxSizing:"border-box",width:"100%",minWidth:0}} value={name} onChange={e=>setName(e.target.value)} required/></label>
      <label style={{display:"grid",gap:6,width:"100%"}}><span style={{fontWeight:700}}>Email</span><input style={{boxSizing:"border-box",width:"100%",minWidth:0}} type="email" autoCapitalize="none" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label style={{display:"grid",gap:6,width:"100%"}}><span style={{fontWeight:700}}>Temporary password</span><input style={{boxSizing:"border-box",width:"100%",minWidth:0}} type={showPassword?"text":"password"} minLength="12" value={temporaryPassword} onChange={e=>setTemporaryPassword(e.target.value)} placeholder="At least 12 characters" required/></label>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
        <button className="secondary" type="button" disabled={confirming} onClick={()=>{setTemporaryPassword(generatePassword());setShowPassword(true);setCopied(false);setMsg("")}}>Generate</button>
        <button className="secondary" type="button" disabled={confirming||!temporaryPassword} onClick={()=>setShowPassword(v=>!v)}>{showPassword?"Hide":"Show"}</button>
        <button className="secondary" type="button" disabled={confirming||!temporaryPassword} onClick={copyPassword}>{copied?"Copied":"Copy"}</button>
      </div>
      <small style={{lineHeight:1.45,color:"#71869a"}}>Copy the temporary password before saving. It will not be shown again after the update.</small>
      <button type="submit" disabled={confirming||temporaryPassword.length<12}>Review access change</button>
      <button className="secondary" type="button" disabled={confirming} onClick={()=>{setOpen(false);setTemporaryPassword("");setShowPassword(false);setCopied(false);setMsg("")}}>Cancel</button>
      {msg&&<small style={{lineHeight:1.45}}>{msg}</small>}
    </form>
    {confirming&&<SensitiveActionModal title="Reset provider access" subject={provider.businessName||"Provider"} impact="This will replace the provider sign-in password, apply the email/name shown above, and invalidate existing provider sessions. The provider lifecycle status will not change." details={[{label:"Email",value:email.trim()||"-"},{label:"Lifecycle",value:provider.status||"unknown"}]} confirmLabel="Reset access" danger reasonRequired reasonLabel="Security / operational reason" onCancel={()=>setConfirming(false)} onConfirm={confirmSave}/>} 
  </>;
}
