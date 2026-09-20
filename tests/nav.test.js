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
    // Two different reasons, two different answers. A screen someone is not
    // ALLOWED to see is absent. A screen nobody can see because it is not
    // built is greyed and not clickable.
    greyed: Array.from(host.querySelectorAll('.refnav-soon')).map(s => s.textContent.trim()),
    clickableGreyed: Array.from(host.querySelectorAll('.refnav-soon[data-page], .refnav-soon button, .refnav-soon a')).length,
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
  record('a screen that is not built is greyed, on every page, not hidden',
    files.every(f => seen[f].soon.length === first.soon.length && seen[f].soon.length > 0),
    `${first.soon.length} greyed`);
  record('and a greyed one cannot be clicked into',
    files.every(f => seen[f].clickableGreyed === 0));

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
    record('a fitter cannot see Busy Data anywhere in it — absent, because it is not theirs',
      !!menu && !menu.modules.includes('Busy Data') && !menu.labels.includes('Price History'),
      menu ? menu.modules.join(' · ') : '');
    record('but a fitter DOES see the shape of the ERP, greyed',
      !!menu && menu.greyed.length > 0, menu ? `${menu.greyed.length} greyed` : '');
    record('a screen they may not see is never greyed at them — it is gone',
      !!menu && !menu.greyed.some(g => /Price History|Vendors|Employees|Decisions/.test(g)),
      menu ? menu.greyed.join(' · ') : '');
    record('a fitter cannot see the OWNER ONLY section',
      !!menu && !menu.labels.includes('Decisions'),
      menu ? menu.labels.join(' · ') : '');
    record('a fitter CAN still reach what they are for',
      !!menu && menu.labels.includes('Add a km reading'), menu ? menu.labels.join(' · ') : '');
    record('and none of the greyed rows is clickable for them either',
      !!menu && menu.clickableGreyed === 0);
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

  /* ---- 6c. NO SCREEN INSIDE A PAGE IS REACHABLE ONLY FROM ANOTHER SCREEN ----
     A page sweep cannot see this: admin.html holds nine screens behind one
     address. If one of them could only be opened from inside another, it
     would have the same fault the whole ERP had -- reachable only if you
     already knew the way. */
  {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(H.ROOT, 'admin.html'), 'utf8');
    const screens = [...new Set(Array.from(src.matchAll(/id="view-([a-z-]+)"/g)).map(m => m[1]))].sort();
    const page = await browser.newPage(DESK);
    await H.open(server, page, { file: 'admin.html', user: OWNER, handlers: HANDLERS, data: '{}' });
    await page.waitForTimeout(1500);
    const inMenu = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#refnav-host .refnav-item[data-page="admin.html"]'))
        .map(b => b.dataset.view).sort());
    const orphans = screens.filter(v => !inMenu.includes(v));
    record(`every screen inside admin.html has its own way in from the menu (${screens.length})`,
      orphans.length === 0,
      orphans.length ? 'reachable only from another screen: ' + orphans.join(', ')
                     : screens.join(' · '));
    // And nothing in the menu points at a screen that is not there.
    const missing = inMenu.filter(v => !screens.includes(v));
    record('and nothing in the menu points at a screen that does not exist',
      missing.length === 0, missing.join(', ') || 'none');
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

  /* ---- 8. REF AND RS ARE THE TWO BRANCHES OF THE MENU ----
     "Make both headings BOLD... Make them COLLAPSIBLE... Remember which is
     open, per person... Open the one I used last; collapse the other."     */
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await H.open(server, page, { file: 'busy.html', user: OWNER, handlers: HANDLERS,
                                 data: JSON.stringify(BUSY) });
    await page.waitForSelector('#shell', { state: 'visible' });
    await page.waitForTimeout(1400);

    const read = () => page.evaluate(() => {
      const secs = Array.from(document.querySelectorAll('[data-sectoggle]'));
      return secs.map(b => ({
        name: b.dataset.sec,
        weight: getComputedStyle(b).fontWeight,
        open: document.getElementById(b.dataset.sectoggle).classList.contains('open'),
        shown: Array.from(document.getElementById(b.dataset.sectoggle)
                 .querySelectorAll('.refnav-item'))
                 .filter(i => i.getBoundingClientRect().height > 0).length,
      }));
    });

    let secs = await read();
    record('REF and RS are headings of their own in the menu',
      secs.some(x => x.name === 'REF') && secs.some(x => x.name === 'RS'),
      secs.map(x => x.name).join(' · '));
    record('and both are BOLD, not faint labels',
      secs.every(x => Number(x.weight) >= 700),
      secs.map(x => `${x.name} ${x.weight}`).join(' · '));
    record('exactly one firm is open on arrival — not both, and never none',
      secs.filter(x => x.open).length === 1,
      secs.map(x => `${x.name} ${x.open ? 'open' : 'shut'}`).join(' · '));
    const ref = secs.find(x => x.name === 'REF');
    record('the open one shows its screens', ref.open && ref.shown >= 4, `REF shows ${ref.shown}`);

    // Click RS: it opens, and REF folds away.
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('[data-sectoggle]'))
        .find(x => x.dataset.sec === 'RS');
      if (b) b.click();
    });
    await page.waitForTimeout(250);
    secs = await read();
    record('clicking RS opens RS and folds REF away — one firm at a time',
      secs.find(x => x.name === 'RS').open && !secs.find(x => x.name === 'REF').open,
      secs.map(x => `${x.name} ${x.open ? 'open' : 'shut'}`).join(' · '));
    record('and REF\'s screens are gone from the menu, not merely faint',
      secs.find(x => x.name === 'REF').shown === 0);

    record('the choice is stored against the person, not the machine',
      await page.evaluate(() => window.localStorage.getItem('refnav.section.u-owner') === 'RS'),
      await page.evaluate(() => window.localStorage.getItem('refnav.section.u-owner')));

    // Come back tomorrow: the firm he was last in is the one that opens.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    secs = await read();
    record('and next time it opens the firm he used last, with the other shut',
      secs.find(x => x.name === 'RS').open && !secs.find(x => x.name === 'REF').open,
      secs.map(x => `${x.name} ${x.open ? 'open' : 'shut'}`).join(' · '));
    await page.close();
  }

  /* Another person on the same machine keeps their own answer. */
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await H.open(server, page, { file: 'busy.html', user: OWNER, handlers: HANDLERS,
                                 data: JSON.stringify(BUSY) });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.localStorage.setItem('refnav.section.someone-else', 'RS'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    record('one person\'s choice is not another\'s — the key carries who they are',
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('[data-sectoggle]'))
          .find(x => x.dataset.sec === 'REF');
        return !!b && document.getElementById(b.dataset.sectoggle).classList.contains('open');
      }));
    await page.close();
  }

  /* ---- 8b. ONE MODULE OPEN AT A TIME ----
     "Expanding a menu must COLLAPSE whatever else is open. Not stack.
     With several open the list runs off the screen and I scroll to find
     anything -- worse on a phone, where it fills the panel entirely." */
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await H.open(server, page, { file: 'admin.html', user: OWNER, handlers: HANDLERS, data: '{}' });
    await page.waitForTimeout(1500);

    const readMods = () => page.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-module]')];
      return btns.map(b => ({
        name: b.dataset.module,
        open: document.getElementById(b.dataset.toggle).classList.contains('open'),
        shown: [...document.getElementById(b.dataset.toggle).querySelectorAll('.refnav-item, .refnav-soon')]
                 .filter(i => i.getBoundingClientRect().height > 0).length,
      }));
    });

    let mods = await readMods();
    record('the menu has several modules with sub-items',
      mods.length >= 4, mods.map(m => m.name).join(' · '));
    record('exactly ONE of them is open on arrival — they do not stack',
      mods.filter(m => m.open).length === 1,
      mods.map(m => `${m.name} ${m.open ? 'open' : 'shut'}`).join(' · '));

    // Open another: it opens, and the one that was open closes.
    const was = mods.find(m => m.open).name;
    const other = mods.find(m => !m.open).name;
    await page.evaluate(n => {
      const b = [...document.querySelectorAll('[data-module]')].find(x => x.dataset.module === n);
      if (b) b.click();
    }, other);
    await page.waitForTimeout(250);
    mods = await readMods();
    record('opening one collapses whatever else was open',
      mods.find(m => m.name === other).open && !mods.find(m => m.name === was).open,
      `${other} open · ${was} shut`);
    record('and the collapsed one has no rows left on the screen, not merely faint',
      mods.find(m => m.name === was).shown === 0);
    record('still exactly one open, whatever is clicked',
      mods.filter(m => m.open).length === 1);

    record('the choice is stored against the person, not the machine',
      await page.evaluate(() => window.localStorage.getItem('refnav.module.u-owner')) === other,
      await page.evaluate(() => window.localStorage.getItem('refnav.module.u-owner')));

    // Come back: the module he was last in is the one open.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    mods = await readMods();
    record('and next time it opens the module he used last',
      mods.find(m => m.name === other).open && mods.filter(m => m.open).length === 1,
      mods.map(m => `${m.name} ${m.open ? 'open' : 'shut'}`).join(' · '));
    await page.close();
  }

  /* WHERE HE IS BEATS WHERE HE WAS. "The screen I am currently on stays
     open and highlighted, whatever else happens." */
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await H.open(server, page, { file: 'busy.html', user: OWNER, handlers: HANDLERS,
                                 data: JSON.stringify(BUSY) });
    await page.waitForSelector('#shell', { state: 'visible' });
    await page.waitForTimeout(1400);
    // Remember a module that is NOT the one holding this page's screens.
    await page.evaluate(() => window.localStorage.setItem('refnav.module.u-owner', 'Masters'));
    await page.evaluate(() => { window.location.hash = 'ledger%3AREF'; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const at = await page.evaluate(() => {
      const active = document.querySelector('.refnav-item.active');
      const box = active && active.closest('.refnav-children');
      const btn = box && document.querySelector('[data-toggle="' + box.id + '"]');
      return {
        active: active ? active.textContent.trim() : null,
        visible: !!(active && active.getBoundingClientRect().height > 0),
        module: btn ? btn.dataset.module : null,
        openCount: [...document.querySelectorAll('[data-module]')]
          .filter(b => document.getElementById(b.dataset.toggle).classList.contains('open')).length,
      };
    });
    record('the screen he is on is highlighted and its module is the open one',
      at.active === 'Ledger' && at.visible && at.module === 'Busy Data' && at.openCount === 1,
      JSON.stringify(at));
    await page.close();
  }

  /* ---- 9. THE MENU IS THE ERP'S COLOUR, FROM THE ERP'S ONE FILE ---- */
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await H.open(server, page, { file: 'busy.html', user: OWNER, handlers: HANDLERS,
                                 data: JSON.stringify(BUSY) });
    await page.waitForTimeout(1400);
    const seen = await page.evaluate(() => {
      const nav = document.querySelector('.refnav');
      const tok = getComputedStyle(document.documentElement).getPropertyValue('--steel-dark').trim();
      const probe = document.createElement('div');
      probe.style.background = tok; document.body.appendChild(probe);
      const want = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { nav: getComputedStyle(nav).backgroundColor, want: want, token: tok };
    });
    record('the left menu is not a colour of its own — it is the ERP\'s --steel-dark',
      seen.nav === seen.want && /#1f3547/i.test(seen.token),
      `${seen.nav} against ${seen.want} (${seen.token})`);
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
