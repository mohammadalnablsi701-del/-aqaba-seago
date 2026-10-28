import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatCustomerDate, syncCustomerDateInput } from "../customer-app/src/homeParity.js";

const app=fs.readFileSync(new URL("../customer-app/src/App.jsx",import.meta.url),"utf8");
const main=fs.readFileSync(new URL("../customer-app/src/main.jsx",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../customer-app/src/customer-parity.css",import.meta.url),"utf8");

function classListFixture(){
  const values=new Set();
  return {
    contains:(value)=>values.has(value),
    add:(value)=>values.add(value),
    has:(value)=>values.has(value)
  };
}

test("canonical date has deterministic customer-visible format",()=>{
  assert.equal(formatCustomerDate("2026-10-12"),"12 Oct 2026");
  assert.equal(formatCustomerDate("2026-02-29"),"");
  assert.equal(formatCustomerDate("not-a-date"),"");
});

test("date display adapter never rewrites the canonical search value and converges",()=>{
  const valueHost={dataset:{}};
  const row={classList:classListFixture()};
  const input={
    value:"2026-10-12",
    parentElement:valueHost,
    closest:()=>row
  };

  assert.equal(syncCustomerDateInput(input),2);
  assert.equal(input.value,"2026-10-12");
  assert.equal(valueHost.dataset.seagoDateDisplay,"12 Oct 2026");
  assert.equal(row.classList.has("search-row--date"),true);
  assert.equal(syncCustomerDateInput(input),0,"stable date presentation must not create repeat DOM writes");

  input.value="2026-11-03";
  assert.equal(syncCustomerDateInput(input),1);
  assert.equal(input.value,"2026-11-03");
  assert.equal(valueHost.dataset.seagoDateDisplay,"3 Nov 2026");
});

test("native date text is hidden while the original picker/min/onChange semantics stay in HomeScreen",()=>{
  assert.match(app,/function HomeScreen\(/);
  assert.doesNotMatch(app,/NativeHomeScreen/);
  assert.match(app,/type="date"\s+value=\{date\}\s+min=\{localDateInputValue\(\)\}\s+onChange=\{e=>setDate\(e\.target\.value\)\}/);
  assert.match(css,/content:attr\(data-seago-date-display\)/);
  assert.match(css,/\.search-row--date input\[type="date"\][\s\S]*opacity:0/);
  assert.match(main,/enableCustomerHomeParity\(\)/);
});

test("critical Home UI and bottom navigation remain in the single shared App tree",()=>{
  for(const label of ["Trip Type","Date","Persons","Search Trips","Home","Trips","Tickets","Alerts","Profile"]){
    assert.ok(app.includes(label),`shared App must contain ${label}`);
  }
  assert.match(app,/\["home",Home,"Home"\].*\["trips",ShipWheel,"Trips"\].*\["tickets",Ticket,"Tickets"\].*\["notifications",Bell,"Alerts"\].*\["profile",UserRound,"Profile"\]/s);
  assert.doesNotMatch(main,/nativeApp\s*\?\s*<NativeHomeScreen/);
});
