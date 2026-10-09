import test from "node:test";
import assert from "node:assert/strict";
import { getAladdinActivationGate } from "../src/services/realPilotData.js";

test("Aladdin real-pilot activation remains blocked until operator confirmation is implemented",()=>{
  const gate=getAladdinActivationGate();
  assert.deepEqual(gate,{allowed:false,reason:"operator_confirmation_required"});
});
