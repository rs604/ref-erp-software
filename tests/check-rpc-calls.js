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

function filesToScan(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'tokyo-backup') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesToScan(p, out);
    else if (/\.(html|js|ts)$/.test(e.name) && !p.includes('/tests/')) out.push(p);
  }
  return out;
}

/* Pulls the top-level keys out of the object literal a call passes. */
function argsOf(src, openBraceIdx) {
  let depth = 0, end = openBraceIdx;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(openBraceIdx + 1, end);
  const keys = new Set();
  let d = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ('{[('.includes(c)) d++;
    else if ('}])'.includes(c)) d--;
    else if (d === 0) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(body.slice(i));
      if (m && (i === 0 || /[,\s]/.test(body[i - 1]))) keys.add(m[1]);
    }
  }
  return [...keys];
}

const findings = [];
let calls = 0;

for (const file of filesToScan(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /\.rpc\(\s*['"]([A-Za-z0-9_]+)['"]\s*(,\s*\{)?/g;
  let m;
  while ((m = re.exec(src))) {
    calls++;
    const name = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${path.relative(ROOT, file)}:${line}`;
    const sig = SIGS.functions[name];
    if (!sig) { findings.push(`${where}  ${name} — no such function is recorded`); continue; }
    const passed = m[2] ? argsOf(src, src.indexOf('{', m.index + m[0].length - 1)) : [];

    for (const p of passed) {
      if (!sig.args.includes(p)) {
        findings.push(`${where}  ${name} is passed ${p}, which it does not take`);
      }
    }
    for (const a of sig.args) {
      if (passed.includes(a)) continue;
      const excuse = (MAY_OMIT[name] || {})[a];
      if (!excuse) {
        findings.push(`${where}  ${name} does not pass ${a}. If that is on purpose, ` +
                      `say why in MAY_OMIT; otherwise it is leaning on a default`);
      }
    }
  }
}

console.log('\nDatabase calls — every argument accounted for\n');
if (findings.length === 0) {
  console.log(`  PASS  ${calls} calls checked · every argument either passed or deliberately omitted\n`);
  process.exit(0);
}
for (const f of findings) console.log('  FAIL  ' + f);
console.log(`\n${calls} calls checked, ${findings.length} to look at\n`);
process.exit(1);
