import test from "node:test";
import assert from "node:assert/strict";
import { isAladdinProviderName, providerPilotSalesGate, isProviderPilotSalesAllowed } from "../src/services/pilotGuard.js";

test("Aladdin provider variants stay fail-closed for sales",()=>{
  for(const name of ["Aladdin Yachts & Marine Tours","Aladdin Yachts & Marine Tours / Alaa Aldeen","علاء الدين لليخت والرحلات البحرية"]){
    assert.equal(isAladdinProviderName(name),true);
    assert.deepEqual(providerPilotSalesGate(name),{allowed:false,reason:"operator_confirmation_required"});
    assert.equal(isProviderPilotSalesAllowed(name),false);
  }
});

test("confirmed pilot providers are not blocked by the Aladdin guard",()=>{
  assert.equal(isProviderPilotSalesAllowed("Fun N Sun"),true);
  assert.equal(isProviderPilotSalesAllowed("Sea Breeze / Aquamarina"),true);
});
