import React,{useState}from"react";
import{setProviderAccess}from"./api.js";

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
  const[busy,setBusy]=useState(false);
  const[msg,setMsg]=useState("");
  const[copied,setCopied]=useState(false);

  async function copyPassword(){
    if(!temporaryPassword)return;
    try{await navigator.clipboard.writeText(temporaryPassword);setCopied(true);setTimeout(()=>setCopied(false),1600)}catch{setMsg("Copy failed. Press and hold the password to copy it.")}
  }
  async function save(e){
    e.preventDefault();setBusy(true);setMsg("");
    try{
      await setProviderAccess(token,provider._id,{email:email.trim(),name:name.trim(),temporaryPassword});
      setMsg("Provider access updated");setTemporaryPassword("");setShowPassword(false);
      if(onSaved)await onSaved();
    }catch(err){setMsg(err.message||"Could not update provider access")}
    finally{setBusy(false)}
  }

  if(!open)return <button className="secondary" type="button" onClick={()=>setOpen(true)}>Manage access</button>;
  return <form onSubmit={save} style={{display:"grid",gap:14,width:"100%",marginTop:8,textAlign:"left"}}>
    <div style={{fontWeight:800,fontSize:18,color:"#173a50"}}>Provider access</div>
    <label style={{display:"grid",gap:6,width:"100%"}}><span style={{fontWeight:700}}>Name</span><input style={{boxSizing:"border-box",width:"100%",minWidth:0}} value={name} onChange={e=>setName(e.target.value)} required/></label>
    <label style={{display:"grid",gap:6,width:"100%"}}><span style={{fontWeight:700}}>Email</span><input style={{boxSizing:"border-box",width:"100%",minWidth:0}} type="email" autoCapitalize="none" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label style={{display:"grid",gap:6,width:"100%"}}><span style={{fontWeight:700}}>Temporary password</span><input style={{boxSizing:"border-box",width:"100%",minWidth:0}} type={showPassword?"text":"password"} minLength="12" value={temporaryPassword} onChange={e=>setTemporaryPassword(e.target.value)} placeholder="At least 12 characters" required/></label>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
      <button className="secondary" type="button" disabled={busy} onClick={()=>{setTemporaryPassword(generatePassword());setShowPassword(true);setCopied(false);setMsg("")}}>Generate</button>
      <button className="secondary" type="button" disabled={busy||!temporaryPassword} onClick={()=>setShowPassword(v=>!v)}>{showPassword?"Hide":"Show"}</button>
      <button className="secondary" type="button" disabled={busy||!temporaryPassword} onClick={copyPassword}>{copied?"Copied":"Copy"}</button>
    </div>
    <small style={{lineHeight:1.45,color:"#71869a"}}>Copy the temporary password before saving. It will not be shown again after the update.</small>
    <button type="submit" disabled={busy||temporaryPassword.length<12}>{busy?"Saving...":"Save access"}</button>
    <button className="secondary" type="button" disabled={busy} onClick={()=>{setOpen(false);setTemporaryPassword("");setShowPassword(false);setCopied(false);setMsg("")}}>Cancel</button>
    {msg&&<small style={{lineHeight:1.45}}>{msg}</small>}
  </form>;
}
