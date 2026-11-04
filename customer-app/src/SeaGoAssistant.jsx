import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, CalendarDays, ChevronRight, Compass, LifeBuoy, LoaderCircle, Send, Ship, Sparkles, Sun, Ticket, UsersRound, Wallet, Waves, X } from "lucide-react";
import { answerSeaGoQuestion, ASSISTANT_STARTERS } from "./seagoAssistantEngine.js";

const GREETING = {
  id:"welcome",who:"assistant",
  text:"Hey! 👋 Welcome to Aqaba SeaGo. I'm your Red Sea trip guide. Tell me your budget, group size, or the kind of experience you're looking for.",
  cards:[],action:null
};

function formatDate(value) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Amman",weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(date);
}

export default function SeaGoAssistant({ trips, fetchDepartures, hasLiveApi, onOpenTrip, onNavigate, placement="floating" }) {
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState("");
  const [messages,setMessages]=useState([GREETING]);
  const [busy,setBusy]=useState(false);
  const [keyboardLayout,setKeyboardLayout]=useState(null);
  const count=useRef(0);
  const scrollEnd=useRef(null);
  const launcher=useRef(null);
  const dialog=useRef(null);
  const closeButton=useRef(null);
  const mounted=useRef(true);

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(open&&messages.length>1)scrollEnd.current?.scrollIntoView({behavior:"auto",block:"end"});},[messages,open,busy]);

  useEffect(()=>{
    if(!open||!window.visualViewport)return;
    const viewport=window.visualViewport;
    const measure=()=>{
      const occluded=Math.max(0,Math.round(window.innerHeight-viewport.height-viewport.offsetTop));
      setKeyboardLayout(occluded>130 ? {
        bottom:occluded+8,
        height:Math.max(230,Math.floor(viewport.height-20))
      }:null);
    };
    viewport.addEventListener("resize",measure);
    viewport.addEventListener("scroll",measure);
    measure();
    return()=>{
      viewport.removeEventListener("resize",measure);
      viewport.removeEventListener("scroll",measure);
      setKeyboardLayout(null);
    };
  },[open]);

  useEffect(()=>{
    if(!open)return;
    closeButton.current?.focus({preventScroll:true});
    const onKeyDown=event=>{
      if(event.key==="Escape"){event.preventDefault();setOpen(false);requestAnimationFrame(()=>launcher.current?.focus({preventScroll:true}));return;}
      if(event.key!=="Tab"||!dialog.current)return;
      const options=[...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(node=>node.offsetParent!==null);
      if(!options.length)return;
      const first=options[0],last=options[options.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",onKeyDown);
    return()=>document.removeEventListener("keydown",onKeyDown);
  },[open]);

  function close() {
    setOpen(false);
    // Open/close does not persist messages to storage or send chat text to a model.
    requestAnimationFrame(()=>launcher.current?.focus({preventScroll:true}));
  }

  async function send(value) {
    const content=String(value||"").trim().slice(0,500);
    if(!content||busy)return;
    count.current++;
    const key=count.current;
    setDraft("");
    setBusy(true);
    setMessages(rows=>[...rows,{id:`user-${key}`,who:"user",text:content}]);
    try {
      const response=await answerSeaGoQuestion(content,trips,{
        listDepartures:fetchDepartures,
        hasLiveApi,
        now:new Date()
      });
      if(mounted.current)setMessages(rows=>[...rows,{
        id:`assistant-${key}`,who:"assistant",text:response.text,
        cards:response.cards||[],action:response.action
      }]);
    } catch {
      if(mounted.current)setMessages(rows=>[...rows,{
        id:`assistant-${key}`,who:"assistant",
        text:"I couldn't check SeaGo's trip data right now. Please try again or open the trips list.",
        cards:[],action:{type:"trips",label:"Explore Trips"}
      }]);
    } finally {if(mounted.current)setBusy(false);}
  }

  function openTripById(id) {
    const trip=(trips||[]).find(item=>String(item.id)===String(id));
    if(!trip||!trip.apiId)return;
    close();
    onOpenTrip?.(trip);
  }
  function followAction(action) {
    const destinations=["tickets","support","trips"];
    if(!action||!destinations.includes(action.type))return;
    close();
    onNavigate?.(action.type);
  }

  return (
    <>
      {!open&&<button ref={launcher} type="button"
        className={`seago-assistant-launcher seago-assistant-launcher--${placement}`}
        onClick={()=>setOpen(true)} title="Ask SeaGo about trips"
        aria-label="Open SeaGo Assistant" aria-haspopup="dialog" aria-expanded={false}>
        <Bot size={23} strokeWidth={2} aria-hidden="true"/>
        <span className="seago-assistant-launcher__status" aria-hidden="true"/>
      </button>}
      {open&&createPortal(<>
        <button type="button" className="seago-assistant-backdrop" aria-label="Close SeaGo Assistant" onClick={close}/>
        <section ref={dialog} className="seago-assistant-panel" role="dialog" aria-modal="true" aria-labelledby="seago-assistant-title"
          style={keyboardLayout?{bottom:`${keyboardLayout.bottom}px`,height:`min(650px, ${keyboardLayout.height}px)`}:undefined}>
          <header className="seago-assistant-header">
            <span className="seago-assistant-avatar"><Bot size={23}/></span>
            <div className="seago-assistant-identity">
              <h2 id="seago-assistant-title">SeaGo Assistant</h2>
              <span>Your personal Red Sea trip guide</span>
            </div>
            <span className="seago-assistant-header-tag">AQABA</span>
            <button ref={closeButton} type="button" className="seago-assistant-close" aria-label="Close assistant" onClick={close}><X size={19}/></button>
          </header>
          <div className="seago-assistant-messages" role="log" aria-label="SeaGo Assistant messages" aria-live="polite" aria-relevant="additions">
            {messages.length===1 ? (
              <div className="seago-assistant-welcome">
                <div className="seago-assistant-welcome-hero">
                  <div className="seago-assistant-welcome-kicker"><Sparkles size={13}/> YOUR RED SEA CONCIERGE</div>
                  <h3>Where to <em>next?</em></h3>
                  <p>Tell me your vibe, budget, or group size. I’ll help you find your kind of sea day.</p>
                  <Waves className="seago-assistant-welcome-waves" size={105} strokeWidth={0.9} aria-hidden="true"/>
                </div>
                <div className="seago-assistant-section-label">
                  <strong>Start exploring</strong>
                  <span>Choose what sounds good</span>
                </div>
                <div className="seago-assistant-shortcut-grid">
                  <button type="button" onClick={()=>void send(ASSISTANT_STARTERS[0])} disabled={busy}>
                    <span className="seago-assistant-shortcut-icon seago-assistant-shortcut-icon--sun"><Sun size={19}/></span>
                    <strong>Chase the sunset</strong><small>Evening cruises</small>
                    <ChevronRight size={15} className="seago-assistant-shortcut-arrow"/>
                  </button>
                  <button type="button" onClick={()=>void send(ASSISTANT_STARTERS[1])} disabled={busy}>
                    <span className="seago-assistant-shortcut-icon seago-assistant-shortcut-icon--crew"><UsersRound size={19}/></span>
                    <strong>For your crew</strong><small>Trips for two</small>
                    <ChevronRight size={15} className="seago-assistant-shortcut-arrow"/>
                  </button>
                  <button type="button" onClick={()=>void send(ASSISTANT_STARTERS[2])} disabled={busy}>
                    <span className="seago-assistant-shortcut-icon seago-assistant-shortcut-icon--budget"><Wallet size={19}/></span>
                    <strong>On a budget</strong><small>Under 30 JOD</small>
                    <ChevronRight size={15} className="seago-assistant-shortcut-arrow"/>
                  </button>
                  <button type="button" onClick={()=>void send(ASSISTANT_STARTERS[3])} disabled={busy}>
                    <span className="seago-assistant-shortcut-icon seago-assistant-shortcut-icon--tickets"><Ticket size={19}/></span>
                    <strong>My tickets</strong><small>QR & booking help</small>
                    <ChevronRight size={15} className="seago-assistant-shortcut-arrow"/>
                  </button>
                </div>
                <button type="button" className="seago-assistant-help-link" onClick={()=>void send(ASSISTANT_STARTERS[4])} disabled={busy}>
                  <LifeBuoy size={18}/> Questions about cancellations? <ChevronRight size={16}/>
                </button>
                <p className="seago-assistant-live-note"><Compass size={14}/> {hasLiveApi?"Recommendations use published SeaGo trips and confirmed departures.":"Live trip information is currently unavailable. I can still explain how SeaGo works."}</p>
              </div>
            ) : (
              <div className="seago-assistant-thread">
                <div className="seago-assistant-thread-heading"><Sparkles size={14}/> SEA GO GUIDE <span>· Your conversation</span></div>
                {messages.slice(1).map(message=><div key={message.id}
                  className={message.who==="user"?"seago-assistant-message seago-assistant-message--user":"seago-assistant-message seago-assistant-message--bot"}>
                  {message.who==="assistant"&&<span className="seago-assistant-message-icon"><Bot size={15}/></span>}
                  <div className="seago-assistant-message-content">
                    <p>{message.text}</p>
                    {message.cards?.length>0&&<div className="seago-assistant-trip-results">
                      {message.cards.map(card=><button key={card.tripId} type="button" className="seago-assistant-trip-card"
                        onClick={()=>openTripById(card.tripId)} aria-label={`View details for ${card.title}`}>
                        <span className="seago-assistant-trip-icon"><Ship size={20}/></span>
                        <span className="seago-assistant-trip-copy">
                          <strong>{card.title}</strong>
                          {Number.isFinite(card.price)&&card.price>0&&<small>From {card.price} JOD / adult</small>}
                          <small className="seago-assistant-trip-availability"><CalendarDays size={12}/>{formatDate(card.availability)||card.availability||"Check trip details"}</small>
                        </span>
                        <ChevronRight size={17}/>
                      </button>)}
                    </div>}
                    {message.action&&<button type="button" className="seago-assistant-action" onClick={()=>followAction(message.action)}>
                      {message.action.label}<ChevronRight size={15}/>
                    </button>}
                  </div>
                </div>)}
              </div>
            )}
            {busy&&<div className="seago-assistant-thinking" role="status"><LoaderCircle className="spin" size={15}/> Checking SeaGo trips...</div>}
            <div ref={scrollEnd}/>
          </div>
          <div className="seago-assistant-footer">
            <form className="seago-assistant-form" onSubmit={e=>{e.preventDefault();void send(draft);}}>
              <label htmlFor="seago-assistant-input" className="seago-assistant-visually-hidden">Message SeaGo Assistant</label>
              <Sparkles className="seago-assistant-input-sparkle" size={17} aria-hidden="true"/>
              <input id="seago-assistant-input" type="text" value={draft} onChange={e=>setDraft(e.target.value)}
                autoComplete="off" enterKeyHint="send" maxLength={500} placeholder="Ask about trips, dates, prices…" disabled={busy}/>
              <button type="submit" disabled={busy||!draft.trim()} aria-label="Send message"><Send size={17}/></button>
            </form>
            <span className="seago-assistant-disclaimer">Live trip info · Secure checkout in SeaGo</span>
          </div>
        </section>
      </>,document.body)}
    </>
  );
}
