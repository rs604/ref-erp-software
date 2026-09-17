/* ============================================================
   ANYTHING THAT BELONGS TO A SET GETS CHECKED AGAINST THE SET.

   WHY THIS EXISTS. busy.html was built on its own, so it inherited none
   of what the other pages share. It had no menu link until one was added.
   It opened to a blank screen. And it loaded the Supabase library from a
   different address and an unpinned version, so one day the library simply
   did not load and the whole page refused to open.

   Every one of those is the same fault: a thing that belongs to a group
   but was never checked against the group. Nothing was wrong with
   busy.html on its own terms, and nothing was wrong with the other pages.
   Only the fact that they had drifted apart was wrong, and that belonged
   to nobody.

   So the set is checked, on every run, not once.

   Run:  node tests/check-page-set.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* A page is in the set if it signs the person in -- that is, if it loads
   app-config.js. Nothing has to be added to a list by hand, so a new page
   joins the set by existing. */
const PAGES = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('app-config.js'));

/* What every page in the set must carry, and why. */
const RULES = [
  {
    what: 'the Supabase library, at one pinned address',
    // Not "@2". A bare package with no file asks jsDelivr for the module
    // build, which never sets window.supabase; and a bare major floats, so
    // the page can change behaviour with nobody touching the repo.
    find: /<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]*)"><\/script>/,
    mustMatch: /@supabase\/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js$/,
    sameAcrossPages: true,
  },
  { what: 'app-config.js, and nothing else holding the project address',
    find: /<script src="(app-config\.js)"><\/script>/, sameAcrossPages: true },
  { what: 'the no-cache instruction',
    find: /(<meta http-equiv="Cache-Control"[^>]*>)/, sameAcrossPages: true },
  { what: 'the Pragma fallback for older caches',
    find: /(<meta http-equiv="Pragma"[^>]*>)/, sameAcrossPages: true },
  { what: 'the Expires fallback',
    find: /(<meta http-equiv="Expires"[^>]*>)/, sameAcrossPages: true },
  { what: 'the build version it was shipped as',
    find: /window\.__BUILD_VERSION__ = '(\d+)';/, sameAcrossPages: true },
  { what: 'the check that reloads the page when a new version ships',
    find: /(fetch\('version\.txt\?_=' \+ Date\.now\(\))/, sameAcrossPages: true },
];

const findings = [];
const seen = {};

for (const page of PAGES) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const rule of RULES) {
    const m = rule.find.exec(src);
    if (!m) { findings.push(`${page} is missing ${rule.what}`); continue; }
    const value = m[1];
    if (rule.mustMatch && !rule.mustMatch.test(value)) {
      findings.push(`${page} loads ${value} — that is not a pinned UMD build, ` +
                    `so it may not set window.supabase and may change on its own`);
    }
    if (rule.sameAcrossPages) {
      (seen[rule.what] = seen[rule.what] || {})[value] =
        (seen[rule.what][value] || []).concat(page);
    }
  }
}

for (const [what, values] of Object.entries(seen)) {
  const spellings = Object.keys(values);
  if (spellings.length > 1) {
    findings.push(`the pages disagree about ${what}:\n` +
      spellings.map(v => `            ${values[v].join(', ')} -> ${v}`).join('\n'));
  }
}

/* The version in the pages must be the version in version.txt, or every open
   page reloads itself for ever looking for a version that never arrives. */
{
  const onDisk = fs.readFileSync(path.join(ROOT, 'version.txt'), 'utf8');
  if (onDisk !== onDisk.trim() + '\n') {
    findings.push('version.txt must hold the version and nothing else, ending in one newline');
  }
  const v = onDisk.trim();
  for (const page of PAGES) {
    const m = /window\.__BUILD_VERSION__ = '(\d+)';/.exec(fs.readFileSync(path.join(ROOT, page), 'utf8'));
    if (m && m[1] !== v) {
      findings.push(`${page} says it is build ${m[1]} but version.txt says ${v} — ` +
                    `every open copy of that page would reload itself for ever`);
    }
  }
}

console.log('\nEvery page checked against the set\n');
console.log('  in the set: ' + PAGES.join(', ') + '\n');
if (findings.length === 0) {
  console.log(`  PASS  ${PAGES.length} pages · ${RULES.length} shared things · all agree\n`);
  process.exit(0);
}
for (const f of findings) console.log('  FAIL  ' + f);
console.log(`\n${findings.length} to look at\n`);
process.exit(1);
