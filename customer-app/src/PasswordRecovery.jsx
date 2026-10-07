import React, { useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, LoaderCircle } from "lucide-react";
import BrandLogo from "./BrandLogo.jsx";
import { confirmPasswordReset, requestPasswordReset } from "./api.js";

function returnToSeaGo(){
  const url=new URL(window.location.href);
  url.searchParams.delete("resetToken");
  url.searchParams.delete("forgotPassword");
  window.location.href=url.pathname+(url.search?url.search:"");
}

export default function PasswordRecovery(){
  const params=useMemo(()=>new URLSearchParams(window.location.search),[]);
  const token=params.get("resetToken")||"";
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [done,setDone]=useState(false);

  async function requestLink(e){
    e.preventDefault();
    setBusy(true);setError("");setMessage("");
    try{
      const result=await requestPasswordReset(email);
      setMessage(result.message||"If an eligible account uses that email, a password reset link will be sent.");
    }catch(err){
      setError(err.message||"Could not request a password reset right now.");
    }finally{setBusy(false);}
  }

  async function resetPassword(e){
    e.preventDefault();
    setError("");setMessage("");
    if(password!==confirmPassword){setError("Passwords do not match.");return;}
    if(password.length<8||password.length>128){setError("Password must be 8–128 characters.");return;}
    setBusy(true);
    try{
      const result=await confirmPasswordReset(token,password);
      setMessage(result.message||"Password updated. Please sign in again.");
      setDone(true);
      localStorage.removeItem("seago_auth");
    }catch(err){
      setError(err.message||"This reset link is invalid or expired.");
    }finally{setBusy(false);}
  }

  return <div className="screen standard-screen booking-screen">
    <div className="booking-top"><button className="plain-back" type="button" onClick={returnToSeaGo}><ChevronLeft/></button><BrandLogo compact/><span/></div>
    <div className="auth-panel">
      <div className="auth-panel__head">
        <span>SEAGO ACCOUNT</span>
        <h2>{token?"Reset your password":"Forgot your password?"}</h2>
        <p>{token?"Choose a new password for your SeaGo account.":"Enter your email and we’ll send a secure reset link if the account is eligible."}</p>
      </div>

      {done?<>
        <div className="form-success"><CheckCircle2 size={18}/> {message}</div>
        <button className="primary-button auth-submit" type="button" onClick={returnToSeaGo}>Return to sign in</button>
      </>:token?<form onSubmit={resetPassword}>
        <input type="password" minLength="8" maxLength="128" autoComplete="new-password" placeholder="New password (8+ characters)" value={password} onChange={e=>setPassword(e.target.value)} required/>
        <input type="password" minLength="8" maxLength="128" autoComplete="new-password" placeholder="Confirm new password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/>
        {error&&<div className="form-error">{error}</div>}
        {message&&<div className="form-success">{message}</div>}
        <button className="primary-button auth-submit" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:null}Reset password</button>
      </form>:<form onSubmit={requestLink}>
        <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/>
        {error&&<div className="form-error">{error}</div>}
        {message&&<div className="form-success">{message}</div>}
        <button className="primary-button auth-submit" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:null}Send reset link</button>
      </form>}
      {!done&&<button className="auth-switch" type="button" onClick={returnToSeaGo}>Back to SeaGo</button>}
    </div>
  </div>;
}
