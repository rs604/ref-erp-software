/* ============================================================
   THE NAVIGATION — one menu, every page

   Raghbir opened the ERP and found there was no way to get from one
   screen to another. index.html, submit.html and reset.html had no menu
   at all; admin.html and busy.html each had their own, written by hand,
   and neither could reach the other's screens. He had been arriving at
   admin.html by bookmark for weeks, so nobody noticed.

   This test refuses to let that come back. It opens EVERY page at a real
   phone width, opens the menu, and reaches every other page from it.

   Run:  NODE_PATH=/opt/node22/lib/node_modules node tests/nav.test.js
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
/* A fitter: km readings and nothing else. */
const FITTER = {
  id: 'u-fitter', name: 'Gurpreet Singh', is_owner: false, roles: ['staff'],
  permissions: ['km_tracker.submit'], must_change_password: false,
};
const HANDLERS = `{ 'me': function () { return { success: true }; } }`;

/* The pages a signed-in person can be on and navigate from. index.html is the
   sign-in screen: a signed-in person is redirected off it, and a signed-out
   one must not be shown a list of the ERP's screens. */
const PAGES = [
  { file: 'admin.html', data: null, ready: '#appShell' },
  { file: 'busy.html',  data: BUSY, ready: '#shell' },
  { file: 'submit.html', data: null, ready: '.wrap' },
  { file: 'reset.html', data: null, ready: '.card' },
];

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

async function openAt(server, browser, opts, file, data, user) {
  const page = await browser.newPage(opts);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await H.open(server, page, {
    file, user: user || OWNER, handlers: HANDLERS, data: data ? JSON.stringify(data) : '{}',
  });
  await page.waitForTimeout(1600);
  return { page, errors };
}

const READ_MENU = () => {
  const host = document.getElementById('refnav-host');
  if (!host) return null;
  const items = Array.from(host.querySelectorAll('.refnav-item[data-page]'));
  return {
    labels: items.map(i => i.textContent.trim()),
    pages: [...new Set(items.map(i => i.dataset.page))].sort(),
    soon: Array.from(host.querySelectorAll('.refnav-soon')).map(s => s.textContent.trim()),
    modules: Array.from(host.querySelectorAll('.refnav-item[data-toggle]')).map(i => i.textContent.trim()),
    // Absent, never greyed: nothing a person cannot use may be sitting there
    // disabled, because a disabled button still tells them the screen exists.
    disabled: Array.from(host.querySelectorAll('[disabled], [aria-disabled="true"]')).length,
  };
};

