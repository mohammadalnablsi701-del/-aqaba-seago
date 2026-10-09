import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const ISSUER="https://token.actions.githubusercontent.com";
const JWKS_URL="https://token.actions.githubusercontent.com/.well-known/jwks";
const AUDIENCE="aqaba-seago-pilot-repair";
const REPOSITORY="mohammadalnablsi701-del/-aqaba-seago";
const REPOSITORY_ID="1395882599";
const OWNER_ID="291489706";
const RUN_REF="refs/heads/repair/pilot-data-stage2-run";
const WORKFLOW_REF=`${REPOSITORY}/.github/workflows/pilot-data-stage2a.yml@${RUN_REF}`;
const LEGACY_SUB=`repo:${REPOSITORY}:ref:${RUN_REF}`;
const IMMUTABLE_SUB=`repo:mohammadalnablsi701-del@${OWNER_ID}/-aqaba-seago@${REPOSITORY_ID}:ref:${RUN_REF}`;
let cachedJwks={expiresAt:0,keys:[]};

export function validateGithubRepairClaims(payload={}){
  if(payload.repository!==REPOSITORY)throw new Error("Invalid repository claim");
  if(String(payload.repository_id||"")!==REPOSITORY_ID)throw new Error("Invalid repository id claim");
  if(String(payload.repository_owner_id||"")!==OWNER_ID)throw new Error("Invalid repository owner id claim");
  if(payload.ref!==RUN_REF)throw new Error("Invalid ref claim");
  if(payload.event_name!=="push")throw new Error("Invalid event claim");
  if(![LEGACY_SUB,IMMUTABLE_SUB].includes(String(payload.sub||"")))throw new Error("Invalid subject claim");
  if(payload.workflow_ref!==WORKFLOW_REF)throw new Error("Invalid workflow claim");
  return true;
}

async function getJwk(kid){
  if(Date.now()>=cachedJwks.expiresAt||!cachedJwks.keys.some(k=>k.kid===kid)){
    const response=await fetch(JWKS_URL,{headers:{accept:"application/json"}});
    if(!response.ok)throw new Error("OIDC key fetch failed");
    const data=await response.json();
    cachedJwks={expiresAt:Date.now()+10*60*1000,keys:Array.isArray(data.keys)?data.keys:[]};
  }
  const jwk=cachedJwks.keys.find(k=>k.kid===kid);
  if(!jwk)throw new Error("OIDC signing key not found");
  return jwk;
}

export async function requireGithubActionsRepairOidc(req,res,next){
  try{
    const header=String(req.headers.authorization||"");
    if(!header.startsWith("Bearer "))return res.status(401).json({error:"Authentication required"});
    const token=header.slice(7).trim();
    const decoded=jwt.decode(token,{complete:true});
    if(!decoded?.header?.kid||decoded.header.alg!=="RS256")return res.status(401).json({error:"Invalid authentication"});
    const jwk=await getJwk(decoded.header.kid);
    const publicKey=crypto.createPublicKey({key:jwk,format:"jwk"});
    const payload=jwt.verify(token,publicKey,{algorithms:["RS256"],issuer:ISSUER,audience:AUDIENCE});
    validateGithubRepairClaims(payload);
    req.githubOidc=payload;
    next();
  }catch{
    return res.status(401).json({error:"Invalid authentication"});
  }
}
