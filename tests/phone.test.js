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
       This used to check that the price table scrolled inside its own box
       with its headings staying put. At a phone width there is no table any
       more -- a row is a card -- so that question moved to the desk-width
       check at the end of this file, where it is still the right one. */

    /* ---- A ROW IS A CARD, NOT A SQUEEZED TABLE ----
       Eight columns across 390px is unreadable however it is squeezed. Below
       the breakpoint the table is not on screen at all. */
    await H.go(page, 'price', 'REF');
    await page.waitForTimeout(900);
    const card = await page.evaluate(() => {
      const wrap = document.querySelector('.tbl-wrap');
      const list = document.getElementById('cards');
      const one = list.querySelector('.rc');
      const box = el => el ? el.getBoundingClientRect() : null;
      const party = box(one && one.querySelector('.rc-party'));
      const amt = box(one && one.querySelector('.rc-amt'));
      const cs = el => el ? getComputedStyle(el) : null;
      return {
        tableHidden: getComputedStyle(wrap).display === 'none',
        cards: list.querySelectorAll('.rc').length,
        partySize: party ? parseFloat(cs(one.querySelector('.rc-party')).fontSize) : 0,
        amtSize: amt ? parseFloat(cs(one.querySelector('.rc-amt')).fontSize) : 0,
        amtRightAligned: !!(party && amt) && (amt.right > party.right - 2),
        blocks: one ? one.querySelectorAll(':scope > .rc-top, :scope > .rc-item, :scope > .rc-money').length : 0,
        height: one ? Math.round(one.getBoundingClientRect().height) : 0,
        moreHidden: !!one && getComputedStyle(one.querySelector('.rc-more')).display === 'none',
      };
    });
    record('Busy price: the table is not on the screen at all — a row is a card',
      card.tableHidden && card.cards > 0, `${card.cards} cards`);
    record('Busy price: who it is, big enough to read at arm\'s length',
      card.partySize >= 15, `${card.partySize}px`);
    record('Busy price: the amount is large and right-aligned, so the eye can run down them',
      card.amtSize >= 15 && card.amtRightAligned, `${card.amtSize}px`);
    record('Busy price: the card is three lines, not eight columns',
      card.blocks === 3, `${card.blocks} blocks, ${card.height}px tall`);
    record('Busy price: and short enough that several fit on one screen',
      card.height > 0 && card.height < 140, `${card.height}px tall`);
    record('Busy price: everything else is behind a tap', card.moreHidden);

    await page.locator('#cards .rc').first().tap();
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => {
      const one = document.querySelector('#cards .rc');
      return {
        open: getComputedStyle(one.querySelector('.rc-more')).display !== 'none',
        holds: Array.from(one.querySelectorAll('.rc-k')).map(k => k.textContent.trim()),
      };
    });
    record('Busy price: tapping it shows the rest', opened.open, opened.holds.join(' · '));
    record('Busy price: and the rest is what a table column would have held',
      ['Type', 'Voucher', 'Year'].every(k => opened.holds.includes(k)), opened.holds.join(' · '));

    /* ---- THE DESCRIPTION IS NEVER HIDDEN ----
       These are Raghbir's own rows. "SKD CONVEYOR" at ₹3,25,000 read as a
       machine; the description said it was an extension of one by 38 feet.
       The card dropped it, because the description happened to contain the
       item name. Two more rows make the point: the same item at ₹6,65,000
       and ₹12,00,000, told apart only by "130 FEET LENGTH". */
    await page.evaluate(() => {
      const v = window.__TEST_DATA__['rpc:busy_search'];
      const base = (typeof v === 'function' ? v() : v)[0];
      const rows = [
        { party:'AVON NEWAGE CYCLES PVT.LTD', item:'SKD CONVEYOR',
          description:'Extension Charges of SKD Conveyor 38 Fee',
          qty:1, rate:325000, amount:325000, is_lump_sum:false, match_tier:2 },
        { party:'AVON CYCLES LTD', item:'SKD (CYCLE ASSEMBLY CONVEYOR)', description:null,
          qty:1, rate:665000, amount:665000, is_lump_sum:false, match_tier:1 },
        { party:'AVON CYCLES LTD', item:'SKD (CYCLE ASSEMBLY CONVEYOR)', description:'130 FEET LENGTH',
          qty:1, rate:1200000, amount:1200000, is_lump_sum:false, match_tier:1 },
        { party:'AVON CYCLES LTD', item:'MS PIPE 80X40X2.5', description:'MS PIPE 80X40X2.5',
          qty:1, rate:100, amount:100, is_lump_sum:false, match_tier:1 },
      ];
      window.__TEST_DATA__['rpc:busy_search'] = () => rows.map(r => Object.assign({}, base, r));
      window.__TEST_DATA__['rpc:busy_search_count'] = () => rows.length;
    });
    await page.locator('#q').fill('');
    await page.locator('#q').type('avon skd', { delay: 10 });
    await page.waitForTimeout(800);
    const desc = await page.evaluate(() => Array.from(document.querySelectorAll('#cards .rc'))
      .map(c => ({ item: c.querySelector('.rc-item').textContent.trim(),
                   desc: c.querySelector('.rc-desc') ? c.querySelector('.rc-desc').textContent.trim() : null })));
    record('Busy price: a description that adds to the item name is SHOWN on the card',
      desc[0] && desc[0].desc === 'Extension Charges of SKD Conveyor 38 Fee',
      desc[0] ? `${desc[0].item} | ${desc[0].desc}` : 'no card');
    record('Busy price: two rows with the same item name are told apart by it',
      desc[1] && desc[2] && desc[1].desc === null && desc[2].desc === '130 FEET LENGTH',
      JSON.stringify(desc.slice(1, 3)));
    record('Busy price: a description that is only the item written again is dropped',
      desc[3] && desc[3].desc === null, JSON.stringify(desc[3]));

    await page.locator('#cards .rc').first().tap();
    await page.waitForTimeout(300);
    const afterTap = await page.evaluate(() => {
      const c = document.querySelector('#cards .rc');
      const d = c.querySelector('.rc-desc');
      return { still: !!d && d.offsetParent !== null && d.textContent.trim(),
               keys: Array.from(c.querySelectorAll('.rc-k')).map(k => k.textContent.trim()) };
    });
    record('Busy price: EXPANDING the card does not take the description away',
      afterTap.still === 'Extension Charges of SKD Conveyor 38 Fee', String(afterTap.still));
    record('Busy price: and "Match" is not behind the tap — it is about the search, not the business',
      !afterTap.keys.includes('Match'), afterTap.keys.join(' · '));

    /* ---- THE FILTERS ---- */
    const filt = await page.evaluate(() => {
      const btn = document.querySelector('.filters-btn');
      const b = btn.getBoundingClientRect();
      return {
        onScreen: getComputedStyle(btn).display !== 'none',
        size: Math.round(b.width) + '×' + Math.round(b.height),
        says: btn.innerText.replace(/\s+/g, ' ').trim(),
        datesInBar: !!document.querySelector('.searchbar-end #from'),
        datesInSheet: document.querySelectorAll('#sheetDates input').length,
        chipsInSheet: !!document.querySelector('#sheetChips #docChips'),
        searchWidth: Math.round(document.querySelector('.searchbox').getBoundingClientRect().width),
        barWidth: Math.round(document.querySelector('.searchbar').getBoundingClientRect().width),
      };
    });
    record('Busy price: the filters are behind a button that says how many are on',
      filt.onScreen && /Filters/.test(filt.says), filt.says);
    record('Busy price: and the button is big enough to tap',
      parseInt(filt.size.split('×')[1], 10) >= 44, filt.size);
    record('Busy price: the date fields and tickboxes are IN the panel, not copied into it',
      !filt.datesInBar && filt.datesInSheet === 2 && filt.chipsInSheet,
      `${filt.datesInSheet} date fields, chips moved: ${filt.chipsInSheet}`);
    record('Busy price: the search box gets the full width',
      filt.searchWidth > filt.barWidth * 0.85, `${filt.searchWidth} of ${filt.barWidth}`);

    await page.locator('#filtersBtn').tap();
    await page.waitForTimeout(350);
    record('Busy price: the panel opens over the screen',
      await page.locator('#filterSheet').isVisible());
    const feet = await page.evaluate(() => ({
      apply: !!document.getElementById('filterApply'),
      clear: !!document.getElementById('filterClear'),
      h: Math.round(document.getElementById('filterApply').getBoundingClientRect().height),
      dates: Array.from(document.querySelectorAll('#sheetDates > div'))
        .map(d => Math.round(d.getBoundingClientRect().top)),
    }));
    record('Busy price: Apply and Clear are at the bottom, big enough to tap',
      feet.apply && feet.clear && feet.h >= 44, `${feet.h}px tall`);
    record('Busy price: the two date fields sit side by side, alone on their row',
      feet.dates.length === 2 && feet.dates[0] === feet.dates[1], JSON.stringify(feet.dates));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    record('Busy price: Escape closes the panel',
      !(await page.locator('#filterSheet').isVisible()));
    await page.locator('#filtersBtn').tap();
    await page.waitForTimeout(300);
    await page.locator('#filterSheet').tap({ position: { x: 195, y: 60 } });
    await page.waitForTimeout(300);
    record('Busy price: a tap outside closes it too',
      !(await page.locator('#filterSheet').isVisible()));

    record('no script errors anywhere in Busy Data at phone width',
      errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  /* ================= THE HEADER AND TAB PATTERNS =================
     Not two screens: two patterns. Every screen with actions in its header
     breaks the same way, and every tab strip breaks once there are more than
     three tabs. */
  {
    const { page } = await phonePage(server, browser, 'admin.html', null);

    // Nothing may be printed through anything else. The salary sheet had the
    // hamburger, "Back", the title, "Reset Columns" and "Save Draft" all in
    // one 390px row, overprinting each other.
    const overlaps = async () => page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const pick = Array.from(document.querySelectorAll(
        '.topbar *, .subtabs *, .panel-header *, button, a, select'))
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
        if (Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 3 &&
            Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 3) {
          hits.push((a.textContent || '').trim().slice(0, 16) + ' ↔ ' + (b.textContent || '').trim().slice(0, 16));
        }
      }
      return [...new Set(hits)].slice(0, 5);
    });

    const views = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#refnav-host button.refnav-item[data-view]')).map(b => b.dataset.view));
    let printedThrough = [];
    for (const v of views) {
      await H.go(page, v);
      await page.waitForTimeout(700);
      const tabs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.subtab-item')).filter(t => t.offsetParent)
          .map(t => t.dataset.tab || t.dataset.ddtab || t.textContent.trim()));
      const here = await overlaps();
      if (here.length) printedThrough.push(v + ': ' + here[0]);
      for (const t of tabs) {
        await page.evaluate(t => {
          const b = [...document.querySelectorAll('.subtab-item')]
            .find(x => (x.dataset.tab || x.dataset.ddtab || x.textContent.trim()) === t);
          if (b) b.click();
        }, t);
        await page.waitForTimeout(450);
        const inTab = await overlaps();
        if (inTab.length) printedThrough.push(v + ' › ' + t + ': ' + inTab[0]);
      }
    }
    record(`nothing is printed through anything else, on any ERP screen or tab (${views.length} screens)`,
      printedThrough.length === 0, printedThrough.slice(0, 4).join(' | '));

    // The tab strip scrolls inside itself, and the page does not move.
    // Km Tracker's four tabs are there whatever the data is.
    await H.go(page, 'km-tracker');
    await page.waitForTimeout(900);
    const strip = await page.evaluate(() => {
      const s = document.querySelector('#subtabsNav');
      if (!s) return { none: true };
      return { tabs: s.querySelectorAll('.subtab-item').length,
               scrolls: s.scrollWidth > s.clientWidth + 1,
               pageStill: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 };
    });
    record('a tab strip with more tabs than fit scrolls INSIDE itself, page still',
      !strip.none && strip.scrolls && strip.pageStill, JSON.stringify(strip));
    const chosen = await page.evaluate(() => {
      const s = document.querySelector('#subtabsNav');
      const tabs = [...s.querySelectorAll('.subtab-item')];
      s.scrollLeft = 0;
      tabs[tabs.length - 1].click();
      const a = s.querySelector('.subtab-item.active') || tabs[tabs.length - 1];
      const ab = a.getBoundingClientRect(), sb = s.getBoundingClientRect();
      return { label: a.textContent.trim(), onScreen: ab.left >= sb.left - 2 && ab.right <= sb.right + 2 };
    });
    record('and choosing a tab that is off the edge brings it into view',
      chosen.onScreen, `${chosen.label}: on screen ${chosen.onScreen}`);
    await page.close();
  }

  /* ================= SCREENS THAT CANNOT WORK ON A PHONE SAY SO ================= */
  {
    const { page } = await phonePage(server, browser, 'admin.html', null);
    // A person told to go and find a computer is owed the reason in the same
    // line, or it reads as the system being broken.
    for (const [view, words] of [['salary-calculator', 'wide screen'],
                                 ['admin-panel', 'read across']]) {
      await H.go(page, view);
      await page.waitForTimeout(800);
      const said = await page.evaluate(v => {
        const note = document.querySelector('#view-' + v + ' .desk-only-note');
        const body = document.querySelector('#view-' + v + ' .desk-only-hide');
        return { note: note ? note.textContent.trim() : null,
                 noteShown: !!note && note.offsetParent !== null,
                 bodyHidden: !!body && body.offsetParent === null };
      }, view);
      record(`${view}: says it needs a computer, says WHY, and shows nothing else`,
        said.noteShown && said.bodyHidden && new RegExp(words, 'i').test(said.note || '')
          && /computer/i.test(said.note || ''),
        said.note || 'no notice');
    }
    await page.close();
  }
  {
    // ...and at a desk they are the screens they always were.
    const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
    await H.open(server, page, { file: 'admin.html', user: OWNER, handlers: HANDLERS, data: '{}' });
    await page.waitForTimeout(1400);
    await H.go(page, 'salary-calculator');
    await page.waitForTimeout(900);
    const atDesk = await page.evaluate(() => {
      const note = document.querySelector('#view-salary-calculator .desk-only-note');
      const body = document.querySelector('#view-salary-calculator .desk-only-hide');
      return { noteHidden: !note || note.offsetParent === null, bodyShown: !!body && body.offsetParent !== null };
    });
    record('at a desk the salary sheet is the salary sheet, with no notice',
      atDesk.noteHidden && atDesk.bodyShown, JSON.stringify(atDesk));
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

    // The question that used to be asked at phone width, asked where the
    // table actually is.
    const deskPage = await browser.newPage({ viewport: { width: 1360, height: 800 } });
    await H.open(server, deskPage, { file: 'busy.html', user: OWNER, handlers: HANDLERS, data: JSON.stringify(BUSY) });
    await deskPage.waitForSelector('#shell', { state: 'visible' });
    await deskPage.waitForTimeout(1400);
    const deskTable = await deskPage.evaluate(() => {
      const w = document.querySelector('.tbl-wrap');
      w.scrollTop = 300;
      const th = document.querySelector('#headRow th');
      return {
        tableShown: getComputedStyle(w).display !== 'none',
        cardsHidden: getComputedStyle(document.getElementById('cards')).display === 'none',
        scrolledDown: w.scrollTop > 0,
        headingsStayed: Math.abs(th.getBoundingClientRect().top - w.getBoundingClientRect().top) < 4,
        pageWentSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    record('at a desk the table is what is on screen, and the cards are not',
      deskTable.tableShown && deskTable.cardsHidden, JSON.stringify(deskTable));
    record('at a desk the headings still stay put while the rows scroll under them',
      deskTable.scrolledDown && deskTable.headingsStayed && !deskTable.pageWentSideways,
      JSON.stringify(deskTable));

    /* ---- THE DESCRIPTION ON THE DESK TABLE ----
       One line with the whole of it on hover. Wrapped, it made every row three
       lines tall and pushed Rate and Amount off the right -- and those are the
       ones the eye runs down. */
    const descCol = await deskPage.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const i = heads.indexOf('Description');
      const td = document.querySelectorAll('#rows tr')[0].children[i];
      const clip = td.querySelector('.clip');
      const cs = clip ? getComputedStyle(clip) : null;
      const amt = document.querySelectorAll('#rows tr')[0].children[heads.indexOf('Amount')];
      return {
        oneLine: !!cs && cs.whiteSpace === 'nowrap' && cs.textOverflow === 'ellipsis',
        title: td.getAttribute('title'),
        fullTextStillThere: td.textContent.trim(),
        rowHeight: Math.round(document.querySelectorAll('#rows tr')[0].getBoundingClientRect().height),
        amountOnScreen: amt.getBoundingClientRect().right <= innerWidth + 1,
        columns: heads.length,
      };
    });
    record('at a desk the description is one line, clipped',
      descCol.oneLine, JSON.stringify({ oneLine: descCol.oneLine, rowHeight: descCol.rowHeight }));
    record('and the whole of it is on hover',
      !!descCol.title && descCol.title === descCol.fullTextStillThere, descCol.title);
    record('and Rate and Amount are still on the screen',
      descCol.amountOnScreen && descCol.columns === 11, `${descCol.columns} columns`);

    /* ---- THE LEDGER, AT A DESK ----
       The figures are Busy's own, checked to the rupee: Hindon Metaforms
       opens at 4,83,537 Cr, moves 5,72,804 Dr against 33,376 Cr, and closes
       at 41,250 Dr. What is asserted here is not the arithmetic -- the
       database does that and is tested there -- but that the screen SAYS
       WHICH WAY IT GOES on every line. A balance that crosses from Cr to Dr
       mid-year and does not say so is a number that has quietly changed
       meaning. */
    await H.go(deskPage, 'ledger', 'REF');
    await deskPage.waitForTimeout(700);
    await deskPage.evaluate(() => {
      const el = document.getElementById('lgParty');
      el.value = 'HINDON METAFORMS PVT.LTD';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await deskPage.waitForTimeout(900);
    const led = await deskPage.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#lgRows tr'));
      const balances = rows.map(r => r.cells[r.cells.length - 1].textContent.trim());
      const kpis = Array.from(document.querySelectorAll('#lgKpis .kpi'))
        .map(k => k.textContent.replace(/\s+/g, ' ').trim());
      return {
        rowCount: rows.length,
        everyBalanceSaysWhichWay: balances.every(b => !b || b === '0' || /Cr$|Dr$/.test(b)),
        crossesSides: balances.some(b => /Cr$/.test(b)) && balances.some(b => /Dr$/.test(b)),
        firstIsOpening: (rows[0] || {}).textContent ? /Opening/.test(rows[0].textContent) : false,
        lastIsClosing: /Closing/.test((rows[rows.length - 1] || {}).textContent || ''),
        closingSaysWord: kpis.some(k => /RECEIVABLE|PAYABLE/.test(k)),
        fourCards: kpis.length === 4,
        undatedSaidInWords: /undated opening/.test(document.getElementById('lgNotes').textContent),
      };
    });
    record('the ledger opens with an opening row and closes with a closing row',
      led.firstIsOpening && led.lastIsClosing, JSON.stringify(led));
    record('every running balance says Cr or Dr',
      led.everyBalanceSaysWhichWay && led.rowCount > 3, `${led.rowCount} rows`);
    record('and this party really does cross from Cr to Dr, so the suffix earns its place',
      led.crossesSides);
    record('four cards, and the closing one says PAYABLE or RECEIVABLE',
      led.fourCards && led.closingSaysWord);
    record('the undated opening entries are said in words, not dropped',
      led.undatedSaidInWords);

    /* ---- and no table anywhere is left without cards for a phone ---- */
    const phoneLedger = await browser.newPage(PHONE);
    await H.open(server, phoneLedger, { file: 'busy.html', user: OWNER, handlers: HANDLERS, data: JSON.stringify(BUSY) });
    await phoneLedger.waitForSelector('#shell', { state: 'visible' });
    await phoneLedger.waitForTimeout(1300);
    await H.go(phoneLedger, 'ledger', 'REF');
    await phoneLedger.waitForTimeout(700);
    await phoneLedger.evaluate(() => {
      const el = document.getElementById('lgParty');
      el.value = 'HINDON METAFORMS PVT.LTD';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await phoneLedger.waitForTimeout(900);
    const lp = await phoneLedger.evaluate(() => ({
      tableGone: getComputedStyle(document.querySelector('#view-ledger .tbl-wrap')).display === 'none',
      cards: document.getElementById('lgCards').children.length,
      cardsSayWhichWay: Array.from(document.querySelectorAll('#lgCards .rc-amt'))
        .every(a => /Cr$|Dr$/.test(a.textContent.trim()) || a.textContent.trim() === '0'),
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    record('on a phone the ledger is cards, not a squeezed table',
      lp.tableGone && lp.cards > 3 && !lp.sideways, JSON.stringify(lp));
    record('and every card carries Cr or Dr too', lp.cardsSayWhichWay);
    await phoneLedger.close();

    /* ---- A COLUMN WIDTH IS REMEMBERED, LIKE THE SHOW-AND-HIDE CHOICE ----
       Back to Price History first: the block above left this page on the
       ledger, and the grip being dragged belongs to the price table. */
    await H.go(deskPage, 'price', 'REF');
    await deskPage.waitForTimeout(900);
    const grip = await deskPage.locator('#headRow th[data-col="desc"] .colgrip').boundingBox();
    const was = await deskPage.evaluate(() =>
      Math.round(document.querySelector('#headRow th[data-col="desc"]').getBoundingClientRect().width));
    await deskPage.mouse.move(grip.x + 3, grip.y + 10);
    await deskPage.mouse.down();
    await deskPage.mouse.move(grip.x + 123, grip.y + 10, { steps: 8 });
    await deskPage.mouse.up();
    await deskPage.waitForTimeout(250);
    const dragged = await deskPage.evaluate(() => ({
      now: Math.round(document.querySelector('#headRow th[data-col="desc"]').getBoundingClientRect().width),
      stored: localStorage.getItem('ref-busy-column-widths'),
      clip: parseFloat(getComputedStyle(document.querySelector('#rows .desc .clip')).maxWidth),
    }));
    record('a column edge can be dragged to make it wider',
      dragged.now > was, `${was} → ${dragged.now}`);
    record('and the width is remembered for this person',
      !!dragged.stored && /desc/.test(dragged.stored), dragged.stored);
    record('and the clipped text never grows wider than its own column',
      dragged.clip < dragged.now, `clip ${dragged.clip} in a column of ${dragged.now}`);
    await deskPage.dblclick('#headRow th[data-col="desc"] .colgrip');
    await deskPage.waitForTimeout(250);
    const back = await deskPage.evaluate(() =>
      Math.round(document.querySelector('#headRow th[data-col="desc"]').getBoundingClientRect().width));
    record('and a double-click on the edge puts it back',
      Math.abs(back - was) <= 2, `${dragged.now} → ${back}, was ${was}`);
    await deskPage.close();
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
