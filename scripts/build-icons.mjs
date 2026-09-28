// Copies brand logos from Simple Icons (CC0) into scripts/icons.json, keyed by slug.
// Run it only when the stack in render.mjs needs a logo that is not there yet:
//
//   npm install --no-save simple-icons
//   node scripts/build-icons.mjs nextdotjs react typescript ...

import { writeFileSync } from 'node:fs';
import * as icons from 'simple-icons';

const out = {};
for (const slug of process.argv.slice(2)) {
  const icon = icons[`si${slug[0].toUpperCase()}${slug.slice(1)}`];
  if (!icon) throw new Error(`Simple Icons has no "${slug}"`);
  out[slug] = { title: icon.title, hex: icon.hex, path: icon.path };
}
writeFileSync(new URL('./icons.json', import.meta.url), JSON.stringify(out));
console.log(`wrote scripts/icons.json (${Object.keys(out).length} icons)`);
