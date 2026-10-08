import React,{useEffect,useState}from"react";
import{createPortal}from"react-dom";
import ProviderAccessManager from"./ProviderAccessManager.jsx";

export default function ProviderAccessPortal({provider,token}){
  const[target,setTarget]=useState(null);
  useEffect(()=>{
    function locate(){
      const rows=[...document.querySelectorAll(".provider-admin-row")];
      const row=rows.find(el=>el.textContent?.includes(provider.businessName));
      const actions=row?.querySelector(".provider-admin-actions")||null;
      setTarget(current=>current===actions?current:actions);
    }
    locate();
    const observer=new MutationObserver(locate);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[provider.businessName]);
  if(!target)return null;
  return createPortal(<ProviderAccessManager provider={provider} token={token} onSaved={()=>Promise.resolve()}/>,target);
}
