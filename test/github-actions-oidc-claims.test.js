import test from "node:test";
import assert from "node:assert/strict";
import { validateGithubRepairClaims } from "../src/middleware/githubActionsOidc.js";

const base={
  repository:"mohammadalnablsi701-del/-aqaba-seago",
  repository_id:"1395882599",
  repository_owner_id:"291489706",
  actor_id:"291489706",
  ref:"refs/heads/repair/pilot-data-stage2-run",
  event_name:"push",
  workflow_ref:"mohammadalnablsi701-del/-aqaba-seago/.github/workflows/pilot-data-stage2a.yml@refs/heads/repair/pilot-data-stage2-run"
};
const legacy={...base,sub:"repo:mohammadalnablsi701-del/-aqaba-seago:ref:refs/heads/repair/pilot-data-stage2-run"};
const immutable={...base,sub:"repo:mohammadalnablsi701-del@291489706/-aqaba-seago@1395882599:ref:refs/heads/repair/pilot-data-stage2-run"};

test("repair OIDC claims accept only the project owner, repository ids, branch and workflow",()=>{
  assert.equal(validateGithubRepairClaims(legacy),true);
  assert.equal(validateGithubRepairClaims(immutable),true);
  for(const mutation of [
    {repository:"attacker/repo"},
    {repository_id:"1"},
    {repository_owner_id:"1"},
    {actor_id:"1"},
    {ref:"refs/heads/main"},
    {event_name:"pull_request"},
    {sub:"repo:mohammadalnablsi701-del@291489706/-aqaba-seago@1395882599:ref:refs/heads/main"},
    {workflow_ref:"mohammadalnablsi701-del/-aqaba-seago/.github/workflows/ci.yml@refs/heads/repair/pilot-data-stage2-run"}
  ]){
    assert.throws(()=>validateGithubRepairClaims({...immutable,...mutation}));
  }
});
