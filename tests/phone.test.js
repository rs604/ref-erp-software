/* ============================================================
   THE PHONE — docs/23-screen-tests.md section 9

   Run at a REAL phone width (380x740, touch, no mouse), not a shrunk
   desktop window. The faults are different: a shrunk window keeps the
   mouse, keeps hover, and keeps the desktop breakpoint, so it will pass
   a page that a phone cannot use at all. That is how the ERP shipped for
   months with NO MENU on a phone.

   The checklist, run on every screen:
     1. the menu opens and closes
     2. every control is reachable and big enough to tap
     3. nothing overflows sideways
     4. a form can be filled start to finish without the keyboard hiding
        a field
     5. a table can be read

   Run:  NODE_PATH=/opt/node22/lib/node_modules node tests/phone.test.js
   ============================================================ */
'use strict';
const H = require('./harness');
const BUSY = require('./fixtures/busy-data.json');

/* A phone, not a narrow desktop. hasTouch and isMobile change which events
   fire and which media features match; without them this tests nothing. */
const PHONE = { viewport: { width: 380, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/* 44px is the smallest square a thumb hits reliably, and 12px the smallest
   text worth calling readable. Both are floors, not targets. */
const TAP = 44;
const TEXT = 12;

const OWNER = {
  id: 'u-owner', name: 'Raghbir Singh', is_owner: true, roles: ['owner'],
  permissions: ['busy_data.view', 'busy_data.import'], must_change_password: false,
};
const HANDLERS = `{ 'me': function () { return { success: true }; } }`;

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

/* Everything on screen that a person has to reach or read, measured from the
   page itself rather than from a list kept by hand. */
const PROBE = ({ tap, text }) => {
  const vw = document.documentElement.clientWidth;
  const name = el => el.id ? '#' + el.id
    : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/)[0] : '');
  const out = { over: [], taps: [], tiny: [], vw };
  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    // Sticking out past the right edge, and not inside something that scrolls
    // sideways on purpose. A table in its own scrollbox is fine; the page
    // being wider than the phone is not.
    if (b.right > vw + 1) {
      let p = el.parentElement, contained = false;
      while (p && p !== document.body) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { contained = true; break; }
        p = p.parentElement;
      }
      if (!contained) out.over.push(name(el) + ' →' + Math.round(b.right));
    }
    if (/^(BUTTON|A|SELECT)$/.test(el.tagName) && cs.pointerEvents !== 'none'
        && (b.height < tap || b.width < 28)) {
      out.taps.push(name(el) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
    }
    if (el.children.length === 0 && (el.textContent || '').trim().length > 4
        && parseFloat(cs.fontSize) < text) {
      out.tiny.push(Math.round(parseFloat(cs.fontSize) * 10) / 10 + 'px ' + name(el));
    }
  });
  out.pageWide = document.documentElement.scrollWidth > vw + 1;
  ['over', 'taps', 'tiny'].forEach(k => out[k] = [...new Set(out[k])].slice(0, 6));
  return out;
};

async function phonePage(server, browser, file, data, user) {
  const page = await browser.newPage(PHONE);
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
  await page.waitForTimeout(1500);
  return { page, errors };
}

