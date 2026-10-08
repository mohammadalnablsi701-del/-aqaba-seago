import React,{useEffect,useState}from"react";
import{createRoot}from"react-dom/client";
import App from"./App.jsx";
import ProviderAccessPortal from"./ProviderAccessPortal.jsx";
import"./styles.css";

function storedAdmin(){try{return JSON.parse(localStorage.getItem("seago_admin_auth")||"null")}catch{return null}}
function AdminRoot(){
  const auth=storedAdmin();
  const[providerRows,setProviderRows]=useState([]);
  useEffect(()=>{
    if(!auth?.token)return;
    let active=true;
    async function load(){
      try{
        const r=await fetch("https://aqaba-seago-api.onrender.com/api/admin/providers",{headers:{Authorization:`Bearer ${auth.token}`}});
        if(!r.ok)return;
        const data=await r.json();
        if(active)setProviderRows(Array.isArray(data)?data:(data.providers||[]));
      }catch{}
    }
    load();
    window.addEventListener("seago:providers-refresh",load);
    return()=>{active=false;window.removeEventListener("seago:providers-refresh",load)};
  },[auth?.token]);
  return <><App/>{auth?.token&&providerRows.length>0&&<ProviderAccessPortal providers={providerRows} token={auth.token}/>}</>;
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
  createRoot(document.getElementById("root")).render(<AdminRoot/>);
}

ensureFreshAdmin();
