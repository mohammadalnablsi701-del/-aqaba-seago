import React from "react";import{createRoot}from"react-dom/client";import App from"./App.jsx";import"./styles.css";import"./bookings-polish.css";import"./scanner-polish.css";import"./manifest-polish.css";import"./cold-start-polish.css";import"./vessel-polish.css";import"./commission-polish.css";import{enableBookingUiPolish}from"./bookingUiPolish.js";import{enableScannerUiPolish}from"./scannerUiPolish.js";import{enableManifestUiPolish}from"./manifestUiPolish.js";import{enableColdStartUiPolish}from"./coldStartUiPolish.js";import{enableVesselUiPolish}from"./vesselUiPolish.js";import{enableCommissionUiPolish}from"./commissionUiPolish.js";createRoot(document.getElementById("root")).render(<App/>);enableBookingUiPolish();enableScannerUiPolish();enableManifestUiPolish();enableColdStartUiPolish();enableVesselUiPolish();enableCommissionUiPolish();

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+"sw.js").catch(err=>console.error("Service worker registration failed",err));
  });
}
