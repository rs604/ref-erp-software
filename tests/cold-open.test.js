/* ============================================================
   OPENED COLD — docs/23

   "For weeks I have been using an ERP with no navigation and neither of
   us noticed, because I always arrived at admin.html through a bookmark.
   Worth asking what else is invisible because of how I happen to reach
   it."

   So: every page, opened COLD. A brand-new browser with nothing stored,
   no session carried over from another tab, arriving directly at the
   address. At a phone width and at a desk width. As a signed-in owner,
   and as a stranger with no session at all.

   What this catches that nothing else does: a page nobody ever opens
   directly, sitting on a live site, broken or blank or wide open.
   reset.html was exactly that.

   Run:  NODE_PATH=/opt/node22/lib/node_modules node tests/cold-open.test.js
   ============================================================ */
'use strict';
const H = require('./harness');
const BUSY = require('./fixtures/busy-data.json');

const PHONE = { viewport: { width: 380, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK  = { viewport: { width: 1360, height: 800 } };

const OWNER = {
  id: 'u-owner', name: 'Raghbir Singh', is_owner: true, roles: ['owner'],
  permissions: ['busy_data.view', 'busy_data.import'], must_change_password: false,
};
const HANDLERS = `{ 'me': function () { return { success: true }; } }`;

const PAGES = [
  { file: 'index.html',  data: null },
  { file: 'admin.html',  data: null },
  { file: 'busy.html',   data: BUSY },
  { file: 'submit.html', data: null },
  { file: 'reset.html',  data: null },
  { file: 'reset.html?first=1', data: null, name: 'reset.html (forced)' },
];

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });
const notes = [];

/* What a person actually sees, described rather than asserted. */
const LOOK = () => {
  const vis = el => !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
  const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
  const nav = document.getElementById('refnav-host');
  const navOn = !!nav && nav.querySelectorAll('.refnav-item').length > 0;
  return {
    words: text.length,
    firstWords: text.slice(0, 90),
    heading: (document.querySelector('h1, .page-title, #pageTitle') || {}).textContent || '',
    menuEntries: nav ? nav.querySelectorAll('.refnav-item[data-page]').length : 0,
    menuDrawn: navOn,
    hamburger: vis(document.querySelector('.refnav-open-btn')),
    fields: document.querySelectorAll('input:not([type=hidden]), select, textarea').length,
    buttons: Array.from(document.querySelectorAll('button, a.refnav-item, .btn'))
      .filter(vis).length,
    sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    // A stranger must not be looking at company data.
    showsData: /JUNEJA|AGGARWAL|₹[\d,]/.test(text),
  };
};

async function cold(browser, server, size, page, user) {
  /* A new CONTEXT, not just a new tab: nothing stored, nothing remembered
     from whatever was opened before it. */
  const ctx = await browser.newContext(size);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  const [file, query] = page.file.split('?');
  await H.open(server, p, {
    file: file + (query ? '?' + query : ''),
    user, handlers: HANDLERS, data: page.data ? JSON.stringify(page.data) : '{}',
  });
  await p.waitForTimeout(1800);
  const look = await p.evaluate(LOOK);
  const landed = p.url().split('/').pop();
  await ctx.close();
  return { look, errors, landed };
}

(async () => {
  const server = await H.serve();
  const browser = await H.chromium.launch();

  for (const size of [{ n: '380px', v: PHONE }, { n: 'desk', v: DESK }]) {
    for (const page of PAGES) {
      const label = (page.name || page.file) + ' @ ' + size.n;
      // Every page a signed-in person can be on must let them leave it.
      const isSignIn = /index\.html/.test(page.file);
      const isForcedReset = /first=1/.test(page.file);

      /* ---- signed in ---- */
      const inn = await cold(browser, server, size.v, page, OWNER);
      notes.push(`${label.padEnd(34)} signed in  → ${inn.landed.padEnd(22)} ` +
        `${inn.look.menuEntries} menu · ${inn.look.buttons} buttons · ${inn.look.fields} fields · ` +
        `"${inn.look.firstWords.slice(0, 46)}"`);

      record(`${label}: opens cold without throwing`,
        inn.errors.length === 0, inn.errors.slice(0, 2).join(' | '));
      record(`${label}: there is something on it`,
        inn.look.words > 20, `${inn.look.words} characters of text`);
      record(`${label}: nothing runs off the side`, !inn.look.sideways);

      if (!isSignIn && !isForcedReset) {
        record(`${label}: a signed-in person can get somewhere else from here`,
          inn.look.menuEntries > 0, `${inn.look.menuEntries} menu entries`);
        if (size.n === '380px') {
          record(`${label}: and the menu can be opened, because there is a hamburger`,
            inn.look.hamburger);
        }
      }
      if (isForcedReset) {
        record(`${label}: a FORCED password change offers no way round itself`,
          inn.look.menuEntries === 0, `${inn.look.menuEntries} menu entries`);
      }

      /* ---- a stranger, no session at all ---- */
      const out = await cold(browser, server, size.v, page, null);
      notes.push(`${label.padEnd(34)} no session → ${out.landed.padEnd(22)} ` +
        `${out.look.menuEntries} menu · "${out.look.firstWords.slice(0, 46)}"`);

      record(`${label}: a stranger sees no company data`,
        !out.look.showsData, out.look.firstWords);
      // Blank was what admin.html actually did: a white screen while the
      // redirect happened, and a white screen for ever if it did not.
      record(`${label}: a stranger is TOLD what is happening, not left on a blank page`,
        out.look.words > 20, `${out.look.words} characters: "${out.look.firstWords}"`);
      if (!isSignIn) {
        record(`${label}: and is not shown the working screen behind it`,
          /sign-in page/i.test(out.look.firstWords),
          out.look.firstWords);
      }
      record(`${label}: a stranger is shown no menu — not even the screen names`,
        out.look.menuEntries === 0, `${out.look.menuEntries} entries`);
      record(`${label}: opens cold for a stranger without throwing`,
        out.errors.length === 0, out.errors.slice(0, 2).join(' | '));
    }
  }

  await browser.close();
  server.close();

  console.log('\nWHAT EACH PAGE ACTUALLY SHOWS, OPENED COLD\n');
  notes.forEach(n => console.log('  ' + n));
  console.log('\nOPENED COLD — every page, both widths, signed in and not\n');
  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad++;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
  console.log(`\n${results.length - bad} of ${results.length} passed\n`);
  process.exit(bad ? 1 : 0);
})();
