import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PasswordRecovery from "./PasswordRecovery.jsx";
import "./styles.css";

const params=new URLSearchParams(window.location.search);
const recovery=Boolean(params.get("resetToken")||params.get("forgotPassword"));

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {recovery?<PasswordRecovery/>:<App />}
  </React.StrictMode>
);


if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+"sw.js").catch(err=>console.error("Service worker registration failed",err));
  });
}
