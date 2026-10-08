import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PasswordRecovery from "./PasswordRecovery.jsx";
import "./styles.css";
import "./vessel-polish.css";
import { enableVesselUiPolish } from "./vesselUiPolish.js";

const params=new URLSearchParams(window.location.search);
const recovery=Boolean(params.get("resetToken")||params.get("forgotPassword"));

function PasswordRecoveryEntry(){
  useEffect(()=>{
    function sync(){
      document.querySelectorAll(".auth-panel").forEach(panel=>{
        const title=panel.querySelector(".auth-panel__head h2")?.textContent?.trim();
        const existing=panel.querySelector("[data-seago-forgot-password]");
        if(title!=="Sign in to book"){
          existing?.remove();
          return;
        }
        if(existing)return;
        const switchButton=panel.querySelector(".auth-switch");
        if(!switchButton)return;
        const button=document.createElement("button");
        button.type="button";
        button.className="auth-switch";
        button.dataset.seagoForgotPassword="1";
        button.textContent="Forgot password?";
        button.addEventListener("click",()=>{
          const url=new URL(window.location.href);
          url.searchParams.set("forgotPassword","1");
          window.location.href=url.pathname+"?"+url.searchParams.toString();
        });
        switchButton.before(button);
      });
    }
    sync();
    const observer=new MutationObserver(sync);
    observer.observe(document.getElementById("root"),{childList:true,subtree:true,characterData:true});
    return()=>observer.disconnect();
  },[]);
  return null;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {recovery?<PasswordRecovery/>:<><App/><PasswordRecoveryEntry/></>}
  </React.StrictMode>
);

if(!recovery)enableVesselUiPolish();

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+"sw.js").catch(err=>console.error("Service worker registration failed",err));
  });
}
