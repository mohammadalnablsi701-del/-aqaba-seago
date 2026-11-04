import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("SeaGo Assistant opens with visual welcome, trip shortcuts and no large empty composer area",()=>{
 const jsx=read("src/SeaGoAssistant.jsx");
 assert.ok(jsx.includes('className="seago-assistant-welcome-hero"'));
 assert.ok(jsx.includes('className="seago-assistant-shortcut-grid"'));
 assert.ok(jsx.includes('className="seago-assistant-help-link"'));
 assert.ok(jsx.includes('messages.length===1 ?'));
 const messages=jsx.indexOf('className="seago-assistant-messages"');
 const grid=jsx.indexOf('className="seago-assistant-shortcut-grid"');
 const footer=jsx.indexOf('className="seago-assistant-footer"');
 assert.ok(messages>=0 && messages<grid && grid<footer,"shortcuts belong in scrollable conversation, not footer");
 assert.ok(jsx.includes("messages.slice(1).map"),"conversation should replace welcome after first prompt");
 assert.ok(jsx.includes('className="seago-assistant-shortcut-icon--sun"')||
  jsx.includes('seago-assistant-shortcut-icon--sun'));
});

test("accessible chat input label is truly visually hidden and input layout cannot collide",()=>{
 const jsx=read("src/SeaGoAssistant.jsx");
 const css=read("src/seagoAssistant.css");
 assert.match(jsx,/className="seago-assistant-visually-hidden"/);
 assert.match(css,/\.seago-assistant-visually-hidden\{position:absolute!important/);
 assert.match(css,/\.seago-assistant-form input\{[^}]*min-width:0/);
 assert.match(css,/\.seago-assistant-form>button\{flex:0 0 auto/);
 assert.ok(!jsx.includes('className="sr-only"'));
 assert.match(jsx,/enterKeyHint="send"/);
});

test("mobile iOS keyboard is handled without leaking a background chat window",()=>{
 const jsx=read("src/SeaGoAssistant.jsx");
 assert.match(jsx,/window\.visualViewport/);
 assert.match(jsx,/viewport\.addEventListener\("resize",measure\)/);
 assert.match(jsx,/keyboardLayout\?\{bottom:/);
 assert.match(jsx,/createPortal\(<\>/);
 assert.ok(jsx.includes("if(open&&messages.length>1)"),"welcome must not auto-scroll to blank bottom");
});
