/* Prints every .rpc( call in the repo as a SQL VALUES list, so the live check
   in check-rpc-live.sql is built from the code rather than from memory.

   Usage:  node tests/list-call-sites.js
   Then paste the output into the call(...) list in check-rpc-live.sql and run
   that against the project. Every row must say "resolves". */
'use strict';
const path = require('path');
const { rpcCallSites } = require('./call-sites');
const rows = rpcCallSites(path.resolve(__dirname, '..'));
const readable = rows.filter(o => o.args !== null);
console.log(readable.map(o =>
  `  ('${o.where}','${o.fn}',array[${o.args.map(a => `'${a}'`).join(',')}]::text[])`
).join(',\n'));
// A call whose arguments cannot be read from the source is not silently
// dropped: it is named here so it is checked by hand rather than forgotten.
for (const o of rows.filter(o => o.args === null)) {
  console.log(`-- NOT LISTED: ${o.where} calls ${o.fn} with arguments this cannot read. Check it by hand.`);
}
