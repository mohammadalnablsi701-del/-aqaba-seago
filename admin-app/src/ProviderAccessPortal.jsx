import React,{useEffect,useState}from"react";
import{createPortal}from"react-dom";
import ProviderAccessManager from"./ProviderAccessManager.jsx";

export default function ProviderAccessPortal({providers,token}){
  const[targets,setTargets]=useState([]);
  useEffect(()=>{
    function locate(){
      const rows=[...document.querySelectorAll(".provider-admin-row")];
      const next=rows.map(row=>{
        const name=row.querySelector(".provider-main h3")?.textContent?.trim();
        const provider=providers.find(p=>p.businessName===name);
        const target=row.querySelector(".provider-admin-actions");
        return provider&&target?{provider,target}:null;
      }).filter(Boolean);
      setTargets(current=>current.length===next.length&&current.every((x,i)=>x.provider._id===next[i].provider._id&&x.target===next[i].target)?current:next);
    }
    locate();
    const observer=new MutationObserver(locate);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[providers]);
  return <>{targets.map(({provider,target})=>createPortal(<ProviderAccessManager key={provider._id} provider={provider} token={token} onSaved={()=>Promise.resolve()}/>,target))}</>;
}
