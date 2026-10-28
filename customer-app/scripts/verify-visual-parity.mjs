import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv){
  const values={};
  for(const arg of argv){
    if(!arg.startsWith("--"))continue;
    const [key,...rest]=arg.slice(2).split("=");
    values[key]=rest.join("=");
  }
  return values;
}

const args=parseArgs(process.argv.slice(2));
const distDir=path.resolve(process.cwd(),args.dist||"dist");
const webDir=args.web?path.resolve(process.cwd(),args.web):null;
const label=String(args.label||"Customer visual parity");

function fail(message){
  console.error(`Visual parity verification failed (${label}): ${message}`);
  process.exit(1);
}

function sha256(file){
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function collectText(dir){
  const files=[];
  function walk(current){
    for(const entry of fs.readdirSync(current,{withFileTypes:true})){
      const full=path.join(current,entry.name);
      if(entry.isDirectory())walk(full);
      else if(/\.(?:html|js|css|json|webmanifest|svg|txt)$/i.test(entry.name))files.push(full);
    }
  }
  walk(dir);
  return {files,text:files.map((file)=>fs.readFileSync(file,"utf8")).join("\n")};
}

function verifyArtifact(dir,name){
  if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())fail(`${name} directory is missing: ${dir}`);
  const hero=path.join(dir,"aqaba-hero.jpg");
  if(!fs.existsSync(hero)||fs.statSync(hero).size===0)fail(`${name} is missing local aqaba-hero.jpg`);

  const {files,text}=collectText(dir);
  const css=files.filter((file)=>file.endsWith(".css")).map((file)=>fs.readFileSync(file,"utf8")).join("\n");
  for(const token of ["Trip Type","Date","Persons","Search Trips","Home","Trips","Tickets","Alerts","Profile","aqaba-hero.jpg","Use your email and password to continue securely"]){
    if(!text.includes(token))fail(`${name} is missing critical shared UI token: ${token}`);
  }
  if(text.includes("--seago-native-hero-image"))fail(`${name} still contains the old Android-only hero implementation`);

  const authoritative=css.lastIndexOf("background-image:var(--seago-hero-image)!important");
  if(authoritative<0)fail(`${name} is missing the shared authoritative hero rule`);
  const legacy=Math.max(css.lastIndexOf("/-aqaba-seago/aqaba-hero.jpg"),css.lastIndexOf("commons.wikimedia.org"));
  if(legacy>=0&&authoritative<=legacy)fail(`${name} legacy hero fallback can override the shared local hero`);
  if(!css.includes("content:attr(data-seago-date-display)"))fail(`${name} is missing deterministic visible date rendering`);
  if(!/\.search-row--date input\[type=(?:"date"|date)\][^{]*\{[^}]*opacity:0/.test(css)){
    fail(`${name} does not hide browser/WebView native date text`);
  }

  return {heroHash:sha256(hero),css};
}

const target=verifyArtifact(distDir,"target artifact");
if(webDir){
  const web=verifyArtifact(webDir,"Customer Web production artifact");
  if(web.heroHash!==target.heroHash)fail("Web and Android do not contain identical aqaba-hero.jpg bytes");
  if(web.css!==target.css)fail("Web and Android production CSS bundles differ");
}

console.log(`Visual parity verification passed (${label})`);
console.log(`Artifact: ${distDir}`);
console.log(`Hero SHA-256: ${target.heroHash}`);
if(webDir)console.log(`Compared with Web production artifact: ${webDir}`);
