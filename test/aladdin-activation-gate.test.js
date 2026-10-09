import test from "node:test";
import assert from "node:assert/strict";
import { getAladdinActivationGate } from "../src/services/realPilotData.js";

test("Aladdin real-pilot activation stays blocked until operator confirmation is implemented",()=>{
  assert.deepEqual(getAladdinActivationGate(),{
    allowed:false,
    reason:"operator_confirmation_required"
  });
});
