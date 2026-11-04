import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../"+path, import.meta.url), "utf8");

test("home assistant launcher sits beside menu, never over the search card", () => {
  const app=read("src/App.jsx");
  assert.match(app, /className="hero__top-actions"/);
  assert.match(app, /<SeaGoAssistant \{\.\.\.assistantProps\} placement="header"\/>/);
  assert.match(app, /active!=="home"&&<SeaGoAssistant \{\.\.\.assistantProps\} placement="floating"\/>/);
  assert.match(app, /assistantProps=\{assistantProps\}/);
});

test("compact button has accessible name, icon, and full-screen un-clipped dialog", () => {
  const jsx=read("src/SeaGoAssistant.jsx");
  const css=read("src/seagoAssistant.css");
  assert.match(jsx, /aria-label="Open SeaGo Assistant"/);
  assert.match(jsx, /<Bot size=\{23\}/);
  assert.doesNotMatch(jsx, /<span>Ask SeaGo<\/span>/);
  assert.match(jsx, /createPortal\(<\>/);
  assert.match(jsx, /document\.body\)/);
  assert.match(css, /\.seago-assistant-launcher--header\{position:relative/);
  assert.match(css, /\.seago-assistant-launcher--floating\{position:fixed/);
  assert.match(css, /\.hero__top-actions\{display:flex/);
  assert.match(css, /width:50px;height:50px/);
});

test("assistant tickets and support navigation clear selected trip details",()=>{
 const app=read("src/App.jsx");
 assert.match(app,/const navigateFromAssistant=target=>\{/);
 assert.match(app,/setDetail\(null\);[\s\S]*?setBooking\(false\);[\s\S]*?setActive\(target\);/);
 assert.match(app,/onOpenTrip:openTrip,onNavigate:navigateFromAssistant/);
});

test("chat preserves date and party composition through details into booking",()=>{
 const app=read("src/App.jsx");
 const jsx=read("src/SeaGoAssistant.jsx");
 assert.ok(app.includes("const openTripFromAssistant=(trip,criteria)=>"));
 assert.ok(app.includes("onOpenTrip:openTripFromAssistant"));
 assert.ok(app.includes("initialCriteria?.adults??initialCriteria?.guests??2"));
 assert.ok(app.includes("initialCriteria?.children??0"));
 assert.ok(jsx.includes("onOpenTrip?.(trip,card?.criteria||null)"));
});