(async () => {
  const server = await H.serve();
  const browser = await H.chromium.launch();

  /* ---- 1. THE SAME MENU ON EVERY PAGE ---- */
  const seen = {};
  for (const p of PAGES) {
    const { page, errors } = await openAt(server, browser, PHONE, p.file, p.data);
    const menu = await page.evaluate(READ_MENU);
    record(`${p.file}: the menu is there at all`, !!menu,
      menu ? `${menu.labels.length} entries` : 'NO MENU ON THIS PAGE');
    if (menu) seen[p.file] = menu;
    record(`${p.file}: no script errors with the shared menu`,
      errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  const files = Object.keys(seen);
  const first = seen[files[0]];
  record(`every page shows the SAME menu, in the same order (${files.length} pages)`,
    files.length === PAGES.length &&
    files.every(f => JSON.stringify(seen[f].labels) === JSON.stringify(first.labels)),
    files.map(f => `${f}:${seen[f] ? seen[f].labels.length : 0}`).join(' · '));
  record('and the same modules, in the locked order',
    files.every(f => JSON.stringify(seen[f].modules) === JSON.stringify(first.modules)),
    first ? first.modules.join(' · ') : '');

  /* The order docs/11 locks. Busy Data second, because it is what he opens
     most. HRMS is not in that document -- it was written before the salary
     sheet and km tracker existed -- and is flagged in nav.js for a decision. */
  record('the modules are the ones locked in docs/11',
    JSON.stringify(first.modules) ===
      JSON.stringify(['Busy Data', 'HRMS', 'Masters', 'Purchase', 'Accounts', 'Settings']),
    first.modules.join(' · '));

  /* ---- 2. A SCREEN THAT DOES NOT EXIST SAYS SO ---- */
  record('a screen that is not built yet is shown and says so, not silently missing',
    first.soon.length > 0 && first.soon.every(s => /not built yet/.test(s)),
    first.soon.join(' · '));
  record('nothing in the menu is greyed out — absent, or usable',
    files.every(f => seen[f].disabled === 0));

  /* ---- 3. REACH EVERY OTHER PAGE FROM EVERY PAGE, AT 380px ---- */
  for (const p of PAGES) {
    const { page } = await openAt(server, browser, PHONE, p.file, p.data);
    const others = ['admin.html', 'busy.html', 'submit.html'].filter(f => f !== p.file);
    for (const target of others) {
      // Open the drawer the way a person does, then pick the entry.
      await page.locator('.refnav-open-btn').tap();
      await page.waitForTimeout(300);
      // A module is collapsed until it is opened, which is what docs/11 asks
      // for. So do what a person does: open the module, then pick the entry.
      await page.evaluate(t => {
        const item = document.querySelector(`#refnav-host .refnav-item[data-page="${t}"]`);
        if (!item) return;
        const kids = item.closest('.refnav-children');
        if (kids && !kids.classList.contains('open')) {
          const toggle = document.querySelector(`.refnav-item[data-toggle="${kids.id}"]`);
          if (toggle) toggle.click();
        }
      }, target);
      await page.waitForTimeout(250);
      const link = page.locator(`#refnav-host a.refnav-item[data-page="${target}"]`).first();
      const found = await link.count();
      if (!found) {
        record(`${p.file} → ${target}: there is a way to get there`, false, 'no entry for that page');
        continue;
      }
      await link.tap();
      await page.waitForTimeout(1600);
      const landed = page.url().split('/').pop().split('#')[0];
      record(`${p.file} → ${target}: reached it from the menu at 380px`,
        landed === target, `landed on ${landed}`);
      // Go back and carry on from the page under test.
      await H.open(server, page, {
        file: p.file, user: OWNER, handlers: HANDLERS, data: p.data ? JSON.stringify(p.data) : '{}',
      });
      await page.waitForTimeout(1400);
    }
    await page.close();
  }

  /* ---- 4. THE DRAWER ITSELF ---- */
  {
    const { page } = await openAt(server, browser, PHONE, 'admin.html', null);
    const where = () => page.evaluate(() => {
      const b = document.getElementById('refnav-host').getBoundingClientRect();
      return { left: Math.round(b.left), width: Math.round(b.width) };
    });
    record('the menu is out of the way until it is asked for', (await where()).left < -50);
    const btn = page.locator('.refnav-open-btn');
    const size = await btn.boundingBox();
    record('the hamburger is big enough to tap',
      !!size && size.width >= 44 && size.height >= 44,
      size ? `${Math.round(size.width)}×${Math.round(size.height)}` : 'missing');
    await btn.tap(); await page.waitForTimeout(300);
    record('it slides in over the page', (await where()).left >= -1);
    record('and the page does not go sideways while it is open',
      !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
    await page.locator('.refnav-backdrop').tap({ position: { x: 350, y: 640 } });
    await page.waitForTimeout(300);
    record('tapping outside closes it', (await where()).left < -50);
    await btn.tap(); await page.waitForTimeout(300);
    await page.evaluate(() => {
      const item = document.querySelector('#refnav-host .refnav-item[data-view="km-tracker"]');
      const kids = item && item.closest('.refnav-children');
      if (kids && !kids.classList.contains('open')) {
        document.querySelector(`.refnav-item[data-toggle="${kids.id}"]`).click();
      }
    });
    await page.waitForTimeout(250);
    await page.locator('#refnav-host button.refnav-item[data-view="km-tracker"]').tap();
    await page.waitForTimeout(700);
    record('picking a screen on THIS page switches to it without leaving the page',
      (await page.evaluate(() => document.getElementById('pageTitle').textContent)).includes('Km Tracker'),
      await page.evaluate(() => document.getElementById('pageTitle').textContent));
    record('and picking it closed the drawer', (await where()).left < -50);
    await page.keyboard.press('Escape');
    await btn.tap(); await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    record('Escape closes it too', (await where()).left < -50);
    await page.close();
  }

  /* ---- 5. ARRIVING FROM ANOTHER PAGE LANDS ON THE RIGHT SCREEN ---- */
  {
    const page = await browser.newPage(PHONE);
    await H.open(server, page, { file: 'admin.html', user: OWNER, handlers: HANDLERS, data: '{}' });
    await page.evaluate(() => { window.location.hash = 'vendor-master'; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    record('a menu entry from another page lands on the screen it named, not on Home',
      (await page.evaluate(() => document.getElementById('pageTitle').textContent)).includes('Vendor'),
      await page.evaluate(() => document.getElementById('pageTitle').textContent));
    await page.close();
  }
  {
    const page = await browser.newPage(PHONE);
    await H.open(server, page, { file: 'busy.html', user: OWNER, handlers: HANDLERS, data: JSON.stringify(BUSY) });
    await page.evaluate(() => { window.location.hash = 'reports%3ARS'; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const at = await page.evaluate(() => ({
      title: document.getElementById('pageTitle').textContent,
      firm: document.getElementById('firmChip').textContent.trim(),
    }));
    record('and it carries the firm too — RS Reports opens as RS Reports',
      /Reports/.test(at.title) && at.firm === 'RS', JSON.stringify(at));
    await page.close();
  }

  /* ---- 6. PERMISSIONS: ABSENT, NOT GREYED ---- */
  {
    const { page } = await openAt(server, browser, PHONE, 'submit.html', null, FITTER);
    const menu = await page.evaluate(READ_MENU);
    record('a fitter sees a menu at all', !!menu, menu ? `${menu.labels.length} entries` : 'none');
    record('a fitter cannot see Busy Data anywhere in it',
      !!menu && !menu.modules.includes('Busy Data') && !menu.labels.includes('Price History'),
      menu ? menu.modules.join(' · ') : '');
    record('a fitter cannot see the OWNER ONLY section',
      !!menu && !menu.labels.includes('Decisions'),
      menu ? menu.labels.join(' · ') : '');
    record('a fitter CAN still reach what they are for',
      !!menu && menu.labels.includes('Add a km reading'), menu ? menu.labels.join(' · ') : '');
    record('nothing is greyed out for them either — it is simply absent',
      !!menu && menu.disabled === 0);
    await page.close();
  }

  /* ---- 6b. THE SIGN-IN SCREEN SHOWS NOBODY A MENU ---- */
  {
    const page = await browser.newPage(PHONE);
    await H.open(server, page, { file: 'index.html', user: null, handlers: HANDLERS, data: '{}' });
    await page.waitForTimeout(1200);
    const signin = await page.evaluate(() => ({
      loadsTheMenuFile: !!Array.from(document.scripts).find(s => /nav\.js/.test(s.src)),
      hasHost: !!document.getElementById('refnav-host'),
      drawsAnything: document.querySelectorAll('#refnav-host .refnav-item').length,
    }));
    record('the sign-in page loads the same menu file as every other page',
      signin.loadsTheMenuFile && signin.hasHost, JSON.stringify(signin));
    record('but shows a signed-out stranger nothing — not one screen name',
      signin.drawsAnything === 0, `${signin.drawsAnything} entries drawn`);
    await page.close();
  }

  /* ---- 7. AT A DESK IT IS STILL A COLUMN ---- */
  {
    const { page } = await openAt(server, browser, DESK, 'admin.html', null);
    const desk = await page.evaluate(() => {
      const nav = document.getElementById('refnav-host').getBoundingClientRect();
      const btn = document.querySelector('.refnav-open-btn');
      return {
        left: Math.round(nav.left), width: Math.round(nav.width),
        hamburgerHidden: !btn || getComputedStyle(btn).display === 'none',
      };
    });
    record('at a desk the menu is a column down the left',
      desk.left === 0 && desk.width > 180, JSON.stringify(desk));
    record('and the hamburger is not there', desk.hamburgerHidden);
    await page.close();
  }

  await browser.close();
  server.close();

  console.log('\nTHE NAVIGATION — one menu, every page\n');
  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad++;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
  console.log(`\n${results.length - bad} of ${results.length} passed\n`);
  process.exit(bad ? 1 : 0);
})();
