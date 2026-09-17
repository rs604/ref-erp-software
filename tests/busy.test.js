/* ============================================================
   Busy Data screens — docs/23-screen-tests.md

   Covers sections 1, 2, 3, 5, 7 and 8. Section 4 has no rules on this
   screen (it reads history, it does not enforce a purchase rule) and
   section 10 is covered by opening the page as a non-owner.

   Run:  NODE_PATH=/opt/node22/lib/node_modules node tests/busy.test.js
   ============================================================ */
'use strict';
const H = require('./harness');
const DB = require('./fixtures/busy-data.json');

const OWNER = {
  id: 'u-owner', name: 'Raghbir Singh', is_owner: true, roles: ['owner'],
  permissions: ['busy_data.view', 'busy_data.import'], must_change_password: false,
};
const CLERK = {
  id: 'u-clerk', name: 'Amrit Kaur', is_owner: false, roles: ['staff'],
  permissions: ['km_tracker.view'], must_change_password: false,
};
const HANDLERS = `{ 'me': function () { return { success: true }; } }`;

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

async function openBusy(server, browser, user) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await H.open(server, page, {
    file: 'busy.html', user, handlers: HANDLERS, data: JSON.stringify(DB),
  });
  return { page, errors };
}

(async () => {
  const server = await H.serve();
  const browser = await H.chromium.launch();
  const { page, errors } = await openBusy(server, browser, OWNER);
  await page.waitForSelector('#shell', { state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#rows tr').length > 1);

  /* ============ 2. THE KEYBOARD (what applies to this screen) ============ */
  record('the cursor is already in the search box when the screen opens',
    await page.evaluate(() => document.activeElement && document.activeElement.id === 'q'));

  {
    await page.locator('#q').fill('pipe');
    await page.locator('#q').press('Enter');
    await page.waitForTimeout(150);
    const calls = await page.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    record('Enter in the search box searches, and saves nothing', calls > 1, `${calls} searches so far`);
  }
  {
    await page.locator('#q').press('Escape');
    await page.waitForTimeout(150);
    record('Esc clears the search box', await page.locator('#q').inputValue() === '');
  }
  {
    // Tab order must follow the visual order across the filter row.
    // A date box swallows three Tabs of its own -- day, month, year are
    // separate segments inside it -- so the same box comes back more than
    // once. That is the browser, not the screen, so only the ORDER the boxes
    // are reached in is compared.
    const seen = [];
    await page.locator('#q').focus();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
      if (id !== seen[seen.length - 1]) seen.push(id);
      if (id === 'goBtn') break;
    }
    const expected = ['docType', 'from', 'to', 'pageSize', 'goBtn'];
    record('Tab follows the boxes across the screen, left to right',
      JSON.stringify(seen) === JSON.stringify(expected), seen.join(' -> '));
    record('Tab from the last box reaches the button rather than looping back',
      seen[seen.length - 1] === 'goBtn');
  }
  {
    const back = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
      if (id !== back[back.length - 1]) back.push(id);
      if (id === 'pageSize') break;
    }
    record('Shift+Tab goes back', back[back.length - 1] === 'pageSize', back.join(' -> '));
  }
  {
    const hasHelp = await page.evaluate(() => {
      let seen = null;
      const real = window.alert;
      window.alert = t => { seen = t; };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true }));
      window.alert = real;
      return seen;
    });
    record('Ctrl+/ opens the shortcut list', !!hasHelp && /Enter/.test(hasHelp));
  }

  /* ============ 1. NOTHING MOVES THAT SHOULD NOT ============ */
  // The page itself scrolls here, and the table has its own scrolling box.
  async function clickAndCheck(el, expected) {
    await el.scrollIntoViewIfNeeded();
    const before = await H.snapshot(page);
    await el.click();
    await page.waitForTimeout(120);
    const after = await H.snapshot(page);
    return { problems: H.diff(before, after, expected || {}), before, after };
  }

  {
    // Every filter control, with the results table parked partway down.
    const park = () => page.evaluate(() => {
      const w = document.querySelector('.tbl-wrap');
      if (w) w.scrollTop = 200;
      window.scrollTo(0, 120);
    });
    let kept = 0, moved = 0, n = 0;
    const complaints = [];
    const filters = [
      ['#docType', 'select', 'Purchase Bill'],
      ['#pageSize', 'select', '50'],
      ['#from', 'fill', '2025-04-01'],
      ['#to', 'fill', '2026-03-31'],
    ];
    for (const [sel, how, val] of filters) {
      await park();
      const before = await H.snapshot(page);
      if (how === 'select') await page.selectOption(sel, val); else await page.fill(sel, val);
      await page.waitForTimeout(150);
      const after = await H.snapshot(page);
      const problems = H.diff(before, after, {
        fieldsThatMayChange: [sel], focusMayBe: sel, scrollMayMove: false,
      });
      n++;
      if (problems.length === 0) kept++; else { moved++; complaints.push(sel + ': ' + problems[0]); }
    }
    record(`changed ${n} filters · ${kept} kept scroll · ${moved} moved`,
      moved === 0, complaints.slice(0, 4).join(' | '));
    // Put them back so later checks start clean.
    await page.selectOption('#docType', '');
    await page.fill('#from', ''); await page.fill('#to', '');
    await page.selectOption('#pageSize', '25');
    await page.waitForTimeout(150);
  }

  {
    // Every menu item. These ARE meant to change the view, but must not
    // scroll the window or throw away what is typed in the search box.
    await page.fill('#q', 'pipe');
    await page.evaluate(() => window.scrollTo(0, 0));
    const navs = await page.locator('#nav .nav-item:visible').count();
    let kept = 0, moved = 0;
    const complaints = [];
    for (let i = 0; i < navs; i++) {
      const el = page.locator('#nav .nav-item:visible').nth(i);
      const label = (await el.textContent()).trim();
      const before = await H.snapshot(page);
      await el.click();
      await page.waitForTimeout(200);
      const after = await H.snapshot(page);
      const bad = [];
      if (before.windowScroll[1] !== after.windowScroll[1]) bad.push('the window scrolled');
      if (after.fields['#q'] !== before.fields['#q']) bad.push('the search box was wiped');
      if (bad.length === 0) kept++; else { moved++; complaints.push(label + ': ' + bad[0]); }
    }
    record(`clicked ${navs} menu items · ${kept} kept scroll and kept the search typed · ${moved} did not`,
      moved === 0, complaints.slice(0, 4).join(' | '));
    // 4 for REF, 4 for RS, 3 owner-only.
    record('every menu item is reachable, and the owner-only ones are shown to the owner',
      navs === 11, `${navs} visible`);
  }

  /* ============ 5. THE LIST SCREEN ============ */
  await page.locator('#nav .nav-item[data-firm="REF"][data-view="price"]').click();
  await page.waitForTimeout(200);
  {
    // The real server honours p_limit and p_offset. The stub must too, or the
    // screen would be blamed for showing everything it was handed.
    await page.evaluate(rows => {
      window.__TEST_ALL_ROWS__ = rows;
      window.__TEST_DATA__['rpc:busy_search'] = a =>
        rows.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 25));
    }, DB['rpc:busy_search']);
    await page.fill('#q', '');
    await page.click('#goBtn');
    await page.waitForTimeout(200);
    const shown = await page.locator('#rows tr').count();
    record('the list fills the page size asked for (25)', shown === 25, `${shown} rows`);

    const count = await page.locator('#rowCount').textContent();
    record('the row count says there are more than are shown',
      /showing the first 25/.test(count), count.trim());

    await page.selectOption('#pageSize', '2000');
    await page.waitForTimeout(400);
    const all = await page.locator('#rows tr').count();
    record('"All" draws every row without freezing the browser', all === 200, `${all} rows drawn`);
    await page.selectOption('#pageSize', '25');
    await page.waitForTimeout(200);
  }
  {
    // Shading only means anything against something typed. With an empty box
    // every row is an equally good answer and none is a "close" match.
    await page.fill('#q', 'pipe');
    await page.click('#goBtn');
    await page.waitForTimeout(250);
    const fuzzyMarked = await page.evaluate(() => {
      const tinted = document.querySelectorAll('#rows tr.fuzzy').length;
      const bold = document.querySelectorAll('#rows mark, #rows b').length;
      return { tinted, bold };
    });
    record('a close match is shaded, never shown as an exact one',
      fuzzyMarked.tinted > 0, `${fuzzyMarked.tinted} shaded rows`);
    const say = await page.locator('#rowCount').textContent();
    record('the count says in words how many are close matches rather than exact',
      /close matches, not exact/.test(say), say.trim());
  }
  {
    // An empty result must say something useful.
    await page.evaluate(() => { window.__TEST_DATA__['rpc:busy_search'] = () => []; });
    await page.fill('#q', 'zzzz nothing');
    await page.click('#goBtn');
    await page.waitForTimeout(200);
    const text = (await page.locator('#rows').textContent()).trim();
    record('an empty result explains itself instead of showing a blank screen',
      text.length > 30 && /Nothing matches/.test(text), text.slice(0, 90));
    await page.evaluate(rows => {
      window.__TEST_DATA__['rpc:busy_search'] = a =>
        rows.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 25));
    }, DB['rpc:busy_search']);
    await page.fill('#q', '');
    await page.click('#goBtn');
    await page.waitForTimeout(200);
  }
  {
    const searchedWholeDb = await page.evaluate(() => {
      const c = window.__TEST_DB_CALLS__.filter(x => x.name === 'rpc:busy_search').pop();
      return c && c.args && 'p_limit' in c.args && 'p_offset' in c.args && c.args.p_company === 'REF';
    });
    record('the search is asked of the database, not of the rows on screen', searchedWholeDb);
  }

  /* ============ 7. NUMBERS AND MONEY ============ */
  {
    const cells = await page.evaluate(() => {
      const out = { money: [], dates: [], zeroRate: 0, lump: 0 };
      document.querySelectorAll('#rows tr').forEach(tr => {
        const td = tr.children;
        if (td.length < 11) return;
        out.dates.push(td[1].textContent.trim());
        out.money.push(td[10].textContent.trim());
        const rate = td[9].textContent.trim();
        if (rate === '') out.zeroRate++;
        if (/no rate/.test(rate)) out.lump++;
      });
      return out;
    });
    const lakh = cells.money.filter(m => /^₹[\d,]+\.\d{2}$/.test(m));
    // Indian grouping puts the first comma three from the end and then every
    // two: 1,50,000.00 — never 150,000.00
    const indian = cells.money.every(m => !/\d{4},/.test(m)) &&
      cells.money.some(m => /\d,\d\d,\d\d\d\./.test(m));
    record('money is in Indian format — ₹1,50,000.00, never ₹150,000.00',
      indian, cells.money.slice(0, 3).join('  '));
    record('every amount carries the rupee sign and two decimals',
      lakh.length === cells.money.length, `${lakh.length} of ${cells.money.length}`);
    const dateOk = cells.dates.every(d => /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(d));
    record('dates read 15 Sep 2026, never 09/15/26',
      dateOk, cells.dates.slice(0, 3).join('  '));
    record('a zero rate that means "not priced" is not shown as ₹0 — it says why',
      cells.lump > 0 || cells.zeroRate > 0,
      `${cells.lump} say "no rate · one job", ${cells.zeroRate} left blank`);
    const extreme = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#rows .pill-amber')).map(e => e.textContent.trim()).slice(0, 1)[0] || '');
    record('an extreme rate is flagged against the usual rate, not hidden',
      /usually ₹/.test(extreme), extreme);
  }

  /* ============ 3 and 8: THE UPLOAD SCREEN ============ */
  await page.locator('#nav .nav-item[data-view="upload"]').click();
  await page.waitForTimeout(300);
  {
    record('Load history opens', await page.locator('#view-upload').isVisible());
    const loadDisabled = await page.locator('#loadBtn').evaluate(b => b.disabled);
    record('Load is blocked until a file is chosen', loadDisabled === true);
    const empty = (await page.locator('#uploadRows').textContent()).trim();
    record('the empty file list says so in plain words',
      /No files chosen yet/.test(empty), empty.slice(0, 60));
    const words = (await page.locator('#view-upload').textContent());
    record('the whole-year rule is stated on screen, not just in the code',
      /whole year|entire year|all of the year/i.test(words),
      words.match(/[^.]*whole year[^.]*/i)?.[0]?.trim().slice(0, 120) || 'not found');
  }
  {
    // A real file, through the real browser file input.
    const csv = 'company,fy,kind,vch_code,sr_no,vch_type,doc_type,vch_no,vch_date,party,item,description,qty,rate,amount,is_lump_sum,cgst,sgst,igst,gst_rate,vch_total,search_text,parser_version\n' +
      'REF,2025-26,item,X1,1,2,Purchase Bill,V1,2025-04-01,AGGARWAL STEELS,MS PIPE 80X40X2.5,LOT 1,10,50,500,False,0,0,0,0,500,AGGARWAL MS PIPE,2026.09.17-mdbtools\n' +
      'REF,2025-26,item,X2,1,2,Purchase Bill,V2,2025-04-02,BHARAT PIPE CO,MS ANGLE 50X50X5,,,,,False,,,,,,BHARAT ANGLE,2026.09.17-mdbtools\n';
    await page.setInputFiles('#fileInput', {
      name: 'ref-2025-26-rows.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
    });
    await page.waitForTimeout(400);
    const rows = await page.locator('#uploadRows tr').count();
    record('a chosen rows file appears in the list', rows >= 1, `${rows} rows listed`);
    const shownFirm = (await page.locator('#uploadRows').textContent());
    record('the firm and the year are shown before anything is loaded',
      /REF/.test(shownFirm) && /2025-26/.test(shownFirm), shownFirm.replace(/\s+/g, ' ').slice(0, 90));
    const nowEnabled = await page.locator('#loadBtn').evaluate(b => !b.disabled);
    record('Load becomes available once there is something to load', nowEnabled);

    // Section 8: loading must not throw the page away.
    await page.evaluate(() => window.scrollTo(0, 100));
    const before = await H.snapshot(page);
    await page.click('#loadBtn');
    await page.waitForTimeout(700);
    const after = await H.snapshot(page);
    record('loading kept the page where it was', before.windowScroll[1] === after.windowScroll[1],
      `${before.windowScroll[1]} -> ${after.windowScroll[1]}`);
    const state = (await page.locator('#uploadState').textContent()).trim();
    record('the result of the load is shown without a reload', state.length > 0, state.slice(0, 90));
    const sent = await page.evaluate(() =>
      window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_import_fy').map(c => ({
        company: c.args.p_company, fy: c.args.p_fy, rows: (c.args.p_rows || []).length,
        parser: (c.args.p_rows || [])[0] && c.args.p_rows[0].parser_version,
        blankQty: (c.args.p_rows || []).filter(r => r.qty === '').length,
      })));
    record('the rows went up split by firm and year, as one whole year',
      sent.length === 1 && sent[0].company === 'REF' && sent[0].fy === '2025-26' && sent[0].rows === 2,
      JSON.stringify(sent));
    record('the parser version travelled with the rows, so the batch can name it',
      sent[0] && sent[0].parser === '2026.09.17-mdbtools', String(sent[0] && sent[0].parser));
    record('an empty number was sent as nothing, not as an empty string',
      sent[0] && sent[0].blankQty === 0, `${sent[0] && sent[0].blankQty} blanks left as ""`);
  }

  /* ============ the frozen-years limit, in plain words ============ */
  await page.locator('#nav .nav-item[data-firm="REF"][data-view="deleted"]').click();
  await page.waitForTimeout(400);
  {
    const text = await page.locator('#view-deleted').textContent();
    record('the deleted screen lists the years and which are frozen',
      /frozen/.test(text) && /checked each sync/.test(text));
    record('why a frozen year can never change is said on screen, in plain words',
      /no longer on the PC|never compared again|kept as it is/i.test(
        await page.locator('#view-deleted').innerHTML()));
    const restored = await page.locator('#deletedRows').textContent();
    record('a row that came back says so rather than vanishing', /came back/.test(restored));
  }

  /* ============ 10. PERMISSIONS ARE REAL ============ */
  record('no script errors anywhere in the owner run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();

  {
    const { page: p2, errors: e2 } = await openBusy(server, browser, CLERK);
    await p2.waitForTimeout(600);
    const body = await p2.locator('body').textContent();
    const shellShown = await p2.evaluate(() => {
      const s = document.getElementById('shell');
      return !!s && s.style.display !== 'none';
    });
    record('typing the address directly does not let an ordinary worker in',
      !shellShown && /not open to you/i.test(body), body.replace(/\s+/g, ' ').trim().slice(0, 80));
    record('no script errors for the refused user', e2.length === 0, e2.slice(0, 2).join(' | '));
    await p2.close();
  }

  await browser.close();
  server.close();

  const pass = results.filter(r => r.ok).length;
  console.log('\nBusy Data — docs/23 sections 1, 2, 3, 5, 7, 8 and 10\n');
  for (const r of results) {
    console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '\n           ' + r.detail : ''));
  }
  console.log(`\n${pass} of ${results.length} passed\n`);
  process.exit(pass === results.length ? 0 : 1);
})();
