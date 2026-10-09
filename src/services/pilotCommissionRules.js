const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;
const TIER_KEYS=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];

export const FUN_N_SUN_COMMISSION_PLAN=Object.freeze({
  "White Prince Swimming Cruise":Object.freeze({
    commissionType:"fixed_per_person",
    commissionValue:3,
    adultCommission:3,
    childCommission:2,
    buffetAdultCommission:5,
    buffetChildCommission:3
  }),
  "White Prince Evening Cruise":Object.freeze({
    commissionType:"fixed_per_person",
    commissionValue:5
  }),
  "Coral Whisper + White Prince Experience":Object.freeze({
    commissionType:"fixed_per_person",
    commissionValue:5
  })
});

function comparable(value){return value===undefined||value===null?null:Number(value);}

export function isFunNSunProviderName(value){
  return FUN_N_SUN_PROVIDER_RE.test(String(value||""));
}

export function resolveFunNSunCommissionPlan(titleEn){
  return FUN_N_SUN_COMMISSION_PLAN[String(titleEn||"").trim()]||null;
}

export function commissionMatchesApprovedPlan(update={},plan={}){
  if(update.commissionType!==plan.commissionType)return false;
  if(Number(update.commissionValue)!==Number(plan.commissionValue))return false;
  return TIER_KEYS.every(key=>comparable(update[key])===comparable(plan[key]));
}
