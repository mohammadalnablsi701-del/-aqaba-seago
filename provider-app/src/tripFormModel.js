export function buildTripFormState({trip=null,duplicateFrom=null,defaults={}}={}){
  const source=trip||duplicateFrom;
  return{
    titleEn:trip?.titleEn||(duplicateFrom?(String(duplicateFrom.titleEn||"")+" Copy"):""),
    titleAr:trip?.titleAr||(duplicateFrom?String(duplicateFrom.titleAr||duplicateFrom.titleEn||""):""),
    vesselName:String(source?.vesselName||""),
    category:source?.category||defaults.category||"group_boat",
    durationMinutes:source?.durationMinutes||defaults.durationMinutes||90,
    adultPrice:source?.pricing?.adultPrice??source?.pricing?.pricePerPerson??defaults.adultPrice??15,
    childPrice:source?.pricing?.childPrice??source?.pricing?.pricePerPerson??defaults.childPrice??10,
    buffetEnabled:source?Boolean(source?.pricing?.buffetEnabled):Boolean(defaults.buffetEnabled),
    buffetAdultPrice:source?.pricing?.buffetAdultPrice??source?.pricing?.adultPrice??source?.pricing?.pricePerPerson??defaults.buffetAdultPrice??20,
    buffetChildPrice:source?.pricing?.buffetChildPrice??source?.pricing?.childPrice??defaults.buffetChildPrice??12,
    buffetDescription:source?.pricing?.buffetDescription||defaults.buffetDescription||"",
    images:Array.isArray(source?.images)?source.images:[],
    imageUrl:"",
    locationName:source?.departureLocation?.name||defaults.locationName||"",
    address:source?.departureLocation?.address||defaults.address||"",
    googleMapsUrl:source?.departureLocation?.googleMapsUrl||defaults.googleMapsUrl||"",
    active:trip?trip.active!==false:true
  };
}

export function serializeTripForm(form){
  return{
    titleEn:form.titleEn,
    titleAr:form.titleAr||form.titleEn,
    vesselName:String(form.vesselName||"").trim(),
    category:form.category,
    durationMinutes:Number(form.durationMinutes),
    pricing:{
      currency:"JOD",
      pricePerPerson:Number(form.adultPrice),
      adultPrice:Number(form.adultPrice),
      childPrice:Number(form.childPrice),
      buffetEnabled:Boolean(form.buffetEnabled),
      buffetAdultPrice:Number(form.buffetAdultPrice),
      buffetChildPrice:Number(form.buffetChildPrice),
      buffetDescription:form.buffetDescription
    },
    images:form.images,
    departureLocation:{name:form.locationName,address:form.address,googleMapsUrl:form.googleMapsUrl},
    active:form.active
  };
}
