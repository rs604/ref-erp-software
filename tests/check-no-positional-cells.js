/* ============================================================
   No test may read a table cell by counting from the left.

   WHY THIS EXISTS. A test read the Amount column as td[10]. The moment a
   column was hidden it was reading the Rate column instead, and reported
   every row as having no amount at all. Nothing was wrong with the screen.
   The test was counting.

   Columns can be turned on and off now, so columns will keep moving. A cell
   is found by its HEADING, and a row by what it holds:

     const at = name => heads.indexOf(name);
     td[at('Amount')]                              // not td[10]
     rows.find(r => r.innerText.includes('...'))   // not rows[1]

   Position in a list of EQUIVALENT things — the third checkbox, the first
   menu item — is fine, and is not what this looks for. It looks for indexing
   into the cells of a row.

   Run:  node tests/check-no-positional-cells.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const PATTERNS = [
  { re: /\btd\s*\[\s*\d+\s*\]/g,                 why: 'td[N] — counts cells from the left' },
  { re: /\bcells\s*\[\s*\d+\s*\]/g,              why: 'cells[N] — counts cells from the left' },
  { re: /\.children\s*\[\s*\d+\s*\]/g,           why: '.children[N] — counts cells from the left' },
  { re: /\btr:nth-child\(\s*\d+\s*\)/g,          why: 'tr:nth-child(N) — picks a row by where it sits' },
  { re: /\btd:nth-child\(\s*\d+\s*\)/g,          why: 'td:nth-child(N) — picks a cell by where it sits' },
];

const findings = [];
let scanned = 0;

for (const f of fs.readdirSync(HERE).filter(n => n.endsWith('.js'))) {
  if (f === path.basename(__filename)) continue;
  const src = fs.readFileSync(path.join(HERE, f), 'utf8');
  scanned++;
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/ALLOW-POSITIONAL/.test(line)) return;   // deliberate, and says so
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      if (p.re.test(line)) {
        findings.push(`${f}:${i + 1}  ${p.why}\n            ${line.trim().slice(0, 90)}`);
      }
    }
  });
}

console.log('\nNo test counts its way to a cell\n');
if (findings.length === 0) {
  console.log(`  PASS  ${scanned} test files · none reads a cell or a row by position\n`);
  process.exit(0);
}
for (const f of findings) console.log('  FAIL  ' + f);
console.log(`\n${findings.length} to look at — find the cell by its heading, the row by what it holds\n`);
process.exit(1);
