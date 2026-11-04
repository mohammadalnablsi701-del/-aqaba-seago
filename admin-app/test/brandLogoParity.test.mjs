import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Admin in-app mark is the approved Direction A admin icon",()=>{
 const source=read("src/App.jsx"),icon=read("public/app-admin.svg"),favicon=read("public/admin-favicon-a-v1.svg");
 assert.equal(icon,favicon,"The in-app mark must match the launcher icon exactly");
 assert.match(icon,/id="helm"/);
 assert.match(source,/src={`\$\{import\.meta\.env\.BASE_URL\}app-admin\.svg`}/);
 assert.match(source,/alt="SeaGo Admin logo"/);
 assert.match(source,/AQABA · ADMIN/);
 assert.doesNotMatch(source,/<svg className="admin-brand-mark"/);
});

test("Admin brand and bootstrap are safe on mobile and when JavaScript fails",()=>{
 const html=read("index.html"),css=read("src/styles.css");
 assert.match(html,/<div id="root"><\/div><div id="seago-boot-recovery"/);
 assert.match(html,/#root:not\(:empty\)\+#seago-boot-recovery\{display:none\}/);
 assert.match(html,/src="\.\/app-admin\.svg"/);
 assert.match(html,/>Reload App<\/a>/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(css,/\.admin-brand \.admin-brand-mark\{[^}]*object-fit:contain/);
});

test("Admin mounts the login even if a standalone preview has no version.json",()=>{
 const src=read("src/main.jsx");
 assert.doesNotMatch(src,/if\(!r\.ok\)return;/);
 assert.doesNotMatch(src,/if\(!commit\)return;/);
 assert.match(src,/if\(!r\.ok\)throw new Error/);
 assert.match(src,/createRoot\(document\.getElementById\("root"\)\)\.render/);
});
