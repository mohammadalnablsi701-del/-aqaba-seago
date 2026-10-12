import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.jsx";
import PasswordRecovery from "./PasswordRecovery.jsx";
import "./styles.css";
import "./vessel-polish.css";
import "./cancellation-ux.css";
import "./customer-parity.css";
import "./native-parity.css";
import { enableAccountDeletionUi } from "./accountDeletionUi.js";
import { enableCancellationUi } from "./cancellationUi.js";
import { customerHeroAssetUrl, enableCustomerHomeParity } from "./homeParity.js";
import { enableNotificationLogoutGuard } from "./notificationCredentialLifecycle.js";
import { syncNativeStorePanels } from "./nativeStoreGuard.js";

const params=new URLSearchParams(window.location.search);
if(params.get("open")==="tickets") sessionStorage.setItem("seago_active_screen","tickets");
const recovery=Boolean(params.get("resetToken")||params.get("forgotPassword"));
const nativeApp=Capacitor.isNativePlatform();
document.documentElement.style.setProperty("--seago-hero-image",`url("${customerHeroAssetUrl(import.meta.env.BASE_URL)}")`);
if(nativeApp){
  document.documentElement.dataset.seagoNative="1";
}

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

function NativeStoreGuard(){
  useEffect(()=>{
    if(!nativeApp)return;
    function sync(){
      syncNativeStorePanels(document);
    }
    sync();
    const root=document.getElementById("root");
    if(!root)return;
    const observer=new MutationObserver(sync);
    observer.observe(root,{childList:true,subtree:true,characterData:true});
    return()=>observer.disconnect();
  },[]);
  return null;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {recovery?<PasswordRecovery/>:<><App/><PasswordRecoveryEntry/><NativeStoreGuard/></>}
  </React.StrictMode>
);

if(!recovery){
  enableCustomerHomeParity();
  enableAccountDeletionUi();
  enableCancellationUi();
  enableNotificationLogoutGuard();
}

if(!nativeApp&&"serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+"sw.js").catch(()=>console.error("Service worker registration failed"));
  });
}
