import{commissionDisplay}from"./commissionDisplay.js";

export const COMMISSION_TYPE_OPTIONS=[
  {value:"percentage",label:"Percentage"},
  {value:"fixed_per_person",label:"Fixed per guest"},
  {value:"fixed_per_booking",label:"Fixed per booking"}
];

const TIER_KEYS=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];
const CLEARED_TIERS={adultCommission:null,childCommission:null,buffetAdultCommission:null,buffetChildCommission:null};

function has(value){return value!==undefined&&value!==null&&String(value).trim()!=="";}
function text(value){return has(value)?String(value):"";}
function decimal(value,{max=Number.MAX_SAFE_INTEGER}={}){
  if(!has(value))return null;
  const raw=String(value).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
  const number=Number(raw);
  return Number.isFinite(number)&&number>=0&&number<=max?number:null;
}

export function commissionDraftFromPricing(pricing={}){
  const type=COMMISSION_TYPE_OPTIONS.some(x=>x.value===pricing?.commissionType)?pricing.commissionType:"";
  const anyTier=TIER_KEYS.some(key=>has(pricing?.[key]));
  const buffetTiers=has(pricing?.buffetAdultCommission)||has(pricing?.buffetChildCommission);
  return{
    commissionType:type,
    commissionValue:text(pricing?.commissionValue),
    guestStructure:anyTier?"tiered":"basic",
    buffetTiers,
    adultCommission:text(pricing?.adultCommission),
    childCommission:text(pricing?.childCommission),
    buffetAdultCommission:text(pricing?.buffetAdultCommission),
    buffetChildCommission:text(pricing?.buffetChildCommission)
  };
}

export function changeCommissionType(draft,type){
  if(!COMMISSION_TYPE_OPTIONS.some(x=>x.value===type))return draft;
  return{
    ...draft,
    commissionType:type,
    ...(type!=="fixed_per_person"?{guestStructure:"basic",buffetTiers:false}:{}),
    ...(type!==draft.commissionType?{
      commissionValue:"",adultCommission:"",childCommission:"",buffetAdultCommission:"",buffetChildCommission:"",
      ...(type==="fixed_per_person"?{guestStructure:"basic",buffetTiers:false}:{})
    }:{})
  };
}

export function changeGuestStructure(draft,structure){
  if(structure==="basic")return{...draft,guestStructure:"basic",buffetTiers:false,adultCommission:"",childCommission:"",buffetAdultCommission:"",buffetChildCommission:""};
  if(structure==="tiered")return{
    ...draft,guestStructure:"tiered",
    adultCommission:draft.adultCommission||draft.commissionValue,
    childCommission:draft.childCommission||draft.commissionValue
  };
  return draft;
}

export function setAdultCommission(draft,value){
  return{...draft,adultCommission:value,commissionValue:value};
}

export function validateCommissionDraft(draft){
  const type=draft?.commissionType;
  if(!COMMISSION_TYPE_OPTIONS.some(x=>x.value===type))return{ok:false,error:"Select a supported commission type."};
  if(type==="percentage"){
    const value=decimal(draft.commissionValue,{max:100});
    if(value===null)return{ok:false,error:"Enter a percentage from 0 to 100 with up to 2 decimal places."};
    return{ok:true,payload:{commissionType:type,commissionValue:value}};
  }
  if(type==="fixed_per_booking"){
    const value=decimal(draft.commissionValue);
    if(value===null)return{ok:false,error:"Enter a non-negative booking commission with up to 2 decimal places."};
    return{ok:true,payload:{commissionType:type,commissionValue:value}};
  }
  if(draft.guestStructure!=="tiered"){
    const value=decimal(draft.commissionValue);
    if(value===null)return{ok:false,error:"Enter a non-negative commission per guest with up to 2 decimal places."};
    return{ok:true,payload:{commissionType:type,commissionValue:value,...CLEARED_TIERS}};
  }
  const adult=decimal(draft.adultCommission),child=decimal(draft.childCommission);
  if(adult===null||child===null)return{ok:false,error:"Adult and child commissions are required for tiered fixed per guest."};
  const fallback=decimal(draft.commissionValue);
  if(fallback===null)return{ok:false,error:"Tiered commission fallback is invalid."};
  const payload={commissionType:type,commissionValue:fallback,adultCommission:adult,childCommission:child,buffetAdultCommission:null,buffetChildCommission:null};
  if(draft.buffetTiers){
    const buffetAdult=decimal(draft.buffetAdultCommission),buffetChild=decimal(draft.buffetChildCommission);
    if(buffetAdult===null||buffetChild===null)return{ok:false,error:"Both buffet commission tiers are required when buffet tiers are enabled."};
    payload.buffetAdultCommission=buffetAdult;payload.buffetChildCommission=buffetChild;
  }
  return{ok:true,payload};
}

export function commissionConfirmationText(pricing={}){
  const view=commissionDisplay(pricing);
  if(view.status!=="configured")return view.summary;
  if(view.type!=="fixed_per_person"||!view.lines.length)return view.summary;
  return view.lines.map(line=>`${line.value} per ${line.label.toLowerCase()}`).join(" / ");
}

export function commissionPayloadPreview(currentPricing={},payload={}){
  return commissionConfirmationText({currency:currentPricing?.currency||"JOD",...payload});
}
