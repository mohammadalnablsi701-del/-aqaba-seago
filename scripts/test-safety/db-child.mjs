import { pathToFileURL } from 'node:url';
import { initializeFixture } from './fixture.mjs';
try {
  await initializeFixture();
  console.log('Disposable fixture verified: runner authority, unique owned database, reserved-name guard, scrubbed environment');
  await import(pathToFileURL(process.argv[2]).href);
} catch {
  console.error('Disposable database child rejected or failed');
  process.exitCode = 1;
}
