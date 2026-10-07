import Booking from "../models/Booking.js";
const id=value=>String(value?._id||value||"");
function reject(message,statusCode=409){throw Object.assign(new Error(message),{statusCode});}
export function assertCheckInScope(booking,{providerId,departureId}){
  if(providerId&&id(booking.providerId)!==id(providerId))reject("This ticket belongs to another provider",403);
  if(!/^[a-f0-9]{24}$/i.test(String(departureId||"")))reject("Select a departure before scanning",400);
  if(id(booking.departureId)!==id(departureId))reject("This ticket belongs to a different departure");
}
export function checkInEligibility(booking,now=new Date()){
  if(booking.checkedInAt)return {valid:false,error:"Ticket already checked in"};
  if(booking.status!=="confirmed")return {valid:false,error:"Ticket is not valid for check-in"};
  if(booking.departureId?.status!=="scheduled")return {valid:false,error:"Departure is not open for check-in"};
  const startsAt=new Date(booking.departureId.startsAt).getTime();
  if(!Number.isFinite(startsAt))return {valid:false,error:"Departure time is unavailable"};
  const checkInOpensAt=new Date(startsAt-2*60*60*1000);
  if(now<checkInOpensAt)return {valid:false,error:"Check-in opens 2 hours before departure",checkInOpensAt};
  return {valid:true,checkInOpensAt};
}
export async function claimCheckIn(booking,{providerId,departureId,userId,now=new Date()}){
  assertCheckInScope(booking,{providerId,departureId});
  const eligibility=checkInEligibility(booking,now);
  if(!eligibility.valid)reject(eligibility.error);
  const claimed=await Booking.findOneAndUpdate({
    _id:booking._id,providerId:booking.providerId?._id||booking.providerId,
    departureId,status:"confirmed",checkedInAt:null
  },{$set:{checkedInAt:now,checkedInBy:userId},$inc:{checkInCount:1}},{new:true});
  if(!claimed)reject("Ticket already checked in or no longer valid");
  return claimed;
}
