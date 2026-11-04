import React from"react";
import{createRoot}from"react-dom/client";
import App from"./App.jsx";
import AdminActivityPanel from"./AdminActivityPanel.jsx";
import"./styles.css";
import"./sensitive-actions.css";
import"./admin-activity.css";

function LaunchReady(){React.useEffect(()=>{window.__seagoLaunchReady?.();},[]);return null;}

async function ensureFreshAdmin(){
  try{
    const versionUrl=new URL("../version.json",window.location.href);
    versionUrl.searchParams.set("_",Date.now().toString());
    const r=await fetch(versionUrl,{cache:"no-store"});
    // The preview may not publish version.json. Never leave the root blank.
    if(!r.ok)throw new Error("Version metadata unavailable");
    const v=await r.json();
    const commit=String(v?.commit||"").trim();
    if(!commit)throw new Error("Version commit unavailable");
    const key="seago_admin_build";
    const previous=localStorage.getItem(key);
    localStorage.setItem(key,commit);
    const current=new URL(window.location.href);
    if(previous&&previous!==commit&&current.searchParams.get("build")!==commit){
      current.searchParams.set("build",commit);
      window.location.replace(current.toString());
      return;
    }
  }catch{}
  createRoot(document.getElementById("root")).render(<><App/><AdminActivityPanel/><LaunchReady/></>);
}

ensureFreshAdmin();
