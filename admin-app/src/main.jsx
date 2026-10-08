import React from"react";
import{createRoot}from"react-dom/client";
import App from"./App.jsx";
import ProviderAccessManager from"./ProviderAccessManager.jsx";
import"./styles.css";

function storedAdmin(){try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")}catch{return null}}

function mountProviderAccess(){
  const mounts=new Map();
  let loading=false;
  async function sync(){
    const rows=[...document.querySelectorAll(".provider-admin-row")];
    for(const[node,root]of mounts){if(!node.isConnected){root.unmount();mounts.delete(node)}}
    if(!rows.length||loading)return;
    const auth=storedAdmin();if(!auth?.token)return;
    loading=true;
    try{
      const r=await fetch("https://aqaba-seago-api.onrender.com/api/admin/providers",{headers:{Authorization:`Bearer ${auth.token}`}});
      if(!r.ok)return;
      const data=await r.json();const providers=Array.isArray(data)?data:(data.providers||[]);
      for(const row of rows){
        const actions=row.querySelector(".provider-admin-actions");
        if(!actions||mounts.has(actions))continue;
        const name=row.querySelector(".provider-main h3")?.textContent?.trim();
        const provider=providers.find(p=>p.businessName===name);if(!provider)continue;
        const host=document.createElement("div");host.className="provider-access-host";actions.appendChild(host);
        const root=createRoot(host);root.render(<ProviderAccessManager provider={provider} token={auth.token}/>);mounts.set(host,root);
      }
    }catch{}finally{loading=false}
  }
  const observer=new MutationObserver(()=>queueMicrotask(sync));observer.observe(document.getElementById("root"),{childList:true,subtree:true});sync();
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
  mountProviderAccess();
}

ensureFreshAdmin();
