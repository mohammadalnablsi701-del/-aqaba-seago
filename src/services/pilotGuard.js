import { getAladdinActivationGate } from "./realPilotData.js";

const ALADDIN_PROVIDER_RE=/(aladdin|alaa\s*aldeen|علاء\s*الدين)/i;

export function isAladdinProviderName(value){
  return ALADDIN_PROVIDER_RE.test(String(value||""));
}

export function providerPilotSalesGate(providerName){
  if(!isAladdinProviderName(providerName))return {allowed:true,reason:null};
  const gate=getAladdinActivationGate();
  return {allowed:Boolean(gate.allowed),reason:gate.reason||null};
}

export function isProviderPilotSalesAllowed(providerName){
  return providerPilotSalesGate(providerName).allowed;
}
