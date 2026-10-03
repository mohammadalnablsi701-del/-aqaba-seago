import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import CheckoutHold from "../models/CheckoutHold.js";
import Payment from "../models/Payment.js";
import Booking from "../models/Booking.js";
import InAppNotification from "../models/InAppNotification.js";
import NotificationLog from "../models/NotificationLog.js";

async function api(base,path,{method="GET",token,body,headers={}}={}) {
  const r=await fetch(base+path,{
    method,
    headers:{
      ...(body?{"Content-Type":"application/json"}:{}),
      ...(token?{Authorization:`Bearer ${token}`}:{}),
      ...headers
    },
    body:body?JSON.stringify(body):undefined
  });
  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!r.ok){
    const e=new Error(data.error||`${method} ${path} failed (${r.status})`);
    e.status=r.status;e.data=data;throw e;
  }
  return data;
}

export async function runPilotE2EOnce({port}) {
  if(process.env.RUN_PILOT_E2E_ON_START!=="true") return {skipped:true,reason:"disabled"};
  if(process.env.ENABLE_MOCK_CHECKOUT!=="true") return {skipped:true,reason:"mock-checkout-disabled"};

  const stamp=Date.now();
  const password=`SeaGoPilot-${stamp}-A9!`;
  const adminEmail=`pilot-admin-${stamp}@aqabaseago.test`;
  const providerEmail=`pilot-provider-${stamp}@aqabaseago.test`;
  const customerEmail=`pilot-customer-${stamp}@aqabaseago.test`;
  const base=`http://127.0.0.1:${port}`;

  let adminUser=null,providerUser=null,customerUser=null;
  let provider=null,trip=null,departure=null,booking=null;
  let paymentId=null;

  const result={ok:false,steps:[]};
  const step=(name,extra={})=>result.steps.push({name,ok:true,...extra});

  try{
    adminUser=await User.create({
      name:"SeaGo Pilot Admin",
      email:adminEmail,
      role:"admin",
      isActive:true,
      passwordHash:await bcrypt.hash(password,12)
    });
    step("temporary-admin-created");

    const adminLogin=await api(base,"/api/auth/login",{method:"POST",body:{email:adminEmail,password}});
    const adminToken=adminLogin.token;
    step("admin-login");

    const providerReg=await api(base,"/api/auth/register",{method:"POST",body:{
      name:"SeaGo Pilot Provider",email:providerEmail,phone:"+962790000111",password,role:"provider"
    }});
    providerUser=await User.findOne({email:providerEmail});
    const providerToken=providerReg.token;
    step("provider-register");

    provider=await api(base,"/api/providers",{method:"POST",token:providerToken,body:{
      businessName:"SeaGo Pilot Test Partner",phone:"+962790000111"
    }});
    step("provider-profile",{providerId:provider._id});

    await api(base,`/api/admin/providers/${provider._id}/approve`,{method:"PATCH",token:adminToken});
    step("provider-approved");

    const me=await api(base,"/api/providers/me",{token:providerToken});
    if(me.status!=="approved") throw new Error("Provider approval not visible");
    step("provider-approved-visible");

    trip=await api(base,"/api/trips",{method:"POST",token:providerToken,body:{
      titleAr:"رحلة اختبار SeaGo",
      titleEn:"SeaGo Pilot E2E Trip",
      category:"snorkeling",
      durationMinutes:90,
      active:true,
      departureLocation:{name:"Aqaba Marina",address:"Aqaba, Jordan",googleMapsUrl:"https://maps.google.com/?q=Aqaba+Marina"},
      pricing:{adultPrice:20,childPrice:10,buffetEnabled:false}
    }});
    step("trip-created",{tripId:trip._id});

    const startsAt=new Date(Date.now()+48*60*60*1000).toISOString();
    departure=await api(base,"/api/departures",{method:"POST",token:providerToken,body:{
      tripId:trip._id,startsAt,capacity:6
    }});
    step("departure-created",{departureId:departure._id});

    const bulkTimes=[
      new Date(Date.now()+72*60*60*1000).toISOString(),
      new Date(Date.now()+96*60*60*1000).toISOString()
    ];
    const bulk=await api(base,"/api/departures/bulk",{method:"POST",token:providerToken,body:{
      tripId:trip._id,startsAtList:bulkTimes,capacity:8
    }});
    if(Number(bulk.created)!==2) throw new Error("Bulk departure creation mismatch");
    step("bulk-departures-created",{created:bulk.created});

    const providerTrips=await api(base,"/api/providers/me/trips",{token:providerToken});
    const providerTrip=providerTrips.find(x=>String(x._id)===String(trip._id));
    if(!providerTrip||Number(providerTrip.schedule?.upcomingDepartures)<3) throw new Error("Provider trip schedule summary mismatch");
    step("provider-trip-schedule-summary",{upcoming:providerTrip.schedule.upcomingDepartures});

    const publicTrips=await api(base,"/api/trips");
    if(!publicTrips.some(x=>String(x._id)===String(trip._id))) throw new Error("Trip not visible publicly");
    step("trip-public");

    const publicDeps=await api(base,`/api/departures?tripId=${encodeURIComponent(trip._id)}`);
    const depRow=publicDeps.find(x=>String(x.id)===String(departure._id));
    if(!depRow||Number(depRow.availableSeats)!==6) throw new Error("Departure availability mismatch");
    step("departure-public",{availableSeats:depRow.availableSeats});

    const quote=await api(base,`/api/departures/${departure._id}/quote?adults=2&children=1&mealPlan=without_buffet`);
    if(Number(quote.pricing?.grossAmount)!==50) throw new Error("Quote total mismatch");
    step("quote",{grossAmount:quote.pricing.grossAmount});

    const customerReg=await api(base,"/api/auth/register",{method:"POST",body:{
      name:"SeaGo Pilot Customer",email:customerEmail,phone:"+962790000222",password,role:"customer"
    }});
    customerUser=await User.findOne({email:customerEmail});
    const customerToken=customerReg.token;
    step("customer-register");

    const checkout=await api(base,"/api/payments/checkout",{method:"POST",token:customerToken,
      headers:{"Idempotency-Key":`pilot-${stamp}`},
      body:{departureId:departure._id,adults:2,children:1,mealPlan:"without_buffet"}
    });
    paymentId=checkout.paymentId;
    if(checkout.provider!=="mock") throw new Error("Pilot checkout did not use mock provider");
    step("checkout",{paymentId,amount:checkout.amount});

    const depAfterHold=(await api(base,`/api/departures?tripId=${encodeURIComponent(trip._id)}`))
      .find(x=>String(x.id)===String(departure._id));
    if(Number(depAfterHold?.availableSeats)!==3) throw new Error("Seat hold did not reserve 3 seats");
    step("seat-hold",{availableSeats:depAfterHold.availableSeats});

    const paid=await api(base,`/api/mock-payments/${paymentId}/complete`,{
      method:"POST",body:{status:"paid"}
    });
    if(paid.paymentStatus!=="paid"||!paid.bookingId) throw new Error("Mock payment did not create booking");
    step("mock-payment-paid",{bookingId:paid.bookingId});

    const payment=await api(base,`/api/payments/${paymentId}`,{token:customerToken});
    if(payment.status!=="paid"||!payment.bookingId) throw new Error("Payment verification failed");
    step("payment-verified");

    const providerNotifications=await api(base,"/api/notifications",{token:providerToken});
    const bookingNotice=providerNotifications.items?.find(n=>String(n.bookingId)===String(payment.bookingId));
    if(!bookingNotice||bookingNotice.data?.screen!=="bookings") throw new Error("Provider booking notification is not actionable");
    step("provider-booking-notification-actionable");

    const tickets=await api(base,"/api/bookings",{token:customerToken});
    booking=tickets.find(x=>String(x._id)===String(paid.bookingId));
    if(!booking||booking.status!=="confirmed"||!booking.ticketToken) throw new Error("Confirmed ticket not returned");
    step("ticket-issued");

    const inspected=await api(base,"/api/tickets/inspect",{method:"POST",token:providerToken,body:{token:booking.ticketToken}});
    if(!inspected.valid||Number(inspected.guests)!==3) throw new Error("Provider ticket inspection failed");
    step("ticket-inspected");

    const checked=await api(base,"/api/tickets/check-in",{method:"POST",token:providerToken,body:{token:booking.ticketToken}});
    if(!checked.ok||Number(checked.guests)!==3) throw new Error("Provider check-in failed");
    step("ticket-checked-in");

    let duplicateRejected=false;
    try{
      await api(base,"/api/tickets/check-in",{method:"POST",token:providerToken,body:{token:booking.ticketToken}});
    }catch(e){ duplicateRejected=e.status===409; }
    if(!duplicateRejected) throw new Error("Duplicate check-in was not rejected");
    step("duplicate-checkin-rejected");

    const checkout2=await api(base,"/api/payments/checkout",{method:"POST",token:customerToken,
      headers:{"Idempotency-Key":`pilot-manual-${stamp}`},
      body:{departureId:departure._id,adults:1,children:0,mealPlan:"without_buffet"}
    });
    const paid2=await api(base,`/api/mock-payments/${checkout2.paymentId}/complete`,{
      method:"POST",body:{status:"paid"}
    });
    if(!paid2.bookingId) throw new Error("Second booking was not created");
    step("manual-checkin-booking-created",{bookingId:paid2.bookingId});

    const providerBookings=await api(base,"/api/providers/me/bookings",{token:providerToken});
    if(!providerBookings.some(x=>String(x._id)===String(paid2.bookingId))) throw new Error("Provider all-bookings list missing booking");
    step("provider-all-bookings-visible");

    const manual=await api(base,`/api/providers/me/bookings/${paid2.bookingId}/check-in`,{method:"POST",token:providerToken});
    if(!manual.ok||Number(manual.guests)!==1) throw new Error("Manual provider check-in failed");
    step("manual-provider-checkin");

    let manualDuplicateRejected=false;
    try{
      await api(base,`/api/providers/me/bookings/${paid2.bookingId}/check-in`,{method:"POST",token:providerToken});
    }catch(e){ manualDuplicateRejected=e.status===409; }
    if(!manualDuplicateRejected) throw new Error("Duplicate manual check-in was not rejected");
    step("duplicate-manual-checkin-rejected");

    const depFinal=(await api(base,`/api/departures?tripId=${encodeURIComponent(trip._id)}`))
      .find(x=>String(x.id)===String(departure._id));
    if(Number(depFinal?.availableSeats)!==2) throw new Error("Booked seats were not retained after both bookings");
    step("capacity-consistent",{availableSeats:depFinal.availableSeats});

    result.ok=true;
    result.summary={
      providerApproved:true,
      tripPublic:true,
      departurePublic:true,
      quoted:true,
      checkout:true,
      paymentPaid:true,
      bookingConfirmed:true,
      qrInspected:true,
      checkedIn:true,
      duplicateCheckInBlocked:true
    };
    return result;
  }finally{
    try{
      const userIds=[adminUser?._id,providerUser?._id,customerUser?._id].filter(Boolean);
      const providerId=provider?._id;
      const tripId=trip?._id;
      const departureId=departure?._id;

      const bookings=await Booking.find({
        $or:[
          ...(customerUser?[{customerId:customerUser._id}]:[]),
          ...(tripId?[{tripId}]:[])
        ]
      }).select("_id");
      const bookingIds=bookings.map(x=>x._id);

      if(bookingIds.length){
        await NotificationLog.deleteMany({bookingId:{$in:bookingIds}});
        await InAppNotification.deleteMany({bookingId:{$in:bookingIds}});
      }
      if(userIds.length) await InAppNotification.deleteMany({userId:{$in:userIds}});
      if(paymentId) await Payment.deleteMany({_id:paymentId});
      if(customerUser) await Payment.deleteMany({customerId:customerUser._id});
      if(customerUser) await CheckoutHold.deleteMany({customerId:customerUser._id});
      if(bookingIds.length) await Booking.deleteMany({_id:{$in:bookingIds}});
      if(tripId) await Departure.deleteMany({tripId});
      else if(departureId) await Departure.deleteMany({_id:departureId});
      if(tripId) await Trip.deleteMany({_id:tripId});
      if(providerId) await Provider.deleteMany({_id:providerId});
      if(userIds.length) await User.deleteMany({_id:{$in:userIds}});
      result.cleanup={ok:true};
    }catch(cleanErr){
      result.cleanup={ok:false,error:String(cleanErr?.message||cleanErr)};
      console.error("Pilot E2E cleanup failed",cleanErr);
    }
  }
}
