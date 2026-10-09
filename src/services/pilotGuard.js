import { getAladdinActivationGate } from "./realPilotData.js";

const ALADDIN_PROVIDER_RE=/(aladdin|alaa\s*aldeen|علاء\s*الدين)/i;

export function isAladdinProviderName(value){
  return ALADDIN_PROVIDER_RE.test(String(value||""));
}

export function isApprovedAladdinSukarTrip(trip={}){
  const title=String(trip?.titleEn||"").trim().toLowerCase();
  const vessel=String(trip?.vesselName||"").trim().toLowerCase();
  return title==="sukar"&&vessel==="sukar";
}

export function providerPilotSalesGate(providerName){
  if(!isAladdinProviderName(providerName))return {allowed:true,reason:null};
  const gate=getAladdinActivationGate();
  return {allowed:Boolean(gate.allowed),reason:gate.reason||null};
}

export function tripPilotSalesGate(providerName,trip){
  if(!isAladdinProviderName(providerName))return {allowed:true,reason:null};
  if(isApprovedAladdinSukarTrip(trip))return {allowed:true,reason:null};
  return providerPilotSalesGate(providerName);
}

export function isProviderPilotSalesAllowed(providerName){
  return providerPilotSalesGate(providerName).allowed;
}

export function isTripPilotSalesAllowed(providerName,trip){
  return tripPilotSalesGate(providerName,trip).allowed;
}
