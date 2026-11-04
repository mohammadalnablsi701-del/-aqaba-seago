import { aqabaDateKey, availableDepartures } from "./departureSelection.js";

const MAX_INPUT = 500;

export const ASSISTANT_STARTERS = Object.freeze([
  "Find a sunset cruise",
  "Trips for 2 people",
  "Boat trips under 30 JOD",
  "Where is my QR ticket?",
  "Cancellation policy"
]);

export function parseAssistantRequest(raw, now = new Date()) {
  const message = String(raw || "").trim().slice(0, MAX_INPUT);
  const lower = message.toLowerCase();
  const family = lower.match(/\b(?:family|group|party)\s+of\s+(\d{1,2})\b/);
  const people = lower.match(/\b(\d{1,2})\s*(?:people|persons|guests|travellers|travelers|travel tickets)\b/);
  const adultCount = lower.match(/\b(\d{1,2})\s*adults?\b/);
  const childCount = lower.match(/\b(\d{1,2})\s*(?:children|kids|child)\b/);
  const hasGroupDetails = Boolean(adultCount || childCount);
  const adults = adultCount ? Number(adultCount[1]) : (hasGroupDetails ? 0 : Number(people?.[1] || family?.[1] || 1));
  const children = childCount ? Number(childCount[1]) : 0;
  const guests = Math.min(20, Math.max(1, adults + children));
  const underSix = children>0 && /\b(?:under|below|younger than)\s*(?:6|six)\b/.test(lower);
  const unsupportedGroup = (hasGroupDetails && (!adultCount || adults < 1 || adults + children > 20)) || underSix;
  const money = lower.match(/\b(?:under|below|less than|up to|max(?:imum)?|budget(?: of)?|within)\s*(?:jod|jd|\$)?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:jod|jd)?\b/)
    || lower.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*(?:jod|jd)\b/);
  const maxBudget = money ? Number(money[1]) : null;
  const manual = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  let date = null;
  if (manual) {
    const candidate = `${manual[1]}-${manual[2]}-${manual[3]}`;
    const parsed = new Date(candidate+"T12:00:00Z");
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === candidate) date = candidate;
  } else if (/\btomorrow\b/.test(lower)) {
    date = aqabaDateKey(new Date(now.getTime() + 86400000));
  } else if (/\btoday\b/.test(lower)) {
    date = aqabaDateKey(now);
  }
  let kind = "discover";
  if (/\b(hello|hi|hey|good morning|good evening)\b/.test(lower) && lower.length < 36 && !/\b(cruise|boat|yacht|sunset|trip|snorkel|diving|tickets)\b/.test(lower)) kind = "greeting";
  if (/\b(refund|cancel|cancellation|money back)\b/.test(lower)) kind = "cancellation";
  else if (/\b(ticket|qr code|qr ticket|check.?in|my booking|booking status)\b/.test(lower)) kind = "tickets";
  else if (/\b(support|contact|staff|human|agent|help desk)\b/.test(lower)) kind = "support";
  else if (/\b(what is included|what's included|includes|inclusions|buffet|meal)\b/.test(lower)) kind = "details";
  else if (/\b(where|departure point|meeting point|marina|location|map|address)\b/.test(lower)) kind = "departure";
  const categories = [
    { label: "sunset", test: /\b(sunset|evening)\b/ },
    { label: "snorkeling", test: /\b(snorkel|coral|reef)\b/ },
    { label: "diving", test: /\b(diving|dive|scuba)\b/ },
    { label: "yacht", test: /\b(yacht|cruise)\b/ },
    { label: "glass", test: /\b(glass.?bottom|semi.?submarine|underwater)\b/ },
    { label: "boat", test: /\b(boat|fishing)\b/ }
  ].filter(x=>x.test.test(lower)).map(x=>x.label);
  const unsupportedDate = !date && /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|next week|this week|next month|tonight)\b/.test(lower);
  return { message, kind, guests, adults, children, unsupportedGroup, maxBudget, date, invalidDate: Boolean(manual && !date), unsupportedDate, categories };
}

