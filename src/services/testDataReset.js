import Booking from "../models/Booking.js";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";
import InAppNotification from "../models/InAppNotification.js";
import NotificationLog from "../models/NotificationLog.js";
import Payment from "../models/Payment.js";
import PaymentEvent from "../models/PaymentEvent.js";
import Provider from "../models/Provider.js";
import ProviderAuditLog from "../models/ProviderAuditLog.js";
import ProviderMember from "../models/ProviderMember.js";
import PushSubscription from "../models/PushSubscription.js";
import SupportRequest from "../models/SupportRequest.js";
import Trip from "../models/Trip.js";
import User from "../models/User.js";

const CONFIRM="WIPE_NON_ADMIN_TEST_DATA_20261004";

export async function resetTestDataOnStart(){
  if(process.env.RESET_TEST_DATA_ON_START!==CONFIRM)return null;

  const before={
    users:await User.countDocuments({role:{$ne:"admin"}}),
    admins:await User.countDocuments({role:"admin"}),
    providers:await Provider.countDocuments({}),
    trips:await Trip.countDocuments({}),
    departures:await Departure.countDocuments({}),
    bookings:await Booking.countDocuments({}),
    payments:await Payment.countDocuments({})
  };

  const results={};
  const wipe=async(name,Model,filter={})=>{
    const r=await Model.deleteMany(filter);
    results[name]=r.deletedCount||0;
  };

  await wipe("paymentEvents",PaymentEvent);
  await wipe("payments",Payment);
  await wipe("checkoutHolds",CheckoutHold);
  await wipe("bookings",Booking);
  await wipe("departures",Departure);
  await wipe("providerAuditLogs",ProviderAuditLog);
  await wipe("providerMembers",ProviderMember);
  await wipe("trips",Trip);
  await wipe("providers",Provider);
  await wipe("pushSubscriptions",PushSubscription);
  await wipe("inAppNotifications",InAppNotification);
  await wipe("notificationLogs",NotificationLog);
  await wipe("supportRequests",SupportRequest);
  await wipe("nonAdminUsers",User,{role:{$ne:"admin"}});

  const after={
    users:await User.countDocuments({role:{$ne:"admin"}}),
    admins:await User.countDocuments({role:"admin"}),
    providers:await Provider.countDocuments({}),
    trips:await Trip.countDocuments({}),
    departures:await Departure.countDocuments({}),
    bookings:await Booking.countDocuments({}),
    payments:await Payment.countDocuments({})
  };

  return{before,deleted:results,after};
}
