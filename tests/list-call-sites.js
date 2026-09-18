/* Prints every .rpc( call in the repo as a SQL VALUES list, so the live check
   in check-rpc-live.sql is built from the code rather than from memory.

   Usage:  node tests/list-call-sites.js
   Then paste the output into the call(...) list in check-rpc-live.sql and run
   that against the project. Every row must say "resolves". */
'use strict';
const path = require('path');
const { rpcCallSites } = require('./call-sites');
const rows = rpcCallSites(path.resolve(__dirname, '..'));
console.log(rows.map(o =>
  `  ('${o.where}','${o.fn}',array[${o.args.map(a => `'${a}'`).join(',')}]::text[])`
).join(',\n'));
