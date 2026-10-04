import React from "react";import{createRoot}from"react-dom/client";import App from"./App.jsx";import"./styles.css";import"./bookings-polish.css";import{enableBookingUiPolish}from"./bookingUiPolish.js";createRoot(document.getElementById("root")).render(<App/>);enableBookingUiPolish();

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+"sw.js").catch(err=>console.error("Service worker registration failed",err));
  });
}
