import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const read=relative=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8');

test('provider access UI is React-owned, ID-targeted and environment-scoped',()=>{
  const main=read('admin-app/src/main.jsx');
  const app=read('admin-app/src/App.jsx');
  const manager=read('admin-app/src/ProviderAccessManager.jsx');
  const api=read('admin-app/src/api.js');
  const accessSurface=[main,app,manager,api].join('\n');

  assert.doesNotMatch(accessSurface,/https:\/\/aqaba-seago-api\.onrender\.com/,'Provider access UI must not hardcode Production API');
  assert.doesNotMatch(main,/MutationObserver|querySelector|querySelectorAll|provider-access-host/,'main.jsx must not inject provider access controls through the DOM');
  assert.equal(existsSync(new URL('../admin-app/src/ProviderAccessPortal.jsx',import.meta.url)),false,'Legacy DOM provider access portal must remain removed');
  assert.match(app,/ProviderAccessManager provider=\{p\} token=\{token\} onSaved=\{onSaved\}/,'Provider row must render Manage Access with the provider object it already owns');
  assert.match(manager,/setProviderAccess\(token,provider\._id,/,'Manage Access must target provider._id');
  assert.match(api,/VITE_API_BASE_URL/,'Admin API client must use the environment API base');
  assert.match(api,/providers\/"\+id\+"\/access/,'Provider access API path must be parameterized by ID');
});