/* ---- 1. THE MENU OPENS AND CLOSES ---- */
async function checkMenu(page, label, navSel, stayView, stayFirm) {
  const where = () => page.evaluate(sel => {
    const n = document.querySelector(sel); if (!n) return null;
    const b = n.getBoundingClientRect();
    return { left: Math.round(b.left), width: Math.round(b.width) };
  }, navSel);

  const shut = await where();
  record(`${label}: the menu is out of the way until it is asked for`,
    !!shut && shut.left < -50, JSON.stringify(shut));

  const btn = page.locator('.refnav-open-btn');
  // A hamburger that is not there must FAIL, not throw. The fault this whole
  // section exists for was exactly that: no menu, nothing to open it, and a
  // test run that fell over would have said nothing at all.
  const size = await btn.isVisible().then(v => v ? btn.boundingBox() : null).catch(() => null);
  record(`${label}: there IS a way to open the menu, and it is big enough to tap`,
    !!size && size.height >= TAP && size.width >= TAP,
    size ? `${Math.round(size.width)}×${Math.round(size.height)}` : 'NO HAMBURGER AT ALL — the menu cannot be opened');
  if (!size) {
    record(`${label}: tapping it slides the menu in over the page`, false, 'nothing to tap');
    record(`${label}: tapping outside closes it`, false, 'nothing to tap');
    record(`${label}: picking something closes it, so the menu is not left covering the answer`,
      false, 'nothing to tap');
    return;
  }

  await btn.tap();
  await page.waitForTimeout(350);
  const open = await where();
  record(`${label}: tapping it slides the menu in over the page`,
    !!open && open.left >= -1 && open.width > 150, JSON.stringify(open));

  // It must lie OVER the page, not push it sideways.
  record(`${label}: the page does not go sideways while the menu is open`,
    !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));

  await page.locator('.refnav-backdrop').tap({ position: { x: 350, y: 640 } });
  await page.waitForTimeout(350);
  record(`${label}: tapping outside closes it`, (await where()).left < -50);

  await btn.tap();
  await page.waitForTimeout(350);
  await H.go(page, stayView, stayFirm);
  await page.waitForTimeout(400);
  record(`${label}: picking something closes it, so the menu is not left covering the answer`,
    (await where()).left < -50);
}

/* ---- 2, 3 and 5: the screen itself ---- */
function reportScreen(label, r) {
  record(`${label}: nothing runs off the side of the screen`,
    !r.pageWide && r.over.length === 0,
    r.pageWide ? 'the PAGE scrolls sideways' : r.over.join(' | '));
  record(`${label}: every button and link is big enough to tap (${TAP}px)`,
    r.taps.length === 0, r.taps.join(' | '));
  record(`${label}: nothing is too small to read (${TEXT}px)`,
    r.tiny.length === 0, r.tiny.join(' | '));
}

