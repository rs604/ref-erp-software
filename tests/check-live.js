/* ============================================================
   IS IT ACTUALLY LIVE?

   Four times in a row work was reported done and Raghbir could not see
   it, because it was sitting on a branch and the live site serves from
   main. busy.html was the same shape. hr-actions was the same.
   zz-storage-cleanup was the same.

   "The fault is not the code. It is that nobody checks the thing I
   actually see."

   So this asks GitHub what main ACTUALLY holds, right now, and compares
   it with the working copy, file by file. It is the nearest thing to
   opening the site, and it is the only check in this folder that looks
   outside this machine.

   What it cannot do: reach erp.refconveyors.net. This environment's
   egress rules refuse that address (CONNECT tunnel, 403). It reads the
   bytes GitHub Pages BUILDS from instead, which is main. If Pages is
   mid-deploy or serving from cache, main can be ahead of the site for a
   few minutes -- it is never behind.

   It reads those bytes AT THE COMMIT main points at, never by branch name.
   See mainSha() below for why: the branch-name form made this check cry wolf
   on the first merge after it was written.

   Run:  node tests/check-live.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'rs604/ref-erp-software';
const BRANCH = process.env.LIVE_BRANCH || 'main';

/* Everything the browser actually downloads. */
const SHIPPED = ['index.html', 'admin.html', 'busy.html', 'submit.html', 'reset.html',
                 'nav.js', 'ui.js', 'app-config.js', 'documentation.js',
                 'theme.css', 'ui.css', 'version.txt'];

/* Things that must be IN what main serves, named so a failure says what is
   missing rather than "the files differ". */
const MUST_HOLD = [
  { file: 'admin.html', what: 'the hamburger', find: 'refnav-open-btn' },
  { file: 'admin.html', what: 'the shared menu', find: 'src="nav.js"' },
  { file: 'busy.html',  what: 'the hamburger', find: 'refnav-open-btn' },
  { file: 'submit.html', what: 'the shared menu', find: 'src="nav.js"' },
  { file: 'reset.html', what: 'the shared menu', find: 'src="nav.js"' },
  { file: 'index.html', what: 'the shared menu', find: 'src="nav.js"' },
];

function get(url) {
  try {
    const out = execFileSync('curl', ['-sS', '-m', '30', '-w', '\n%{http_code}', url],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const cut = out.lastIndexOf('\n');
    return { code: Number(out.slice(cut + 1).trim()), body: out.slice(0, cut) };
  } catch (e) {
    return { code: 0, body: '', error: (e.message || String(e)).split('\n')[0] };
  }
}

/* WHICH COMMIT IS main, RIGHT NOW.

   Asking for files by BRANCH NAME made this check cry wolf twice.
   raw.githubusercontent caches a branch for about five minutes and does it
   PER PATH, so index.html comes back fresh while version.txt comes back with
   the previous build number, and the check announces that nothing is live
   when all of it is.

   A commit sha is immutable and is never served stale. So: ask the API what
   main points at, then read every file at that sha. */
let HEAD_SHA = null;
function mainSha() {
  if (HEAD_SHA) return HEAD_SHA;
  const r = get(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`);
  if (r.code !== 200) return null;
  try { HEAD_SHA = JSON.parse(r.body).sha; } catch (e) { return null; }
  return HEAD_SHA;
}

function fetchRaw(file) {
  const sha = mainSha();
  if (!sha) return { code: 0, body: '', error: 'could not ask GitHub which commit ' + BRANCH + ' is' };
  return get(`https://raw.githubusercontent.com/${REPO}/${sha}/${file}`);
}

const findings = [];
let checked = 0;

const atSha = mainSha();
console.log(`\nWhat ${BRANCH} holds, read at commit ${atSha ? atSha.slice(0, 7) : '(unknown)'}\n`);

for (const file of SHIPPED) {
  const here = fs.existsSync(path.join(ROOT, file));
  const live = fetchRaw(file);
  checked++;

  if (live.code === 0) {
    findings.push(`could not reach GitHub for ${file} — ${live.error || 'no answer'}. ` +
      'This check proves nothing until it can.');
    continue;
  }
  if (here && live.code === 404) {
    findings.push(`${file} is in the repo but NOT on ${BRANCH}. Nobody visiting the site has it.`);
    continue;
  }
  if (!here && live.code === 200) {
    findings.push(`${file} is on ${BRANCH} but not in the repo — live code nobody can read here.`);
    continue;
  }
  if (!here) continue;

  const mine = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const same = mine === live.body;
  console.log(`  ${same ? 'same   ' : 'DIFFERS'}  ${file.padEnd(18)} ` +
    `${live.body.length} bytes on ${BRANCH}, ${mine.length} here`);
  if (!same) findings.push(`${file} on ${BRANCH} is not what is in the repo.`);
}

/* The named things, read out of what main actually holds. */
console.log('');
for (const m of MUST_HOLD) {
  const live = fetchRaw(m.file);
  const has = live.code === 200 && live.body.includes(m.find);
  console.log(`  ${has ? 'yes' : 'NO '}  ${m.file.padEnd(14)} ${m.what}`);
  if (!has) findings.push(`${m.file} on ${BRANCH} does not contain ${m.what}. ` +
    'Whatever was built, this is not what a person opening the site gets.');
}

/* And how far behind main is, in his words rather than in hashes. */
try {
  const behind = execFileSync('git', ['log', `origin/${BRANCH}..HEAD`, '--oneline'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  if (behind) {
    const lines = behind.split('\n');
    console.log(`\n  ${lines.length} commit(s) are NOT on ${BRANCH}:`);
    lines.forEach(l => console.log('    ' + l));
    findings.push(`${lines.length} commit(s) are on this branch and not on ${BRANCH}. ` +
      'The site serves ' + BRANCH + '.');
  }
} catch (e) { /* no origin, or offline: the file comparison above still stands */ }

console.log('\nIs it live?\n');
if (!findings.length) {
  console.log(`  PASS  ${checked} shipped files · what ${BRANCH} serves is what is in the repo\n`);
  process.exit(0);
}
findings.forEach(f => console.log('  FAIL  ' + f));
console.log(`\n${findings.length} reason(s) it is not live\n`);
process.exit(1);
