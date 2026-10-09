import test from "node:test";
import assert from "node:assert/strict";
import { expectedCommissionForBooking, classifyBookingSnapshot } from "../src/services/pilotFinancialStage2b.js";
import { validateGithubStage2bClaims } from "../src/middleware/githubActionsStage2bOidc.js";

const repository="mohammadalnablsi701-del/-aqaba-seago";
const ref="refs/heads/repair/pilot-financial-stage2b-run";
const workflowRef=`${repository}/.github/workflows/pilot-financial-stage2b.yml@${ref}`;

function validClaims(){
  return {
    repository,
    repository_id:"1395882599",
    repository_owner_id:"291489706",
    actor_id:"291489706",
    ref,
    event_name:"push",
    sub:`repo:mohammadalnablsi701-del@291489706/-aqaba-seago@1395882599:ref:${ref}`,
    workflow_ref:workflowRef
  };
}

test("Stage 2B approved commission is exactly 5 JOD per seat",()=>{
  assert.equal(expectedCommissionForBooking({seats:2,grossAmount:50}),10);
  assert.equal(expectedCommissionForBooking({seats:4,grossAmount:87}),20);
  assert.equal(expectedCommissionForBooking({seats:6,grossAmount:137}),30);
});

test("Stage 2B snapshot classifier accepts only exact before or after states",()=>{
  assert.equal(classifyBookingSnapshot({seats:2,grossAmount:50,commissionAmount:0,providerNetAmount:50}),"before");
  assert.equal(classifyBookingSnapshot({seats:2,grossAmount:50,commissionAmount:10,providerNetAmount:40}),"after");
  assert.equal(classifyBookingSnapshot({seats:2,grossAmount:50,commissionAmount:5,providerNetAmount:45}),"conflict");
});

test("Stage 2B OIDC claims are pinned to the immutable repair workflow",()=>{
  assert.equal(validateGithubStage2bClaims(validClaims()),true);
  assert.throws(()=>validateGithubStage2bClaims({...validClaims(),ref:"refs/heads/main"}));
  assert.throws(()=>validateGithubStage2bClaims({...validClaims(),actor_id:"1"}));
  assert.throws(()=>validateGithubStage2bClaims({...validClaims(),workflow_ref:`${repository}/.github/workflows/ci.yml@${ref}`}));
});
