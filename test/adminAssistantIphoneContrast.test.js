import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const css=readFileSync(new URL("../admin-app/src/styles.css",import.meta.url),"utf8");
const panel=readFileSync(new URL("../admin-app/src/AssistantQualityPanel.jsx",import.meta.url),"utf8");
function colorRule(selector){
  const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const matches=[...css.matchAll(new RegExp(escape(selector)+"\\s*\\{([^}]*)\\}","g"))];
  assert.ok(matches.length,"CSS rule missing: "+selector);
  const declaration=matches.at(-1)[1];
  const match=declaration.match(/(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})\s*(?:;|$)/);
  assert.ok(match,"Explicit text color missing for: "+selector);
  return match[1].toLowerCase();
}
function luminance(hex){
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const mapped=rgb.map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*mapped[0]+0.7152*mapped[1]+0.0722*mapped[2];
}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
test("iPhone AI Monitoring heading has WCAG AA contrast against SeaGo navy",()=>{
  assert.ok(contrast(colorRule(".assistant-quality>.title h1"),"#071f33")>=4.5);
  assert.ok(contrast(colorRule(".assistant-quality>.title p"),"#071f33")>=4.5);
  assert.ok(contrast(colorRule(".assistant-quality>.title small"),"#071f33")>=4.5);
  assert.match(css,/\.assistant-quality>\.title h1\s*\{[^}]*font-size:clamp\(/);
});
test("AI Monitoring zero-state explains restart semantics, without inventing failures",()=>{
  assert.match(panel,/snapshot\.totalRequests===0/);
  assert.match(panel,/counters reset on server restart/);
  assert.match(panel,/role="status"/);
  assert.doesNotMatch(panel,/recording customer data|store transcripts/i);
});
test("Mobile admin navigation remains horizontally swipeable",()=>{
  assert.match(css,/\.admin-tabs\{scroll-padding-inline:12px;overscroll-behavior-x:contain;touch-action:pan-x\}/);
});
