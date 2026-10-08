import { deleteAccount } from "./api.js";

function readAuth(){
  try{return JSON.parse(localStorage.getItem("seago_auth")||"null");}catch{return null;}
}

export function enableAccountDeletionUi(){
  function sync(){
    document.querySelectorAll(".profile-sub-screen").forEach(screen=>{
      const title=screen.querySelector(".profile-sub-header h1")?.textContent?.trim();
      const existing=screen.querySelector("[data-seago-delete-account]");
      if(title!=="Personal details"){
        existing?.remove();
        return;
      }
      if(existing)return;
      const auth=readAuth();
      if(!auth?.token)return;

      const section=document.createElement("section");
      section.className="phone-update-card";
      section.dataset.seagoDeleteAccount="1";
      section.innerHTML=`<div><b>Delete account</b><small>Permanently close your SeaGo customer account. Booking and financial records may be retained only where required for operations, fraud prevention, accounting, or legal obligations, but your login identity will be removed.</small></div>`;
      const button=document.createElement("button");
      button.type="button";
      button.className="profile-signout";
      button.textContent="Delete my account";
      button.addEventListener("click",async()=>{
        const confirmed=window.confirm("Delete your Aqaba SeaGo account? This cannot be undone.");
        if(!confirmed)return;
        const finalConfirm=window.confirm("Final confirmation: permanently delete this account and sign out now?");
        if(!finalConfirm)return;
        button.disabled=true;
        button.textContent="Deleting account...";
        try{
          await deleteAccount(auth.token);
          localStorage.removeItem("seago_auth");
          localStorage.removeItem("seago_favourites");
          window.location.assign(import.meta.env.BASE_URL||"/");
        }catch(error){
          button.disabled=false;
          button.textContent="Delete my account";
          window.alert(error?.message||"Could not delete account. Please try again.");
        }
      });
      section.appendChild(button);
      screen.appendChild(section);
    });
  }
  sync();
  const root=document.getElementById("root");
  if(!root)return()=>{};
  const observer=new MutationObserver(sync);
  observer.observe(root,{childList:true,subtree:true,characterData:true});
  return()=>observer.disconnect();
}