function tripText(trip) {
  return [trip.title,trip.category,trip.description,trip.experienceLabel,trip.vesselName]
    .map(x=>String(x||"").toLowerCase()).join(" ");
}
function matchesCategories(trip, categories) {
  if(!categories.length) return true;
  const text=tripText(trip);
  return categories.every(label=> {
    if(label==="sunset") return /sunset|evening/.test(text);
    if(label==="snorkeling") return /snorkel|coral|reef/.test(text);
    if(label==="diving") return /diving|scuba/.test(text);
    if(label==="yacht") return /yacht|cruise/.test(text);
    if(label==="glass") return /glass|semi.?submarine|underwater/.test(text);
    return /boat|fishing|yacht|cruise/.test(text);
  });
}
function priceEstimate(trip, { adults, children }) {
  const adult = Number(trip.price);
  if(!Number.isFinite(adult) || adult<=0) return null;
  if(children>0) {
    const child=Number(trip.childPrice);
    if(trip.childPrice===null || trip.childPrice===undefined || !Number.isFinite(child) || child<0) return null;
    return adult*adults + child*children;
  }
  return adult*adults;
}

function reply(text, cards=[], action=null) { return {text,cards,action}; }

/**
 * All availability and ticket data come from the SeaGo API, never the user's
 * free-text claims or an AI model. No booking/payment mutations are performed.
 */