(async () => {
  const server = await H.serve();
  const browser = await H.chromium.launch();

  /* ================= admin.html ================= */
  {
    const { page, errors } = await phonePage(server, browser, 'admin.html', null);
    await checkMenu(page, 'ERP', '#refnav-host', 'km-tracker', null);

    const views = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#refnav-host button.refnav-item[data-view]')).map(b => b.dataset.view));
    record(`the menu reaches every ERP screen from a phone (${views.length})`,
      views.length >= 8, views.join(' · '));

    for (const v of views) {
      await H.go(page, v);
      await page.waitForTimeout(800);
      reportScreen('ERP ' + v, await page.evaluate(PROBE, { tap: TAP, text: TEXT }));
    }
    record('no script errors anywhere on the ERP at phone width',
      errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  /* ================= busy.html ================= */
  {
    const { page, errors } = await phonePage(server, browser, 'busy.html', BUSY);
    await page.waitForSelector('#shell', { state: 'visible' });
    await checkMenu(page, 'Busy Data', '#refnav-host', 'reports', 'REF');

    const views = await page.evaluate(() =>
      [...new Set(Array.from(document.querySelectorAll('#refnav-host button.refnav-item[data-view]')).map(b => b.dataset.view))]);
    for (const v of views) {
      await H.go(page, v);
      await page.waitForTimeout(800);
      reportScreen('Busy ' + v, await page.evaluate(PROBE, { tap: TAP, text: TEXT }));
    }

    /* ---- 5. A TABLE CAN BE READ ----
       The price table is wider than a phone. It must scroll INSIDE its own
       box, taking its column headings with it — not drag the whole page
       sideways, and not scroll the headings away. */
    await H.go(page, 'price');
    await page.waitForTimeout(900);
    const table = await page.evaluate(() => {
      const w = document.querySelector('.tbl-wrap');
      if (!w) return null;
      const before = { x: w.scrollLeft, y: w.scrollTop };
      w.scrollLeft = 400; w.scrollTop = 300;
      const after = { x: w.scrollLeft, y: w.scrollTop };
      const th = document.querySelector('#headRow th');
      const wrapTop = w.getBoundingClientRect().top;
      const headTop = th ? th.getBoundingClientRect().top : null;
      return {
        widerThanBox: w.scrollWidth > w.clientWidth + 1,
        scrolledSideways: after.x > before.x,
        scrolledDown: after.y > before.y,
        headingsStayed: headTop !== null && Math.abs(headTop - wrapTop) < 4,
        pageWentSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    record('Busy price: the table is wider than the phone, so this proves something',
      !!table && table.widerThanBox);
    record('Busy price: it scrolls inside its own box, not the page',
      !!table && table.scrolledSideways && !table.pageWentSideways, JSON.stringify(table));
    record('Busy price: the column headings stay put while the rows scroll under them',
      !!table && table.scrolledDown && table.headingsStayed, JSON.stringify(table));

    record('no script errors anywhere in Busy Data at phone width',
      errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  /* ================= the standalone screens ================= */
  for (const file of ['index.html', 'submit.html', 'reset.html']) {
    const { page, errors } = await phonePage(server, browser, file, null);
    reportScreen(file, await page.evaluate(PROBE, { tap: TAP, text: TEXT }));

    /* ---- 4. A FORM CAN BE FILLED WITHOUT THE KEYBOARD HIDING A FIELD ----
       A phone keyboard eats roughly the bottom 40% of the screen. Chromium
       does not raise one, so the test asks the question the keyboard asks:
       when this field is focused, is there room above the fold for it? Every
       field must be reachable by scrolling AND must ask the browser to keep
       clear of the bottom (scroll-margin-bottom), which is what stops it
       ending up underneath. */
    const fields = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input, select, textarea').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || el.type === 'hidden') return;
        el.focus();
        const b = el.getBoundingClientRect();
        out.push({
          id: el.id || el.name || el.type,
          fontSize: parseFloat(cs.fontSize),
          keptClear: parseFloat(cs.scrollMarginBottom) >= 100,
          height: Math.round(b.height),
        });
      });
      return out;
    });
    record(`${file}: a field is never hidden behind the keyboard`,
      fields.length > 0 && fields.every(f => f.keptClear),
      fields.filter(f => !f.keptClear).map(f => f.id).join(', ') || `${fields.length} fields`);
    record(`${file}: tapping a field does not zoom the page (16px or more)`,
      fields.every(f => f.fontSize >= 16),
      fields.filter(f => f.fontSize < 16).map(f => `${f.id} ${f.fontSize}px`).join(', ') || 'all 16px+');
    record(`${file}: no script errors at phone width`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  /* ================= the desk width must not have moved ================= */
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
    await H.open(server, page, { file: 'admin.html', user: OWNER, handlers: HANDLERS, data: '{}' });
    await page.waitForTimeout(1200);
    const desk = await page.evaluate(() => {
      const bar = document.querySelector('.refnav-open-btn');
      const side = document.getElementById('refnav-host').getBoundingClientRect();
      return {
        hamburgerHidden: getComputedStyle(bar).display === 'none',
        sidebarLeft: Math.round(side.left),
        sidebarWidth: Math.round(side.width),
      };
    });
    record('at a desk the hamburger is not there at all', desk.hamburgerHidden);
    record('at a desk the menu is still a column down the left, not a drawer',
      desk.sidebarLeft === 0 && desk.sidebarWidth > 180, JSON.stringify(desk));
    await page.close();
  }

  await browser.close();
  server.close();

  console.log('\nTHE PHONE — 380×740, touch\n');
  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad++;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
  console.log(`\n${results.length - bad} of ${results.length} passed\n`);
  process.exit(bad ? 1 : 0);
})();
