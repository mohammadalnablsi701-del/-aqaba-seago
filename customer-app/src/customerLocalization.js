// Customer discovery and booking translations. English copy is the stable lookup key.
// Keep payment amounts, provider names, and legal policies grounded in the backend.
export const CUSTOMER_LANGUAGE_KEY = "seago_customer_language";
export const LANGUAGES = Object.freeze(["en","ar"]);

const AR = Object.freeze({
  "Home":"الرئيسية","Trips":"الرحلات","Tickets":"التذاكر","Alerts":"التنبيهات","Profile":"حسابي",
  "Sea Experiences":"التجارب البحرية","My Tickets":"تذاكري","Favourites":"المفضلة","Explore Aqaba":"اكتشف العقبة",
  "Make Aqaba Unforgettable":"خلّي العقبة ذكرى لا تُنسى","Your next Red Sea memory starts here.":"رحلتك البحرية القادمة تبدأ من هنا.",
  "Trip Type":"نوع الرحلة","Date":"التاريخ","Persons":"الأشخاص","Person":"شخص","Search Trips":"ابحث عن رحلات",
  "Loading trips...":"جاري تحميل الرحلات...","Searching...":"جاري البحث...",
  "All Trips":"كل الرحلات","Yachts":"اليخوت","Boat Trips":"الرحلات البحرية","Snorkeling":"السنوركل",
  "Diving":"الغوص","Sunset":"الغروب","Verified operators":"شركات معتمدة",
  "Approved SeaGo partners":"شركاء معتمدون في SeaGo","Clear pricing":"أسعار واضحة",
  "No hidden fees":"دون رسوم خفية","Instant ticket":"تذكرة فورية","After payment":"بعد الدفع",
  "Popular Sea Experiences":"رحلات بحرية مميزة","Trusted trips picked for an easy day on the Red Sea.":"اكتشف الرحلات البحرية المتاحة في العقبة.",
  "See all":"عرض الكل","Loading sea experiences...":"جاري تحميل الرحلات البحرية...",
  "Trips are available to explore, but no future departures are scheduled yet. Booking will open once operators publish dates.":"يمكنك استعراض الرحلات، لكن لا توجد مواعيد مغادرة مستقبلية حاليًا. سيتاح الحجز عندما تنشر الشركات مواعيد جديدة.",
  "SeaGo can’t load live experiences right now. Please try again shortly.":"تعذّر تحميل الرحلات حاليًا. حاول مجددًا بعد قليل.",
  "Preview mode · sample trips are shown because no live API is configured.":"وضع المعاينة: تُعرض رحلات نموذجية لعدم اتصال النظام بالخادم.",
  "Verified operator":"شركة معتمدة","Aqaba":"العقبة","No departures available":"لا توجد مواعيد متاحة",
  "Next":"التالي","seats":"مقاعد","From":"ابتداءً من","per adult":"للبالغ","View details":"عرض التفاصيل",
  "View experience":"استكشف الرحلة","Photo not yet provided":"لم تُضف الشركة صورًا لهذه الرحلة بعد",
  "Official trip photos":"صور الرحلة المقدمة من الشركة","Photos unavailable":"صور الرحلة غير متاحة",
  "Sea Experiences":"التجارب البحرية","Verified Red Sea trips, clear pricing and live availability.":"رحلات بحرية وأسعار واضحة ومواعيد متاحة للحجز.",
  "Sort":"ترتيب","Recommended":"المقترحة","Price: Low to High":"السعر: من الأقل للأعلى",
  "Price: High to Low":"السعر: من الأعلى للأقل","Shortest first":"الأقصر أولًا",
  "experience":"رحلة","experiences":"رحلات","No trips available for your search":"لا توجد رحلات مطابقة لبحثك",
  "No trips in this category":"لا توجد رحلات ضمن هذه الفئة",
  "Try a different date or party size, or check the next available experience below.":"جرّب تاريخًا مختلفًا أو عددًا أقل من الأشخاص، أو اختر أقرب رحلة متاحة.",
  "There are no future departure dates published yet. You can still explore the available experiences.":"لم تُنشر مواعيد مغادرة مستقبلية بعد، لكن يمكنك استعراض تفاصيل الرحلات.",
  "Try another category or see all experiences.":"جرّب فئة أخرى أو اعرض جميع الرحلات.",
  "Next available":"أقرب رحلة متاحة","Show all experiences":"عرض جميع الرحلات",
  "Finding the best sea experiences...":"جاري البحث عن الرحلات البحرية...",
  "Aqaba, Jordan":"العقبة، الأردن","Verified SeaGo experience":"رحلة من شركة معتمدة",
  "Approved SeaGo partner":"شريك معتمد في SeaGo","Duration":"المدة","ABOUT THIS EXPERIENCE":"عن الرحلة",
  "TRIP ESSENTIALS":"معلومات الرحلة","Experience":"التجربة","Availability":"المقاعد المتاحة",
  "No live departure":"لا يوجد موعد مغادرة متاح","Departure":"نقطة الانطلاق",
  "UPCOMING DEPARTURES":"المواعيد القادمة","Searched date":"تاريخ البحث",
  "Your searched departure is no longer available. Select a different date below; we will not change it automatically.":"الموعد الذي بحثت عنه غير متاح الآن. اختر موعدًا آخر بنفسك؛ لن نغيّر تاريخك تلقائيًا.",
  "Checking live availability...":"جاري التحقق من المواعيد...",
  "No future departures are available yet.":"لا توجد مواعيد مستقبلية متاحة بعد.",
  "Live availability is temporarily unavailable.":"تعذّر التحقق من المواعيد مؤقتًا.",
  "Show all available dates":"عرض جميع المواعيد","Show fewer dates":"عرض مواعيد أقل",
  "Continue with selected time":"المتابعة بالموعد المحدد","No departures available":"لا توجد مواعيد متاحة",
  "Instant confirmation":"تأكيد فوري","Ticket issued after successful payment":"تُصدر التذكرة بعد نجاح الدفع",
  "Flexible cancellation":"إلغاء مرن","100% refund 24+ hours before departure":"استرداد كامل قبل موعد الرحلة بـ24 ساعة أو أكثر",
  "OPEN BUFFET OPTION":"خيار البوفيه","Add a meal to your trip":"أضف وجبة إلى رحلتك",
  "Buffet details are provided by the operator.":"تفاصيل البوفيه تقدمها شركة الرحلات.",
  "DEPARTURE POINT":"نقطة الانطلاق","Open in Maps":"افتح على الخرائط",
  "CANCELLATION POLICY":"سياسة الإلغاء","Know your refund before you book":"اطلع على سياسة الاسترداد قبل الحجز",
  "100% refund":"استرداد كامل","50% refund":"استرداد 50%","No refund":"لا يوجد استرداد",
  "Children (6–12)":"الأطفال (6–12)","Adult":"بالغ","Child":"طفل",
  "BOOKING · STEP 1 OF 2":"الحجز · الخطوة 1 من 2",
  "Choose your trip details":"اختر تفاصيل رحلتك",
  "Review the departure, persons and package before payment.":"راجع موعد الرحلة وعدد الأشخاص والباقة قبل الدفع.",
  "Your search":"بحثك","1 · CHOOSE DEPARTURE":"1 · اختر موعد المغادرة",
  "2 · PERSONS & PACKAGE":"2 · الأشخاص والباقة",
  "Adults":"البالغون","Children":"الأطفال","Buffet":"البوفيه",
  "No buffet":"دون بوفيه","Base trip price":"السعر الأساسي للرحلة",
  "Add open buffet":"إضافة بوفيه مفتوح","Live price updates below":"سيظهر السعر المحدّث أدناه",
  "Account":"الحساب","Sign in during booking":"تسجيل الدخول أثناء الحجز",
  "Phone on ticket":"الهاتف على التذكرة","LIVE PRICE SUMMARY":"ملخص السعر النهائي",
  "Calculated by SeaGo":"يحسبه نظام SeaGo","Package":"الباقة",
  "Open buffet":"بوفيه مفتوح","Service fee":"رسوم الخدمة",
  "Included":"مشمولة","Total":"الإجمالي","Updating price...":"جاري تحديث السعر...",
  "Current price unavailable. Try again.":"السعر غير متاح الآن. حاول مجددًا.",
  "Choose a departure to see the live price":"اختر موعدًا للاطلاع على السعر",
  "Secure checkout":"دفع آمن","Instant ticket after payment":"تذكرة فورية بعد الدفع",
  "Continue to secure payment":"المتابعة للدفع الآمن",
  "24+ hours: 100% refund · 12–24 hours: 50% · Less than 12 hours: no refund":"قبل 24 ساعة: استرداد كامل · من 12 إلى 24 ساعة: 50% · أقل من 12 ساعة: دون استرداد",
  "You will review the final amount before payment. Your booking and QR ticket are created only after successful payment.":"ستراجع المبلغ النهائي قبل الدفع. لا يُؤكد الحجز ولا تصدر تذكرة QR إلا بعد نجاح الدفع.",
  "The date you selected is no longer available. Choose another departure above before continuing.":"لم يعد التاريخ الذي اخترته متاحًا. اختر موعدًا آخر قبل المتابعة.",
  "STEP 2 OF 2":"الخطوة 2 من 2","Test payment ready":"الدفع التجريبي جاهز",
  "Ready for secure payment":"جاهز للدفع الآمن",
  "Controlled pilot mode: this is a test payment and no real money will be charged.":"هذا دفع تجريبي لأغراض الاختبار، ولن يُخصم أي مبلغ حقيقي.",
  "Your selected seats are temporarily protected. Complete payment to create the confirmed booking and QR ticket.":"حُجزت المقاعد مؤقتًا. أتمم الدفع لتأكيد الحجز وإصدار التذكرة.",
  "Price updated to the latest server amount before payment.":"تم تحديث السعر وفق أحدث مبلغ معتمد قبل الدفع.",
  "Vessel":"اليخت أو القارب","Seats reserved for":"المقاعد محفوظة لمدة",
  "Complete payment before the timer ends.":"أكمل الدفع قبل انتهاء المهلة.",
  "Seat hold expired":"انتهت مهلة حجز المقاعد","Return to trip details to check availability again.":"ارجع لتفاصيل الرحلة للتحقق من التوفر.",
  "Booking created only after successful payment":"يُؤكد الحجز بعد نجاح الدفع فقط",
  "QR ticket available immediately after confirmation":"تذكرة QR متاحة بعد التأكيد",
  "Pay securely":"ادفع بأمان","Hold expired":"انتهت المهلة",
  "Check availability again":"تحقق من التوفر مجددًا","Back to trip details":"العودة لتفاصيل الرحلة",
  "Sign in to book":"سجّل الدخول للحجز","Create your account":"أنشئ حسابك",
  "Continue with Google or use your email and password.":"تابع عبر Google أو البريد الإلكتروني وكلمة المرور.",
  "or use email":"أو استخدم البريد الإلكتروني","Full name":"الاسم الكامل",
  "Email":"البريد الإلكتروني","Phone (optional)":"الهاتف (اختياري)",
  "Password (8+ characters)":"كلمة المرور (8 أحرف على الأقل)",
  "Sign in":"تسجيل الدخول","Create account":"إنشاء حساب",
  "New to SeaGo? Create an account":"جديد في SeaGo؟ أنشئ حسابًا",
  "Already have an account? Sign in":"عندك حساب؟ سجّل الدخول",
  "My SeaGo Tickets":"تذاكري في SeaGo","No trips booked yet":"لم تحجز أي رحلة بعد",
  "Once you book a SeaGo experience, your QR ticket and departure details will appear here.":"بعد الحجز، ستظهر هنا التذكرة ورمز QR وتفاصيل موعد المغادرة.",
  "Sign in to view your tickets":"سجّل الدخول لعرض التذاكر",
  "Your SeaGo bookings stay linked to your account.":"حجوزات SeaGo مرتبطة بحسابك.",
  "Everything you need for check-in, all in one place.":"كل ما تحتاجه للصعود إلى الرحلة في مكان واحد.",
  "Customer name":"اسم العميل","Phone number":"رقم الهاتف","Time":"الوقت",
  "Booking reference":"رقم الحجز","Show at check-in":"أظهرها عند الصعود",
  "Ready for check-in":"جاهزة للصعود","Keep this ticket open when you arrive":"احتفظ بالتذكرة جاهزة عند وصولك",
  "Ticket used":"تم استخدام التذكرة","Confirmed":"مؤكّد",
  "Cancelled":"ملغي","Expired":"منتهي","Refunded":"مسترد","Verified operator":"شركة معتمدة"
});

