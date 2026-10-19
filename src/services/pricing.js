import { fixedPerPersonRates, validateCommissionConfig } from "./commission.js";

export function calculatePricing({pricePerPerson,seats,commissionType,commissionValue}) {
  if(!Number.isFinite(pricePerPerson)||pricePerPerson<0) throw new Error("Invalid pricePerPerson");
  if(!Number.isInteger(seats)||seats<1) throw new Error("Invalid seats");
  const commission=validateCommissionConfig({commissionType,commissionValue});
  const grossAmount=roundMoney(pricePerPerson*seats);
  const commissionAmount=calcCommission(grossAmount,seats,commission);
  return financialResult({
    currency:"JOD",
    unitPrice:roundMoney(pricePerPerson),
    grossAmount,
    commissionAmount
  });
}

export function calculateTieredPricing({pricing,adults,children,mealPlan="without_buffet"}) {
  if(!pricing||typeof pricing!=="object"||Array.isArray(pricing)) throw new Error("Invalid pricing configuration");
  if(!["without_buffet","with_buffet"].includes(mealPlan)) throw new Error("Invalid mealPlan");
  if(!Number.isInteger(adults)||adults<0) throw new Error("Invalid adults");
  if(!Number.isInteger(children)||children<0) throw new Error("Invalid children");
  const seats=adults+children;
  if(seats<1) throw new Error("At least one guest is required");

  const commission=validateCommissionConfig(pricing);
  const buffet=mealPlan==="with_buffet";
  if(buffet && !pricing.buffetEnabled) throw new Error("Buffet package is not available for this trip");
  if(buffet && (pricing.buffetAdultPrice==null||pricing.buffetChildPrice==null)) {
    throw new Error("Buffet prices are required for this trip");
  }

  const legacy=Number(pricing.pricePerPerson||0);
  const adultUnitPrice=Number(
    buffet ? (pricing.buffetAdultPrice ?? pricing.adultPrice ?? legacy)
           : (pricing.adultPrice ?? legacy)
  );
  const childUnitPrice=Number(
    buffet ? (pricing.buffetChildPrice ?? pricing.childPrice ?? adultUnitPrice)
           : (pricing.childPrice ?? adultUnitPrice)
  );

  if(!Number.isFinite(adultUnitPrice)||adultUnitPrice<0) throw new Error("Invalid adult price");
  if(!Number.isFinite(childUnitPrice)||childUnitPrice<0) throw new Error("Invalid child price");

  const adultSubtotal=roundMoney(adultUnitPrice*adults);
  const childSubtotal=roundMoney(childUnitPrice*children);
  const grossAmount=roundMoney(adultSubtotal+childSubtotal);
  let commissionAmount;
  if(commission.commissionType==="fixed_per_person"){
    const rates=fixedPerPersonRates(commission,{buffet});
    commissionAmount=roundMoney(Math.min(
      grossAmount,
      rates.adultCommission*adults+rates.childCommission*children
    ));
  }else{
    commissionAmount=calcCommission(grossAmount,seats,commission);
  }

  return financialResult({
    currency:pricing.currency||"JOD",
    unitPrice:adultUnitPrice,
    adultUnitPrice:roundMoney(adultUnitPrice),
    childUnitPrice:roundMoney(childUnitPrice),
    adultSubtotal,
    childSubtotal,
    grossAmount,
    commissionAmount
  });
}

function calcCommission(grossAmount,seats,{commissionType,commissionValue}) {
  let commissionAmount;
  if(commissionType==="percentage") commissionAmount=grossAmount*(commissionValue/100);
  else if(commissionType==="fixed_per_person") commissionAmount=commissionValue*seats;
  else if(commissionType==="fixed_per_booking") commissionAmount=commissionValue;
  else throw new Error("Unsupported commission type");
  return roundMoney(Math.min(commissionAmount,grossAmount));
}

function financialResult(result){
  const providerNetAmount=roundMoney(result.grossAmount-result.commissionAmount);
  if(!Number.isFinite(result.grossAmount)||result.grossAmount<0||
     !Number.isFinite(result.commissionAmount)||result.commissionAmount<0||
     !Number.isFinite(providerNetAmount)||providerNetAmount<0||
     result.commissionAmount>result.grossAmount){
    throw new Error("Invalid financial pricing result");
  }
  return {...result,providerNetAmount};
}

function roundMoney(v){return Math.round((v+Number.EPSILON)*100)/100;}
