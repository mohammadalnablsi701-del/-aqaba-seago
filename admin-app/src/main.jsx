import React from"react";
import{createRoot}from"react-dom/client";
import App from"./App.jsx";
import ProviderAccessManager from"./ProviderAccessManager.jsx";
import"./styles.css";

function storedAdmin(){try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")}catch{return null}}

function enableProviderAccessControls(){
  let scheduled=false;
  let providersCache=null;
  let providersPromise=null;

  async function getProviders(token){
    if(providersCache)return providersCache;
    if(!providersPromise)providersPromise=fetch("https://aqaba-seago-api.onrender.com/api/admin/providers",{headers:{Authorization:`Bearer ${token}`}}).then(async r=>{if(!r.ok)throw new Error("Could not load providers");const data=await r.json();return Array.isArray(data)?data:(data.providers||[])}).then(rows=>(providersCache=rows)).finally(()=>{providersPromise=null});
    return providersPromise;
  }

  async function sync(){
    scheduled=false;
    const rows=[...document.querySelectorAll(".provider-admin-row")];
    if(!rows.length)return;
    const auth=storedAdmin();if(!auth?.token)return;
    let providerRows;
    try{providerRows=await getProviders(auth.token)}catch{return}
    for(const row of rows){
      const actions=row.querySelector(".provider-admin-actions");
      if(!actions||actions.querySelector(":scope > .provider-access-host"))continue;
      const name=row.querySelector(".provider-main h3")?.textContent?.trim();
      const provider=providerRows.find(p=>p.businessName===name);if(!provider)continue;
      const host=document.createElement("div");host.className="provider-access-host";host.dataset.providerId=provider._id;
      actions.appendChild(host);
      createRoot(host).render(<ProviderAccessManager provider={provider} token={auth.token}/>);
    }
  }

  function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(sync)}
  const observer=new MutationObserver(schedule);
  observer.observe(document.getElementById("root"),{childList:true,subtree:true});
  window.addEventListener("seago:session-expired",()=>{providersCache=null});
  schedule();
}

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
  createRoot(document.getElementById("root")).render(<App/>);
  enableProviderAccessControls();
}

ensureFreshAdmin();
