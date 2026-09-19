/* ============================================================
   THE SWEEP — every screen, at a phone width, with a picture taken

   Why this exists, in his words: "THE MOBILE SWEEP DID NOT HAPPEN, OR DID
   NOT LOOK AT WHAT IT PRODUCED." Two screens were reported as reflowing
   cleanly and he found both broken in five minutes. Every assertion in
   phone.test.js had passed on a page whose cards were drawn UNDERNEATH the
   table -- because no assertion asks "does this look right", and nothing
   had opened the picture.

   So this walks every screen in the ERP, every tab inside admin.html
   included, at a real phone width, and does two things per screen:

     1. asks whether anything is painted on top of anything it is not
        inside, and whether the page runs off the side
     2. SAVES A SCREENSHOT, under tests/shots/

   Point 2 is the point. A green run here means the detector found nothing;
   it does not mean the screen is right. Open the pictures. He asked for the
   screenshot step to be kept permanently, and this is it -- the run prints
   the folder at the end so there is no excuse not to look.

   Run:  NODE_PATH=/opt/node22/lib/node_modules node tests/sweep.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const BUSY = require('./fixtures/busy-data.json');

/* A phone, not a narrow desktop window: isMobile and hasTouch change which
   media features match and which events fire. */
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const OUT = path.join(H.ROOT, 'tests', 'shots');

const OWNER = {
  id: 'u-owner', name: 'Raghbir Singh', is_owner: true, roles: ['owner'],
  permissions: ['busy_data.view', 'busy_data.import', 'km_tracker.view', 'payroll.view',
                'loans_advances.view', 'employee_master.view', 'vendor_master.view', 'admin.users'],
  must_change_password: false,
};

/* Enough of a day's work for the screens to have something to draw. An empty
   screen hides the faults that only appear once there are rows in it. */
const DASH = {
  success: true,
  entries: [{
    id: 'e1', status: 'submitted', entry_date: '2026-09-18', km_traveled: 160, cost: 1280,
    morning_reading: 41250, evening_reading: 41410,
    employees: { name: 'Harpreet Singh', employee_code: 'EMP-0014' },
    vehicles: { vehicle_name: 'PB10 AB 1234' },
  }],
  employees: [{ id: 'm1', name: 'Harpreet Singh', employee_code: 'EMP-0014', status: 'active' }],
  vehicles: [{ id: 'v1', vehicle_name: 'PB10 AB 1234', ownership_type: 'company' }],
  settings: { company_rate_per_km: 8 }, payment: {},
};

const HANDLERS = `{
  'me': function () { return { success:true }; },
  'admin-actions': function (p) { return (p&&p.action==='get_dashboard') ? ${JSON.stringify(DASH)} : { success:true }; },
  'hr-actions': function () { return { success:true, requests:[], employees:[], dropdowns:{} }; },
  'hrms-actions': function () { return { success:true, employees:[], dropdowns:{}, holidays:[] }; },
  'permissions-actions': function () { return { success:true, employees:[], permissions:[], grants:[] }; },
  'vendor-actions': function () { return { success:true, vendors:[], dropdowns:{} }; },
  'payroll-actions': function () { return { success:true, periods:[], entries:[] }; }
}`;

/* Anything painted on top of anything it is not inside.

   It deliberately keeps buttons, links and selects even when they have
   children: an earlier version skipped every element with a child, and so
   read a row of tabs printed on top of each other as clean. It drops
   anything off the side of the screen -- the closed menu drawer, for one --
   because that is not on the page and cannot be overlapping what is. */
const OVERLAP = () => {
  const box = el => el.getBoundingClientRect();
  const pick = Array.from(document.querySelectorAll(
    '.topbar *, .subtabs *, .panel-header *, h1, h2, .page-title, button, a, select, .status-tag, .count-chip'))
    .filter(e => {
      const b = box(e), cs = getComputedStyle(e);
      if (b.right < 1 || b.left > innerWidth - 1 || b.bottom < 1) return false;
      return b.width > 4 && b.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden'
             && (e.textContent || '').trim().length > 0
             && (e.children.length === 0 || /^(BUTTON|A|SELECT)$/.test(e.tagName));
    });
  const hits = [];
  for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) {
    const a = pick[i], b = pick[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = box(a), rb = box(b);
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 3 && oy > 3) hits.push(
      (a.textContent || '').trim().slice(0, 18) + ' over ' + (b.textContent || '').trim().slice(0, 18));
  }
  return {
    overlaps: [...new Set(hits)].slice(0, 6),
    sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
};

const results = [];
const shots = [];