export function languageFromStorage(value) {
  return value==="ar"?"ar":"en";
}
export function tr(key, language="en") {
  return language==="ar"?(AR[key]||key):key;
}
export function localizedTripTitle(trip,language="en") {
  if(language==="ar"){
    const ar=String(trip?.raw?.titleAr||trip?.titleAr||"").trim();
    if(ar)return ar;
  }
  return String(trip?.title||trip?.raw?.titleEn||trip?.raw?.titleAr||"Aqaba Sea Experience");
}
export function localizedTripCategory(category,language="en") {
  return tr(String(category||""),language);
}
export function localizedTripDuration(trip,language="en") {
  if(language!=="ar")return String(trip?.duration||"");
  const minutes=Number(trip?.raw?.durationMinutes);
  if(!Number.isFinite(minutes)||minutes<=0)return String(trip?.duration||"");
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return [hours?hours===1?"ساعة":hours===2?"ساعتان":`${hours} ساعات`:"",rest?`${rest} دقيقة`:""].filter(Boolean).join(" و");
}
export function localizedDepartureDate(value,language="en") {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return "";
  return new Intl.DateTimeFormat(language==="ar"?"ar-JO":"en-GB",{
    timeZone:"Asia/Amman",weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"
  }).format(date);
}
// Show only operator supplied web images. Never use fabricated/stock trip photos.
export function verifiedTripImages(images) {
  if(!Array.isArray(images))return [];
  return images.map(item=>typeof item==="string"?item:item?.url)
    .filter(value=>{
      if(typeof value!=="string")return false;
      try { const url=new URL(value);return url.protocol==="https:" && Boolean(url.hostname) && !url.username && !url.password; }
      catch {return false;}
    }).slice(0,10);
}
