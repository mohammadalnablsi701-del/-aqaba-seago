import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("in-app brand uses the approved Direction A launcher icon, not the retired helm",()=>{
  const brand=read("src/BrandLogo.jsx");
  const icon=read("public/app-customer.svg");
  const favicon=read("public/customer-favicon-a-v1.svg");
  assert.equal(icon,favicon,"Brand logo and Customer favicon must use the same approved emblem");
  assert.match(icon,/id="helm"/);
  assert.match(icon,/id="wave"/);
  assert.match(brand,/import\.meta\.env\.BASE_URL\}app-customer\.svg/,"Icon must resolve under Render and GitHub Pages base paths");
  assert.match(brand,/alt="Aqaba SeaGo logo"/);
  assert.doesNotMatch(brand,/<svg className="brand__mark"/);
  assert.match(brand,/<strong>SeaGo<\/strong>/);
  assert.match(brand,/<span>AQABA<\/span>/);
});

test("full-size and compact brand marks both retain the approved icon background",()=>{
  const css=read("src/styles.css");
  assert.match(css,/\.brand \.brand__mark\{[^}]*object-fit:contain/);
  assert.match(css,/\.brand \.brand__mark\{[^}]*background:#FAF7F0/);
  assert.match(css,/\.brand--compact \.brand__mark\{border-radius:11px\}/);
});
