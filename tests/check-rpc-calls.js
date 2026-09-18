/* ============================================================
   Every database call is made with the arguments the function has.

   WHY THIS EXISTS. busy.html called busy_search with seven named arguments
   when the function takes eight. It worked, because the missing one —
   p_party — happens to default to null. A default was standing in for an
   argument nobody meant to leave out. Change that default a year from now
   and the call site silently changes meaning, and by then nobody remembers
   there was a call site.

   So: a call that omits an argument has to be omitting it ON PURPOSE. Say
   so in tests/fixtures/rpc-signatures.json under "may_omit", or pass it.

   Run:  node tests/check-rpc-calls.js
   Refresh the signatures after a migration that adds or changes a function.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SIGS = require('./fixtures/rpc-signatures.json');

/* Omissions that are deliberate, with the reason. Anything not listed here
   and not passed is reported. */
const MAY_OMIT = {
  'current_salary': {
    p_on: 'defaults to CURRENT_DATE — "what is this person paid today" is the ' +
          'question these three call sites are asking, and the default says it ' +
          'more plainly than passing new Date() would',
  },
};

const { rpcCallSites } = require('./call-sites');


const findings = [];
let calls = 0;

/* The snapshot is a COPY of the database's signatures, and a copy drifts.
   That is how busy_search came to be called with the wrong arguments twice.
   So: if any migration is newer than the snapshot, the snapshot is stale and
   this check cannot be trusted. Refresh it from the project before trusting
   a pass -- the query is in tests/README.md. */
{
  const migDir = path.join(ROOT, 'supabase', 'migrations');
  const sigFile = path.join(__dirname, 'fixtures', 'rpc-signatures.json');
  const sigAt = fs.statSync(sigFile).mtimeMs;
  const newer = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter(f => f.endsWith('.sql'))
        .filter(f => fs.statSync(path.join(migDir, f)).mtimeMs > sigAt)
    : [];
  if (newer.length) {
    findings.push('the recorded signatures are older than ' + newer.length +
      ' migration(s) — ' + newer.slice(0, 3).join(', ') +
      '. Refresh them from the project (see tests/README.md); until then a pass here proves nothing');
  }
}

let opaque = 0;
for (const site of rpcCallSites(ROOT)) {
  calls++;
  const where = site.where, name = site.fn, passed = site.args;
  const sig = SIGS.functions[name];
  if (!sig) { findings.push(`${where}  ${name} — no such function is recorded`); continue; }

  // Arguments handed over as a variable cannot be read from the text. Saying
  // "they are missing" would be an invention; saying nothing would be worse.
  // It is reported as what it is, and has to be checked another way.
  if (site.opaque) {
    opaque++;
    console.log(`  NOTE  ${where}  ${name} is called with a variable, not a literal, ` +
                `so its arguments cannot be checked here.\n        ` +
                `Check it against the live project, or assert it in a browser test.`);
    continue;
  }

  for (const p of passed) {
    if (!sig.args.includes(p)) {
      findings.push(`${where}  ${name} is passed ${p}, which it does not take`);
    }
  }
  for (const a of sig.args) {
    if (passed.includes(a)) continue;
    if (!(MAY_OMIT[name] || {})[a]) {
      findings.push(`${where}  ${name} does not pass ${a}. If that is on purpose, ` +
                    `say why in MAY_OMIT; otherwise it is leaning on a default`);
    }
  }
}

console.log('\nDatabase calls — every argument accounted for\n');
if (findings.length === 0) {
  console.log(`  PASS  ${calls} calls checked · every argument either passed or deliberately omitted` +
    (opaque ? ` · ${opaque} passed a variable and are checked elsewhere` : '') + '\n');
  process.exit(0);
}
for (const f of findings) console.log('  FAIL  ' + f);
console.log(`\n${calls} calls checked, ${findings.length} to look at\n`);
process.exit(1);
