import React from"react";
import{createRoot}from"react-dom/client";
import App from"./App.jsx";
import ProviderAccessManager from"./ProviderAccessManager.jsx";
import"./styles.css";

function storedAdmin(){try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")}catch{return null}}
const aladdinProvider={_id:"6ac246c040006c42831c7532",businessName:"Aladdin Yachts & Marine Tours / Alaa Aldeen",ownerUserId:{name:"Aladdin Yachts & Marine Tours / Alaa Aldeen",email:"aladdin@providers.seago.test"}};
function AdminRoot(){const auth=storedAdmin();return <><App/>{auth?.token&&<div style={{position:"fixed",right:18,bottom:18,zIndex:9999}}><ProviderAccessManager provider={aladdinProvider} token={auth.token} onSaved={()=>Promise.resolve()}/></div>}</>}

async function ensureFreshAdmin(){
  try{
    const versionUrl=new URL("../version.json",window.location.href);
    versionUrl.searchParams.set("_",Date.now().toString());
    const r=await fetch(versionUrl,{cache:"no-store"});
    if(!r.ok)return;
    const v=await r.json();
    const commit=String(v?.commit||"").trim();
    if(!commit)return;
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
  createRoot(document.getElementById("root")).render(<AdminRoot/>);
}

ensureFreshAdmin();