async function look(page, name, file) {
  const r = await page.evaluate(OVERLAP);
  const shot = path.join(OUT, file + '.png');
  await page.screenshot({ path: shot });
  shots.push(shot);
  results.push({
    name, ok: !r.sideways && !r.overlaps.length,
    detail: (r.sideways ? 'RUNS OFF THE SIDE. ' : '') +
            (r.overlaps.length ? 'PRINTED ON TOP: ' + r.overlaps.join(' | ') : ''),
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

  const server = await H.serve();
  const browser = await H.chromium.launch();
  const mk = () => browser.newPage(PHONE);

  /* ---- admin.html: every screen the menu offers, and every tab inside it.
     The tabs matter as much as the screens -- a panel reachable only from
     another panel is the thing nobody ever opens. */
  let page = await mk();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await H.open(server, page, { file: 'admin.html', user: OWNER, handlers: HANDLERS, data: '{}' });
  await page.waitForTimeout(1800);
  const views = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#refnav-host button.refnav-item[data-view]')).map(b => b.dataset.view));
  for (const v of views) {
    await H.go(page, v);
    await page.waitForTimeout(1100);
    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.subtab-item')).filter(t => t.offsetParent)
        .map(t => t.dataset.tab || t.textContent.trim()));
    if (!tabs.length) {
      await look(page, 'admin: ' + v, 'admin-' + v);
    } else {
      for (const t of tabs) {
        await page.evaluate(t => {
          const b = [...document.querySelectorAll('.subtab-item')]
            .find(x => (x.dataset.tab || x.textContent.trim()) === t);
          if (b) b.click();
        }, t);
        await page.waitForTimeout(800);
        await look(page, 'admin: ' + v + ' > ' + t, 'admin-' + v + '-' + t.replace(/\W+/g, ''));
      }
    }
  }
  results.push({
    name: 'admin.html threw nothing while every screen was opened',
    ok: errs.length === 0, detail: errs.slice(0, 3).join(' | '),
  });
  await page.close();

  /* ---- busy.html. Price History and Challans are two of the four screens
     he named as genuinely mattering on a phone. */
  page = await mk();
  const berrs = [];
  page.on('pageerror', e => berrs.push(e.message));
  await H.open(server, page, { file: 'busy.html', user: OWNER, handlers: HANDLERS, data: JSON.stringify(BUSY) });
  await page.waitForSelector('#shell', { state: 'visible' });
  await page.waitForTimeout(1600);
  const bviews = await page.evaluate(() =>
    [...new Set(Array.from(document.querySelectorAll('#refnav-host button.refnav-item[data-view]')).map(b => b.dataset.view))]);
  for (const v of bviews) {
    await H.go(page, v, ['price', 'challans', 'reports', 'deleted'].includes(v) ? 'REF' : null);
    await page.waitForTimeout(1000);
    await look(page, 'busy: ' + v, 'busy-' + v);
  }
  /* A card opened, because that is where the description bug lived: the
     panel was there, and the text inside it was clipped to nothing.

     Back to Price History first. The loop above leaves the page on whatever
     screen came last, and #cards keeps its rows in the DOM while hidden --
     so without this the click landed on an invisible card and the picture
     was of the setup instructions. It passed. It proved nothing. */
  await H.go(page, 'price', 'REF');
  await page.waitForTimeout(1200);
  const opened = await page.evaluate(() => {
    const c = document.querySelector('#cards .rc');
    if (!c) return false;
    c.click();
    return true;
  });
  if (opened) {
    await page.waitForTimeout(500);
    await look(page, 'busy: a price-history card, opened', 'busy-card-open');
  }
  results.push({
    name: 'busy.html threw nothing while every screen was opened',
    ok: berrs.length === 0, detail: berrs.slice(0, 3).join(' | '),
  });
  await page.close();

  /* ---- the pages that are not inside a shell ---- */
  for (const f of ['index.html', 'submit.html', 'reset.html']) {
    page = await mk();
    await H.open(server, page, { file: f, user: OWNER, handlers: HANDLERS, data: '{}' });
    await page.waitForTimeout(1400);
    await look(page, f, f.replace('.html', ''));
    await page.close();
  }

  await browser.close();
  server.close();

  console.log('\nTHE SWEEP — 390x844, touch, every screen\n');
  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad++;
    console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '\n        ' + r.detail : ''));
  }
  console.log('\n' + (results.length - bad) + ' of ' + results.length + ' passed');
  console.log(shots.length + ' screenshots in ' + OUT);
  console.log('A green run means the detector found nothing. It does not mean the');
  console.log('screens are right. OPEN THE PICTURES.');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
