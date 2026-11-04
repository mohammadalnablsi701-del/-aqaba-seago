import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const argument = process.argv.find(value => value.startsWith("--out="));
if (!argument) throw new Error("Usage: node scripts/assemble-pages-preview.mjs --out=<new directory outside repository>");
const output = path.resolve(argument.slice("--out=".length));
const relative = path.relative(root, output);
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
  throw new Error("Preview output must be outside the repository to avoid recursive copying");
}
if (fs.existsSync(output)) throw new Error(`Preview output must be a new directory: ${output}`);
const apps = [
  ["customer", ""],
  ["provider", "provider"],
  ["admin", "admin"],
];
for (const [role] of apps) {
  if (!fs.existsSync(path.join(root, `${role}-app/dist/index.html`))) {
    throw new Error(`Build ${role}-app before assembling the preview`);
  }
}
for (const [role, subdirectory] of apps) {
  const destination = path.join(output, subdirectory);
  if (subdirectory && fs.existsSync(destination)) {
    throw new Error(`Customer artifact unexpectedly occupies ${subdirectory}/`);
  }
  fs.cpSync(path.join(root, `${role}-app/dist`), destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}
if (process.env.GITHUB_SHA) {
  fs.writeFileSync(path.join(output, "version.json"), JSON.stringify({
    commit: process.env.GITHUB_SHA,
    builtAt: new Date().toISOString(),
  }) + "\n");
}
console.log(`Assembled Pages preview: ${output}`);
