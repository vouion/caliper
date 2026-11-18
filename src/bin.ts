#!/usr/bin/env node
/**
 * Version-guarded entry point. On Node < 22.13 the static `node:sqlite`
 * import would throw a raw module-load error; give users a clear message
 * instead. The real CLI is loaded dynamically only after the check passes.
 */
const [majorRaw, minorRaw] = process.versions.node.split('.');
const major = Number(majorRaw);
const minor = Number(minorRaw);
if (!(major > 22 || (major === 22 && minor >= 13))) {
  process.stderr.write(
    `caliper requires Node.js >= 22.13 (found v${process.versions.node}).\n` +
      'The built-in node:sqlite module is unavailable on older versions.\n' +
      'Upgrade Node.js: https://nodejs.org/\n',
  );
  process.exit(1);
}
await import('./cli.ts');
