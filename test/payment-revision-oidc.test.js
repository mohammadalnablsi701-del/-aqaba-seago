import test from "node:test";
import assert from "node:assert/strict";
import { validateGithubPaymentRevisionClaims } from "../src/middleware/githubActionsPaymentRevisionOidc.js";

const valid={
  repository:"mohammadalnablsi701-del/-aqaba-seago",
  repository_id:"1395882599",
  repository_owner_id:"291489706",
  actor_id:"291489706",
  ref:"refs/heads/repair/pilot-payment-revision-restore-run",
  event_name:"push",
  sub:"repo:mohammadalnablsi701-del@291489706/-aqaba-seago@1395882599:ref:refs/heads/repair/pilot-payment-revision-restore-run",
  workflow_ref:"mohammadalnablsi701-del/-aqaba-seago/.github/workflows/pilot-payment-revision-restore.yml@refs/heads/repair/pilot-payment-revision-restore-run"
};

test("Payment revision OIDC accepts only the exact repair workflow identity",()=>{
  assert.equal(validateGithubPaymentRevisionClaims(valid),true);
  for(const [key,value] of [
    ["repository","other/repo"],
    ["repository_id","1"],
    ["repository_owner_id","1"],
    ["actor_id","1"],
    ["ref","refs/heads/main"],
    ["event_name","workflow_dispatch"],
    ["sub","repo:mohammadalnablsi701-del/-aqaba-seago:ref:refs/heads/main"],
    ["workflow_ref","mohammadalnablsi701-del/-aqaba-seago/.github/workflows/ci.yml@refs/heads/repair/pilot-payment-revision-restore-run"]
  ]){
    assert.throws(()=>validateGithubPaymentRevisionClaims({...valid,[key]:value}));
  }
});
