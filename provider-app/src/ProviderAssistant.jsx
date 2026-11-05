import React,{useEffect,useRef,useState} from "react";
import {ArrowRight,Mic,Send,Square,ShipWheel,X} from "lucide-react";
import "./provider-assistant.css";

const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");
const intro={role:"assistant",text:"أهلين! أنا مساعد SeaGo. اسألني مثلاً: كم مقعد مؤكد اليوم؟ أو اطلب: جهّز رحلة غروب لمدة ساعتين وسعر الكبير 20 دينار."};
const samples=["كم مقعد محجوز اليوم؟","كم مقعد متاح بكرا؟","جهّز رحلة غروب في العقبة لمدة ساعتين بسعر 20 دينار للكبير"];
function toBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("تعذّر قراءة التسجيل."));reader.onload=()=>resolve(String(reader.result||"").split(",")[1]||"");reader.readAsDataURL(blob);});}
export default function ProviderAssistant({token,onClose,onUseDraft}){
  const [messages,setMessages]=useState([intro]);
  const [input,setInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [recording,setRecording]=useState(false);
  const [error,setError]=useState("");
  const recRef=useRef(null),micRef=useRef(null),timerRef=useRef(null),aliveRef=useRef(true),scrollRef=useRef(null);
  useEffect(()=>{scrollRef.current?.scrollIntoView({block:"end",behavior:"smooth"});},[messages,busy,error]);
  useEffect(()=>()=>{aliveRef.current=false;clearTimeout(timerRef.current);try{recRef.current?.stop();}catch{}micRef.current?.getTracks().forEach(t=>t.stop());},[]);
  async function send(payload,shown){
    if(busy)return;
    setBusy(true);setError("");
    setMessages(v=>[...v,{role:"user",text:shown}]);
    try{
      const r=await fetch(API+"/api/providers/me/assistant",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(payload)});
      const result=await r.json().catch(()=>({}));
      if(r.status===401){localStorage.removeItem("seago_provider_auth");window.dispatchEvent(new CustomEvent("seago:session-expired"));throw new Error("انتهت صلاحية تسجيل الدخول.");}
      if(!r.ok)throw new Error(result.error||"تعذّر إكمال الطلب.");
      if(!aliveRef.current)return;
      const rows=Array.isArray(result.rows)?result.rows.slice(0,20):[];
      setMessages(v=>[...v,{role:"assistant",text:result.text||"تم.",transcript:result.transcript||"",rows,draft:result.intent==="create_trip"?result.draft:null}]);
    }catch(e){if(aliveRef.current)setError(e.message||"جرّب مرة ثانية.");}
    finally{if(aliveRef.current)setBusy(false);}
  }
  function sendText(value=input){
    const content=String(value||"").trim();
    if(!content||busy||recording)return;
    setInput("");
    send({text:content},content);
  }
  function closeRecorder(){
    clearTimeout(timerRef.current);
    try{if(recRef.current?.state==="recording")recRef.current.stop();}catch{}
  }
  async function startRecording(){
    if(busy||recording)return;
    setError("");
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setError("تسجيل الصوت غير مدعوم في هذا المتصفح. يمكنك استخدام الشات.");return;}
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!aliveRef.current){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
      micRef.current=stream;recRef.current=recorder;
      const chunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      recorder.onerror=()=>{if(aliveRef.current)setError("تعذّر تسجيل الصوت.");};
      recorder.onstop=async()=>{
        clearTimeout(timerRef.current);stream.getTracks().forEach(t=>t.stop());recRef.current=null;micRef.current=null;
        if(!aliveRef.current)return;
        setRecording(false);
        const blob=new Blob(chunks,{type:recorder.mimeType.split(";")[0]||"audio/mp4"});
        if(blob.size<100)return;
        if(blob.size>450000){setError("التسجيل طويل جداً. جرّب رسالة أقصر من 20 ثانية.");return;}
        try{const base64=await toBase64(blob);if(aliveRef.current)send({audioBase64:base64,audioMimeType:blob.type},"🎙️ رسالة صوتية");}catch(e){setError(e.message);}
      };
      recorder.start(250);setRecording(true);
      timerRef.current=setTimeout(closeRecorder,19000);
    }catch{stream?.getTracks().forEach(t=>t.stop());if(aliveRef.current)setError("ما قدرت أفتح الميكروفون. تأكد من إعطاء الإذن أو استخدم الشات.");}
  }
  const time=v=>new Date(v).toLocaleTimeString("ar-JO",{timeZone:"Asia/Amman",hour:"2-digit",minute:"2-digit"});
  return <div className="app"><div className="seago-assistant" dir="rtl">
    <header className="seago-assistant-header"><div><span className="seago-assistant-icon"><ShipWheel size={20}/></span><div><strong>مساعد SeaGo</strong><small>مساعد عربي للرحلات والحجوزات</small></div></div><button type="button" onClick={onClose} aria-label="إغلاق المساعد"><X size={22}/></button></header>
    <div className="seago-assistant-messages" role="log" aria-live="polite">
      {messages.map((m,i)=><div key={i} className={"seago-assistant-message "+m.role}>
        <p>{m.text}</p>
        {m.transcript&&<small>سمعت: {m.transcript}</small>}
        {m.rows?.length>0&&<div className="seago-assistant-departures">{m.rows.map((d,j)=><div key={j}><strong>{d.trip}</strong><small>{time(d.startsAt)} · {d.status==="scheduled"?"مجدولة":d.status}</small><span>مؤكد: {d.confirmedSeats} · متاح: {d.availableSeats} · السعة: {d.capacity}</span></div>)}</div>}
        {m.draft&&<button type="button" className="seago-assistant-draft-button" onClick={()=>onUseDraft(m.draft)}>افتح نموذج الرحلة لمراجعته <ArrowRight size={16}/></button>}
      </div>)}
      {busy&&<p className="seago-assistant-thinking">جاري فهم طلبك…</p>}
      <div ref={scrollRef}/>
    </div>
    {messages.length===1&&<div className="seago-assistant-samples">{samples.map(s=><button key={s} type="button" disabled={busy||recording} onClick={()=>sendText(s)}>{s}</button>)}</div>}
    <footer className="seago-assistant-footer">
      {error&&<div className="seago-assistant-error" role="alert">{error}</div>}
      {recording&&<div className="seago-assistant-recording">جاري تسجيل صوتك… اضغط إيقاف للإرسال (حد أقصى 19 ثانية)</div>}
      <form onSubmit={e=>{e.preventDefault();sendText();}}>
        <button type="button" disabled={busy} onClick={recording?closeRecorder:startRecording} aria-label={recording?"إيقاف وإرسال التسجيل":"ابدأ تسجيل رسالة صوتية"} className={"seago-assistant-mic "+(recording?"recording":"")}>{recording?<Square size={20}/>:<Mic size={20}/>}</button>
        <input aria-label="رسالتك" disabled={busy||recording} value={input} maxLength={1500} placeholder="اسأل عن المقاعد أو اطلب رحلة…" onChange={e=>setInput(e.target.value)}/>
        <button type="submit" disabled={busy||recording||!input.trim()} aria-label="إرسال الرسالة"><Send size={20}/></button>
      </form>
      <small>قد يُرسل النص أو الصوت إلى Google لفهم الطلب ضمن الخطة المجانية. لا تكتب أسماء العملاء أو أرقامهم. لن تُنشأ رحلة قبل مراجعتك وحفظها.</small>
    </footer>
  </div></div>;
}
