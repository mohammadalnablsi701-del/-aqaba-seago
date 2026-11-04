import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Provider in-app mark is the approved Direction A provider icon",()=>{
 const source=read("src/App.jsx"),icon=read("public/app-provider.svg"),favicon=read("public/provider-favicon-a-v1.svg");
 assert.equal(icon,favicon,"The in-app mark must match the launcher icon exactly");
 assert.match(icon,/id="helm"/);
 assert.match(source,/src={`\$\{import\.meta\.env\.BASE_URL\}app-provider\.svg`}/);
 assert.match(source,/alt="SeaGo Provider logo"/);
 assert.match(source,/AQABA · PROVIDER/);
 assert.doesNotMatch(source,/<svg className="provider-brand-mark"/);
});

test("Provider brand and bootstrap are safe on mobile and when JavaScript fails",()=>{
 const html=read("index.html"),css=read("src/styles.css");
 assert.match(html,/<div id="root"><\/div><div id="seago-boot-recovery"/);
 assert.match(html,/#root:not\(:empty\)\+#seago-boot-recovery\{display:none\}/);
 assert.match(html,/src="\.\/app-provider\.svg"/);
 assert.match(html,/>Reload App<\/a>/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(css,/\.provider-brand \.provider-brand-mark\{[^}]*object-fit:contain/);
});
