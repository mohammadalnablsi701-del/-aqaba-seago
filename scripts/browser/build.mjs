import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error('Disposable browser artifacts require Node 22 or newer');
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'node_modules/.cache/phase2c-browser');

for (const [app, base, directory] of [
  ['customer-app', '/customer/', 'customer'],
  ['provider-app', '/provider/', 'provider']
]) {
  const appRoot = join(root, app);
  const { build } = await import(pathToFileURL(join(appRoot, 'node_modules/vite/dist/node/index.js')).href);
  await build({
    root: appRoot,
    configFile: join(appRoot, 'vite.config.js'),
    // This artifact is usable only with the local disposable API harness.
    // Never read an application's .env or inherit its hosted build target.
    envDir: false,
    base,
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/__local_api')
    },
    build: {
      outDir: join(output, directory),
      emptyOutDir: true
    }
  });
}
