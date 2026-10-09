import test from "node:test";
import assert from "node:assert/strict";
import { validateGithubRepairClaims } from "../src/middleware/githubActionsOidc.js";

const valid={
  repository:"mohammadalnablsi701-del/-aqaba-seago",
  ref:"refs/heads/repair/pilot-data-stage2-run",
  event_name:"push",
  sub:"repo:mohammadalnablsi701-del/-aqaba-seago:ref:refs/heads/repair/pilot-data-stage2-run",
  workflow_ref:"mohammadalnablsi701-del/-aqaba-seago/.github/workflows/pilot-data-stage2a.yml@refs/heads/repair/pilot-data-stage2-run"
};

test("repair OIDC claims accept only the dedicated repository branch and workflow",()=>{
  assert.equal(validateGithubRepairClaims(valid),true);
  for(const mutation of [
    {repository:"attacker/repo"},
    {ref:"refs/heads/main"},
    {event_name:"pull_request"},
    {sub:"repo:mohammadalnablsi701-del/-aqaba-seago:ref:refs/heads/main"},
    {workflow_ref:"mohammadalnablsi701-del/-aqaba-seago/.github/workflows/ci.yml@refs/heads/repair/pilot-data-stage2-run"}
  ]){
    assert.throws(()=>validateGithubRepairClaims({...valid,...mutation}));
  }
});
