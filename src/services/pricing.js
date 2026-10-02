export function calculatePricing({pricePerPerson,seats,commissionType,commissionValue}) {
  if(!Number.isFinite(pricePerPerson)||pricePerPerson<0) throw new Error("Invalid pricePerPerson");
  if(!Number.isInteger(seats)||seats<1) throw new Error("Invalid seats");
  if(!Number.isFinite(commissionValue)||commissionValue<0) throw new Error("Invalid commissionValue");
  const grossAmount=roundMoney(pricePerPerson*seats);
  const commissionAmount=calcCommission(grossAmount,seats,commissionType,commissionValue);
  return {
    currency:"JOD",
    unitPrice:roundMoney(pricePerPerson),
    grossAmount,
    commissionAmount,
    providerNetAmount:roundMoney(grossAmount-commissionAmount)
  };
}

export function calculateTieredPricing({pricing,adults,children,mealPlan="without_buffet"}) {
  if(!Number.isInteger(adults)||adults<0) throw new Error("Invalid adults");
  if(!Number.isInteger(children)||children<0) throw new Error("Invalid children");
  const seats=adults+children;
  if(seats<1) throw new Error("At least one guest is required");

  const buffet=mealPlan==="with_buffet";
  if(buffet && !pricing.buffetEnabled) throw new Error("Buffet package is not available for this trip");

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
  const commissionAmount=calcCommission(
    grossAmount,seats,pricing.commissionType,Number(pricing.commissionValue||0)
  );

  return {
    currency:pricing.currency||"JOD",
    unitPrice:adultUnitPrice,
    adultUnitPrice:roundMoney(adultUnitPrice),
    childUnitPrice:roundMoney(childUnitPrice),
    adultSubtotal,
    childSubtotal,
    grossAmount,
    commissionAmount,
    providerNetAmount:roundMoney(grossAmount-commissionAmount)
  };
}

function calcCommission(grossAmount,seats,commissionType,commissionValue) {
  if(!Number.isFinite(commissionValue)||commissionValue<0) throw new Error("Invalid commissionValue");
  let commissionAmount;
  if(commissionType==="percentage") commissionAmount=grossAmount*(commissionValue/100);
  else if(commissionType==="fixed_per_person") commissionAmount=commissionValue*seats;
  else if(commissionType==="fixed_per_booking") commissionAmount=commissionValue;
  else throw new Error("Unsupported commission type");
  return roundMoney(Math.min(commissionAmount,grossAmount));
}

function roundMoney(v){return Math.round((v+Number.EPSILON)*100)/100;}