export async function answerSeaGoQuestion(raw, trips, { listDepartures, now = new Date(), hasLiveApi = true } = {}) {
  const q=parseAssistantRequest(raw,now);
  if(!q.message) return reply("Tell me what kind of Red Sea experience you're looking for.");
  if(q.invalidDate) return reply("That date does not appear valid. Please use YYYY-MM-DD so I can check the correct departure.");
  if(q.unsupportedDate) return reply("Please share your preferred departure date in YYYY-MM-DD format. I won't assume which weekday or weekend you meant.");
  if(q.unsupportedGroup) return reply("Please confirm the number of adults and children aged 6–12. Children under 6 and groups over 20 need confirmation from the operator before pricing.",[],{type:"support",label:"Contact Support"});
  if(q.kind==="greeting") return reply("Welcome aboard! Tell me what type of trip you prefer, your budget, or how many people are going.");
  if(q.kind==="tickets") return reply(
    "Your confirmed QR ticket appears in My Tickets after successful payment. For privacy, open your tickets while signed in to check your own booking. I can't access private bookings from this chat.",
    [],{type:"tickets",label:"Open My Tickets"}
  );
  if(q.kind==="cancellation") return reply(
    "Refund eligibility depends on the booking's actual departure time, status and cancellation policy. I can't approve a refund or cancel a booking here. Open Help & Support for your booking's official options.",
    [],{type:"support",label:"Contact Support"}
  );
  if(q.kind==="support") return reply("I can guide you to the official SeaGo support form. Sign in to link your request to a booking.",[],{type:"support",label:"Open Support"});
  if(q.kind==="departure" && !q.categories.length) return reply(
    "The departure point is set by the tour operator and may vary by trip. Open a trip or its confirmed ticket for the actual location and map link.",
    [],{type:"trips",label:"Explore Trips"}
  );
  if(!hasLiveApi) return reply("I'm showing a preview without live trip data. I can't verify current prices, seats or departures until SeaGo's live trip service is connected.",[],{type:"trips",label:"Explore Preview"});
  if(!Array.isArray(trips)) return reply("Trip information is unavailable right now. Please try again or contact support.",[],{type:"support",label:"Contact Support"});
  const valid=trips.filter(t=>t?.apiId && t?.source==="api");
  if(!valid.length) return reply("I couldn't load verified SeaGo trips right now. I won't suggest dates or prices until our operators' data is available.",[],{type:"support",label:"Contact Support"});

  if(q.kind==="details") {
    const matches=valid.filter(t=>matchesCategories(t,q.categories));
    const withMeals=matches.filter(t=>t.buffetEnabled);
    if(/buffet|meal/.test(q.message.toLowerCase())) {
      const cards=withMeals.slice(0,3).map(t=>({tripId:String(t.id),title:t.title,price:Number(t.price),category:t.category,availability:"View options"}));
      return withMeals.length
        ? reply("These operator-listed experiences offer a buffet option. Open the trip to check its actual menu information and the live price for your group; inclusions can differ by operator.",cards)
        : reply("I can't confirm a buffet option from the currently published trip records. Please check the trip details or ask SeaGo support.",[],{type:"trips",label:"Explore Trips"});
    }
    return reply("Every operator sets what is included. Open a trip's details to see its published description, departure point, adult/child prices and any buffet options.",matches.slice(0,3).map(t=>({tripId:String(t.id),title:t.title,price:Number(t.price),category:t.category,availability:"Read trip details"})),{type:"trips",label:"Explore Trips"});
  }

  const matching=valid.filter(t=>matchesCategories(t,q.categories));
  if(!matching.length) return reply("I couldn't find a published SeaGo trip matching that activity. Try another type of sea experience.",[],{type:"trips",label:"Explore All Trips"});
  const budgetMatches=q.maxBudget===null ? matching : matching.filter(t=>{
    const estimate=priceEstimate(t,q);
    return estimate!==null && estimate<=q.maxBudget;
  });
  if(!budgetMatches.length) return reply(
    `I couldn't find a listed trip within ${q.maxBudget} JOD for ${q.adults} ${q.adults===1?"adult":"adults"} and ${q.children} ${q.children===1?"child":"children"} at published base prices. Child estimates apply to ages 6–12; final checkout may add fees or extras.`,
    [],{type:"trips",label:"Explore Trips"}
  );

  // Every question checks the API again: the next cached departure may have
  // only one seat even when a later departure has enough for the group.
  // Never label a departure available based on stale home-page inventory.
  const checked=await Promise.all(budgetMatches.map(async trip=>{
    try {
      if(typeof listDepartures!=="function") throw new Error("LIVE_DEPARTURES_UNAVAILABLE");
      const rows=availableDepartures(await listDepartures(trip.apiId),now)
        .filter(dep=>Number(dep.availableSeats||0)>=q.guests && (!q.date || aqabaDateKey(dep.startsAt)===q.date));
      return {trip,departure:rows[0]||null,error:false};
    } catch {
      return {trip,departure:null,error:true};
    }
  }));
  const verified=checked.filter(row=>row.departure);
  const failed=checked.filter(row=>row.error);
  if(!verified.length) {
    const cards=budgetMatches.slice(0,3).map(trip=>({
      tripId:String(trip.id),title:trip.title,price:Number(trip.price),
      availability:failed.length?"Availability not verified":"No matching departure confirmed"
    }));
    if(failed.length) return reply(
      "I couldn't verify all live departures right now. Please open a trip to try again; I won't promise an available seat until the system confirms it.",
      cards,{type:"trips",label:"Explore Trips"}
    );
    const suffix=q.date?` for ${q.date}`:"";
    return reply(
      `I found ${budgetMatches.length} matching ${budgetMatches.length===1?"experience":"experiences"}, but no confirmed departure with ${q.guests} ${q.guests===1?"seat":"seats"}${suffix}. You can explore their details; booking requires a published available time.`,
      cards,{type:"trips",label:"Explore Trips"}
    );
  }
  verified.sort((a,b)=>new Date(a.departure.startsAt)-new Date(b.departure.startsAt));
  const picked=verified.slice(0,3).map(({trip,departure})=>({
    tripId:String(trip.id),title:trip.title,category:trip.category,price:Number(trip.price),
    availability:departure.startsAt,availableSeats:Number(departure.availableSeats||0)
  }));
  const count=q.guests;
  const budgetNote=q.maxBudget!==null?` under your ${q.maxBudget} JOD estimated base budget`:"";
  const estimateNote=q.children
    ?" Budget estimates use published adult and child (ages 6–12) prices. Extra services and final fees are confirmed in checkout."
    :" Prices shown are published adult base prices. Final fees and optional extras are confirmed in checkout.";
  return reply(
    `I found ${verified.length} ${verified.length===1?"experience":"experiences"} with a currently listed departure for ${count} ${count===1?"person":"people"}${budgetNote}.`+
    ` Availability can change until checkout.`+estimateNote,
    picked
  );
}
