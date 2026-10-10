export const OPERATION_TIME_ZONE="Asia/Amman";

export function operationalToday(now=new Date()){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:OPERATION_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=type=>parts.find(item=>item.type===type)?.value||"";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftOperationalDate(value,days){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||""));
  if(!match)return operationalToday();
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
  date.setUTCDate(date.getUTCDate()+Number(days||0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
}

export function salesReasonLabel(reason){
  return ({
    open:"Sales Open",
    departure_cancelled:"Departure cancelled",
    departure_completed:"Departure completed",
    provider_blocked:"Provider blocked",
    provider_paused:"Provider paused",
    platform_paused:"Platform paused",
    departure_closed:"Closed by provider",
    departure_started:"Departure started",
    no_seats:"No seats"
  })[reason]||"Sales Closed";
}

export function filterAndSortDepartures(items,{providerId="",status="",sales="",search="",attentionOnly=false}={}){
  const term=String(search||"").trim().toLowerCase();
  return [...(Array.isArray(items)?items:[])].filter(item=>{
    if(providerId&&String(item.providerId)!==String(providerId))return false;
    if(status&&item.status!==status)return false;
    if(sales==="open"&&!item.salesOpen)return false;
    if(sales==="closed"&&item.salesOpen)return false;
    if(attentionOnly&&!(item.attentionReasons||[]).length)return false;
    if(term){
      const haystack=[item.providerName,item.tripTitle,item.vesselName].filter(Boolean).join(" ").toLowerCase();
      if(!haystack.includes(term))return false;
    }
    return true;
  }).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt)||String(a.providerName||"").localeCompare(String(b.providerName||""),"en")||String(a.tripTitle||"").localeCompare(String(b.tripTitle||""),"en")||String(a.departureId||"").localeCompare(String(b.departureId||"")));
}
