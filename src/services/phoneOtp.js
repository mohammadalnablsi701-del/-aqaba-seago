function digits(value){return String(value||"").replace(/\D/g,"");}

export function normalizeJordanPhone(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  let d=digits(raw);
  if(d.startsWith("00962"))d=d.slice(2);
  if(d.startsWith("962"))return /^9627\d{8}$/.test(d)?"+"+d:"";
  if(d.startsWith("07")&&d.length===10)return "+962"+d.slice(1);
  if(d.startsWith("7")&&d.length===9)return "+962"+d;
  if(raw.startsWith("+")&&d.length>=8&&d.length<=15)return "+"+d;
  return "";
}

function authHeader(){
  const user=process.env.TWILIO_API_KEY||process.env.TWILIO_ACCOUNT_SID;
  const pass=process.env.TWILIO_API_SECRET||process.env.TWILIO_AUTH_TOKEN;
  if(!user||!pass)throw new Error("Twilio credentials are not configured");
  return "Basic "+Buffer.from(user+":"+pass).toString("base64");
}

function serviceSid(){
  const sid=String(process.env.TWILIO_VERIFY_SERVICE_SID||"").trim();
  if(!sid)throw new Error("TWILIO_VERIFY_SERVICE_SID is not configured");
  return sid;
}

async function twilioPost(path,params){
  const body=new URLSearchParams(params);
  const r=await fetch("https://verify.twilio.com/v2/Services/"+serviceSid()+path,{
    method:"POST",
    headers:{Authorization:authHeader(),"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    const e=new Error(data.message||"SMS verification service error");
    e.statusCode=502;
    throw e;
  }
  return data;
}

export async function sendPhoneOtp(phone){
  return twilioPost("/Verifications",{To:phone,Channel:"sms"});
}

export async function checkPhoneOtp(phone,code){
  const data=await twilioPost("/VerificationCheck",{To:phone,Code:String(code||"").trim()});
  return data.status==="approved";
}

export function phoneCandidates(normalized){
  if(!normalized)return [];
  const d=normalized.replace(/^\+/,"");
  const out=[normalized,d];
  if(d.startsWith("9627")&&d.length===12){
    out.push("0"+d.slice(3));
    out.push(d.slice(3));
  }
  return [...new Set(out)];
}
