import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, CalendarDays, ChevronRight, LoaderCircle, Send, Ship, X } from "lucide-react";
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
  const count=useRef(0);
  const scrollEnd=useRef(null);
  const launcher=useRef(null);
  const dialog=useRef(null);
  const closeButton=useRef(null);
  const mounted=useRef(true);

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(open)scrollEnd.current?.scrollIntoView({behavior:"auto",block:"end"});},[messages,open,busy]);

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
        <section ref={dialog} className="seago-assistant-panel" role="dialog" aria-modal="true" aria-labelledby="seago-assistant-title">
          <header className="seago-assistant-header">
            <span className="seago-assistant-avatar"><Bot size={23}/></span>
            <div className="seago-assistant-identity">
              <h2 id="seago-assistant-title">SeaGo Assistant</h2>
              <span><i/> Your Red Sea trip guide</span>
            </div>
            <button ref={closeButton} type="button" className="seago-assistant-close" aria-label="Close assistant" onClick={close}><X size={20}/></button>
          </header>
          <p className="seago-assistant-safety">Trip prices and dates come from SeaGo operators. Final availability is checked when you book.</p>
          <div className="seago-assistant-messages" role="log" aria-label="SeaGo Assistant messages" aria-live="polite" aria-relevant="additions">
            {messages.map(message=><div key={message.id}
              className={message.who==="user"?"seago-assistant-message seago-assistant-message--user":"seago-assistant-message seago-assistant-message--bot"}>
              {message.who==="assistant"&&<span className="seago-assistant-message-icon"><Bot size={14}/></span>}
              <div className="seago-assistant-message-content">
                <p>{message.text}</p>
                {message.cards?.length>0&&<div className="seago-assistant-trip-results">
                  {message.cards.map(card=><button key={card.tripId} type="button" className="seago-assistant-trip-card"
                    onClick={()=>openTripById(card.tripId)} aria-label={`View details for ${card.title}`}>
                    <span className="seago-assistant-trip-icon"><Ship size={19}/></span>
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
            {busy&&<div className="seago-assistant-thinking" role="status"><LoaderCircle className="spin" size={15}/> Checking SeaGo trips...</div>}
            <div ref={scrollEnd}/>
          </div>
          <div className="seago-assistant-footer">
            {messages.length===1&&<div className="seago-assistant-suggestions" aria-label="Suggested questions">
              {ASSISTANT_STARTERS.map(label=><button key={label} type="button" disabled={busy} onClick={()=>void send(label)}>{label}</button>)}
            </div>}
            <form className="seago-assistant-form" onSubmit={e=>{e.preventDefault();void send(draft);}}>
              <label htmlFor="seago-assistant-input" className="sr-only">Message SeaGo Assistant</label>
              <input id="seago-assistant-input" type="text" value={draft} onChange={e=>setDraft(e.target.value)}
                autoComplete="off" maxLength={500} placeholder="Ask SeaGo anything..." disabled={busy}/>
              <button type="submit" disabled={busy||!draft.trim()} aria-label="Send message"><Send size={18}/></button>
            </form>
            <span className="seago-assistant-disclaimer">Booking and payment happen through the official SeaGo checkout.</span>
          </div>
        </section>
      </>,document.body)}
    </>
  );
}
