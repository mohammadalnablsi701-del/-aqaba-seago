import React,{useEffect,useRef,useState} from "react";
import {ArrowRight,CheckCircle2,Headphones,Mic,Send,ShipWheel,Square,Volume2,X} from "lucide-react";
import "./provider-assistant.css";

const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");
const intro={role:"assistant",text:"أهلاً! أنا مساعد SeaGo 🌊\nاحكي معي بطبيعتك، بالشات أو بالصوت. بنقدر نجهّز رحلة جديدة خطوة بخطوة، أو نفحص المقاعد والحجوزات من بيانات شركتك."};
const starter=["بدي أضيف رحلة","كم مقعد محجوز اليوم؟","شو المقاعد المتاحة بكرا؟"];
function toBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("تعذّر قراءة التسجيل."));r.onload=()=>resolve(String(r.result||"").split(",")[1]||"");r.readAsDataURL(blob);});}
function speakArabic(text){
  if(!("speechSynthesis" in window)||typeof SpeechSynthesisUtterance==="undefined")return false;
  try{
    window.speechSynthesis.cancel();
    const msg=new SpeechSynthesisUtterance(String(text||"").slice(0,650));
    msg.lang="ar-JO";msg.rate=0.95;
    const voices=window.speechSynthesis.getVoices();
    const arabic=voices.find(v=>v.lang?.toLowerCase()==="ar-jo")||voices.find(v=>v.lang?.toLowerCase().startsWith("ar"));
    if(arabic)msg.voice=arabic;
    window.speechSynthesis.speak(msg);return true;
  }catch{return false;}
}
export default function ProviderAssistant({token,onClose,onUseDraft}){
  const [messages,setMessages]=useState([intro]);
  const [input,setInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [consent,setConsent]=useState(false);
  const [recording,setRecording]=useState(false);
  const [error,setError]=useState("");
  const [audioError,setAudioError]=useState("");
  const contextRef=useRef({mode:"",draft:{}});
  const sendingRef=useRef(false),recRef=useRef(null),micRef=useRef(null),timerRef=useRef(null),aliveRef=useRef(true),scrollRef=useRef(null);
  useEffect(()=>{scrollRef.current?.scrollIntoView({block:"end",behavior:"smooth"});},[messages,busy,error]);
  useEffect(()=>()=>{aliveRef.current=false;clearTimeout(timerRef.current);try{recRef.current?.stop();}catch{}micRef.current?.getTracks().forEach(t=>t.stop());try{window.speechSynthesis?.cancel();}catch{}},[]);
  const latest=messages.at(-1);
  const chips=latest?.role==="assistant"&&Array.isArray(latest.suggestions)?latest.suggestions:(messages.length===1?starter:[]);
  async function send(payload,shown){
    if(sendingRef.current||recording)return;
    if(!consent){setError("وافق أولاً على إرسال رسالتك إلى Google لفهم الطلب.");return;}
    sendingRef.current=true;setBusy(true);setError("");setAudioError("");
    setMessages(v=>[...v,{role:"user",text:shown}]);
    try{
      const response=await fetch(API+"/api/providers/me/assistant",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({...payload,context:contextRef.current})
      });
      const result=await response.json().catch(()=>({}));
      if(response.status===401){localStorage.removeItem("seago_provider_auth");window.dispatchEvent(new CustomEvent("seago:session-expired"));throw new Error("انتهت صلاحية تسجيل الدخول.");}
      if(!response.ok)throw new Error(result.error||"تعذّر إكمال الطلب.");
      if(!aliveRef.current)return;
      const mode=result.mode==="create_trip"?"create_trip":result.mode==="seats"?"seats":"";
      contextRef.current={mode,draft:mode==="create_trip"&&result.draft&&typeof result.draft==="object"?result.draft:{}};
      setMessages(v=>[...v,{
        role:"assistant",intent:result.intent,text:result.text||"تمام، كيف بقدر أساعدك؟",
        transcript:payload.audioBase64?result.transcript||"":"",rows:Array.isArray(result.rows)?result.rows.slice(0,20):[],
        ready:result.ready===true,progress:Number(result.progress)||0,total:Number(result.total)||4,
        draft:mode==="create_trip"?contextRef.current.draft:null,
        suggestions:Array.isArray(result.suggestions)?result.suggestions.slice(0,4).filter(x=>typeof x==="string"):[]
      }]);
    }catch(e){if(aliveRef.current)setError(e.message||"جرّب مرة ثانية.");}
    finally{sendingRef.current=false;if(aliveRef.current)setBusy(false);}
  }
  function sendText(value=input){
    const text=String(value||"").trim();
    if(!text||sendingRef.current||recording)return;
    if(!consent){setError("وافق أولاً على معالجة رسائلك بواسطة Google.");return;}
    setInput("");send({text},text);
  }
  function stopRecording(){
    clearTimeout(timerRef.current);
    try{if(recRef.current?.state==="recording")recRef.current.stop();}catch{}
  }
  async function startRecording(){
    if(sendingRef.current||recording)return;
    if(!consent){setError("وافق أولاً على معالجة الرسالة الصوتية لدى Google.");return;}
    setError("");setAudioError("");
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setAudioError("تسجيل الصوت مش مدعوم بجهازك حالياً. استخدم الشات.");return;}
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!aliveRef.current){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=["audio/mp4","audio/webm;codecs=opus","audio/webm"].find(m=>MediaRecorder.isTypeSupported(m));
      const recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
      micRef.current=stream;recRef.current=recorder;
      const chunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      recorder.onerror=()=>{if(aliveRef.current)setAudioError("تعذّر تسجيل الصوت، جرب مرة ثانية.");};
      recorder.onstop=async()=>{
        clearTimeout(timerRef.current);stream.getTracks().forEach(t=>t.stop());recRef.current=null;micRef.current=null;
        if(!aliveRef.current)return;
        setRecording(false);
        const blob=new Blob(chunks,{type:recorder.mimeType.split(";")[0]||"audio/mp4"});
        if(blob.size<100)return;
        if(blob.size>450000){setAudioError("التسجيل طويل، جرّب أقل من 19 ثانية.");return;}
        try{const audioBase64=await toBase64(blob);if(aliveRef.current)send({audioBase64,audioMimeType:blob.type},"🎙️ رسالة صوتية");}
        catch(e){if(aliveRef.current)setAudioError(e.message);}
      };
      recorder.start(250);setRecording(true);timerRef.current=setTimeout(stopRecording,19000);
    }catch{stream?.getTracks().forEach(t=>t.stop());if(aliveRef.current)setAudioError("الميكروفون غير متاح. اسمح بالوصول إليه من إعدادات Safari، أو استخدم الشات.");}
  }
  function close(){try{window.speechSynthesis?.cancel();}catch{}onClose();}
  function cancelDraft(){
    if(sendingRef.current||recording)return;
    contextRef.current={mode:"",draft:{}};
    setMessages(v=>[...v,{role:"assistant",text:"تمام، لغينا المسودة من المحادثة. ما انحفظت ولا رحلة.",suggestions:starter}]);
  }
  const time=v=>new Date(v).toLocaleTimeString("ar-JO",{timeZone:"Asia/Amman",hour:"2-digit",minute:"2-digit"});
  const voiceAvailable=typeof window!=="undefined"&&"speechSynthesis" in window;
  return <div className="app"><div className="seago-assistant" dir="rtl">
    <header className="seago-assistant-header"><div><span className="seago-assistant-icon"><ShipWheel size={20}/></span><div><strong>مساعد SeaGo</strong><small>احكي معي، خطوة بخطوة</small></div></div><button type="button" onClick={close} aria-label="إغلاق المساعد"><X size={22}/></button></header>
    <div className="seago-assistant-messages" role="log" aria-live="polite" aria-label="محادثة مساعد المزود">
      {messages.map((m,i)=><div key={i} className={"seago-assistant-message "+m.role}>
        <p>{m.text}</p>
        {m.transcript&&<small>🎙️ سمعت: {m.transcript}</small>}
        {m.intent==="create_trip"&&<div className="seago-assistant-progress"><div><span>تجهيز الرحلة</span><strong>{m.progress} / {m.total}</strong></div><div className="seago-assistant-progress-track"><span style={{width:Math.round(100*m.progress/(m.total||4))+"%"}}/></div></div>}
        {m.rows?.length>0&&<div className="seago-assistant-departures">{m.rows.map((d,j)=><div key={j}><strong>{d.trip}</strong><small>{time(d.startsAt)} · {d.status==="scheduled"?"مجدولة":d.status}</small><span>مؤكد: {d.confirmedSeats} · متاح: {d.availableSeats} · السعة: {d.capacity}</span></div>)}</div>}
        {m.ready&&m.draft&&<button type="button" className="seago-assistant-draft-button" disabled={busy||recording} onClick={()=>onUseDraft(m.draft)}><CheckCircle2 size={17}/> افتح نموذج الرحلة للمراجعة <ArrowRight size={16}/></button>}
        {m.intent==="create_trip"&&!m.ready&&i===messages.length-1&&<button type="button" className="seago-assistant-cancel-draft" disabled={busy||recording} onClick={cancelDraft}>إلغاء مسودة الرحلة</button>}
        {m.role==="assistant"&&voiceAvailable&&<button type="button" className="seago-assistant-speak" aria-label="اقرأ رد المساعد بصوت عربي" onClick={()=>{if(!speakArabic(m.text))setAudioError("الصوت العربي غير متاح في هذا المتصفح.");}}><Volume2 size={15}/> اسمع الرد</button>}
      </div>)}
      {busy&&<p className="seago-assistant-thinking">عم بجهّز لك الرد…</p>}
      <div ref={scrollRef}/>
    </div>
    {chips.length>0&&<div className="seago-assistant-samples" aria-label="اقتراحات سريعة">{chips.map((s,i)=><button key={i} type="button" disabled={busy||recording} onClick={()=>sendText(s)}>{s}</button>)}</div>}
    <footer className="seago-assistant-footer">
      {error&&<div className="seago-assistant-error" role="alert">{error}</div>}
      {audioError&&<div className="seago-assistant-error" role="alert">{audioError}</div>}
      {recording&&<div className="seago-assistant-recording"><Headphones size={15}/> عم بسجّل صوتك… اضغط إيقاف للإرسال (19 ثانية كحد أقصى)</div>}
      <label className="seago-assistant-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> أوافق على إرسال كلامي النصي أو الصوتي إلى Google لفهم الطلب. لن أشارك بيانات شخصية للعملاء.</label>
      <form onSubmit={e=>{e.preventDefault();sendText();}}>
        <button type="button" disabled={busy} onClick={recording?stopRecording:startRecording} aria-label={recording?"أوقف وأرسل التسجيل":"سجّل رسالة صوتية"} className={"seago-assistant-mic "+(recording?"recording":"")}>{recording?<Square size={20}/>:<Mic size={20}/>}</button>
        <input aria-label="رسالتك" disabled={busy||recording} value={input} maxLength={1500} placeholder="احكيلي شو بدك تعمل…" onChange={e=>setInput(e.target.value)}/>
        <button type="submit" disabled={busy||recording||!input.trim()} aria-label="إرسال"><Send size={20}/></button>
      </form>
      <small>ما بتم حفظ أي رحلة من المحادثة وحدها. راجع النموذج واضغط حفظ بنفسك. الصوت المقروء اختياري ويستخدم صوت الجهاز إذا كان متاحاً.</small>
    </footer>
  </div></div>;
}