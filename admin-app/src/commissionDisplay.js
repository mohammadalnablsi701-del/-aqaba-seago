const SUPPORTED_TYPES=new Set(["percentage","fixed_per_person","fixed_per_booking"]);
const TIER_KEYS=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];

function hasValue(value){return value!==undefined&&value!==null&&String(value).trim()!=="";}
function nonNegativeNumber(value){
  if(!hasValue(value))return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?number:null;
}
function percentageNumber(value){
  const number=nonNegativeNumber(value);
  return number!==null&&number<=100?number:null;
}
function money(value,currency){return `${value.toFixed(2)} ${currency}`;}
function percentage(value){return `${Number(value.toFixed(2))}%`;}
function notConfigured(type=null){return{status:"not_configured",type,title:"Commission",summary:"Commission not configured",lines:[],value:null};}

export function parseCommissionPercentageInput(value){return percentageNumber(value);}

export function commissionDisplay(pricing={}){
  const type=typeof pricing?.commissionType==="string"?pricing.commissionType.trim():"";
  const currency=typeof pricing?.currency==="string"&&pricing.currency.trim()?pricing.currency.trim():"JOD";

  if(!type)return notConfigured();
  if(!SUPPORTED_TYPES.has(type))return{status:"unsupported",type,title:"Commission",summary:"Unsupported commission type",lines:[],value:null};

  if(type==="percentage"){
    const value=percentageNumber(pricing.commissionValue);
    if(value===null)return notConfigured(type);
    return{status:"configured",type,title:"Percentage",summary:`${percentage(value)} of total booking`,lines:[],value};
  }

  if(type==="fixed_per_booking"){
    const value=nonNegativeNumber(pricing.commissionValue);
    if(value===null)return notConfigured(type);
    return{status:"configured",type,title:"Fixed per booking",summary:`${money(value,currency)} per booking`,lines:[],value};
  }

  const value=nonNegativeNumber(pricing.commissionValue);
  if(value===null)return notConfigured(type);

  const present=Object.fromEntries(TIER_KEYS.map(key=>[key,hasValue(pricing[key])]));
  const anyTier=TIER_KEYS.some(key=>present[key]);
  if(!anyTier){
    return{status:"configured",type,title:"Fixed per guest",summary:`${money(value,currency)} per guest`,lines:[],value};
  }

  const adultPair=present.adultCommission&&present.childCommission;
  const buffetPair=present.buffetAdultCommission&&present.buffetChildCommission;
  if(present.adultCommission!==present.childCommission||present.buffetAdultCommission!==present.buffetChildCommission||(!adultPair&&buffetPair))return notConfigured(type);

  const adult=adultPair?nonNegativeNumber(pricing.adultCommission):null;
  const child=adultPair?nonNegativeNumber(pricing.childCommission):null;
  const buffetAdult=buffetPair?nonNegativeNumber(pricing.buffetAdultCommission):null;
  const buffetChild=buffetPair?nonNegativeNumber(pricing.buffetChildCommission):null;
  if((adultPair&&(adult===null||child===null))||(buffetPair&&(buffetAdult===null||buffetChild===null)))return notConfigured(type);

  const lines=[];
  if(adultPair){
    lines.push({label:"Adult",value:money(adult,currency)});
    lines.push({label:"Child",value:money(child,currency)});
  }
  if(buffetPair){
    lines.push({label:"Adult + buffet",value:money(buffetAdult,currency)});
    lines.push({label:"Child + buffet",value:money(buffetChild,currency)});
  }
  return{status:"configured",type,title:"Fixed per guest",summary:"Fixed per guest",lines,value};
}
