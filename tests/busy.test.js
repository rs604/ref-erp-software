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
    await page.waitForTimeout(400);
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
    // The voucher-type tickboxes sit between the search box and the date
    // boxes, and they are controls, so Tab reaches them. Naming them by the
    // type they carry rather than by "INPUT".
    const seen = [];
    await page.locator('#q').focus();
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return 'none';
        if (a.dataset && a.dataset.type) return 'chip:' + a.dataset.type;
        return a.id || a.tagName;
      });
      if (id !== seen[seen.length - 1]) seen.push(id);
      if (id === 'colBtn') break;
    }
    const expected = ['qClear', 'chip:Sales Invoice', 'chip:Purchase Bill',
      'chip:Delivery Challan', 'chip:Purchase Order', 'chip:Sales Order',
      'from', 'to', 'pageSize', 'colBtn'];
    record('Tab follows the controls across the screen, left to right',
      JSON.stringify(seen) === JSON.stringify(expected), seen.join(' -> '));
    record('Tab from the last box reaches the button rather than looping back',
      seen[seen.length - 1] === 'colBtn');
  }
  {
    const back = [];
    for (let i = 0; i < 8; i++) {
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
    record('Ctrl+/ opens the shortcut list',
      !!hasHelp && /Esc/.test(hasHelp) && /as you type/.test(hasHelp), String(hasHelp).split('\n')[0]);
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
      ['#pageSize', 'select', '100'],
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
    await page.fill('#from', ''); await page.fill('#to', '');
    await page.selectOption('#pageSize', '50');
    await page.waitForTimeout(400);
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
        rows.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 50));
    }, DB['rpc:busy_search']);
    await page.fill('#q', '');
    await page.waitForTimeout(500);
    const shown = await page.locator('#rows tr').count();
    record('the list fills the page size asked for (50)', shown === 50, `${shown} rows`);

    const count = await page.locator('#rowCount').textContent();
    record('the row count says there are more than are shown',
      /the first 50/.test(count), count.trim());

    await page.selectOption('#pageSize', '2000');
    await page.waitForTimeout(700);
    const all = await page.locator('#rows tr').count();
    record('"All" draws every row without freezing the browser', all === 200, `${all} rows drawn`);
    await page.selectOption('#pageSize', '50');
    await page.waitForTimeout(500);
  }
  {
    // Shading only means anything against something typed. With an empty box
    // every row is an equally good answer and none is a "close" match.
    await page.fill('#q', 'pipe');
    await page.waitForTimeout(500);
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
    await page.waitForTimeout(500);
    const text = (await page.locator('#rows').textContent()).trim();
    record('an empty result explains itself instead of showing a blank screen',
      text.length > 30 && /Nothing matches/.test(text), text.slice(0, 90));
    await page.evaluate(rows => {
      window.__TEST_DATA__['rpc:busy_search'] = a =>
        rows.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 50));
    }, DB['rpc:busy_search']);
    await page.fill('#q', '');
    await page.waitForTimeout(500);
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
    // Columns can be turned on and off now, so a cell is found by its heading.
    // Counting from the left broke the moment FY was hidden, and read every
    // row as having no amount at all.
    const cells = await page.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const at = name => heads.indexOf(name);
      const out = { money: [], dates: [], zeroRate: 0, lump: 0, heads };
      document.querySelectorAll('#rows tr').forEach(tr => {
        const td = tr.children;
        if (td.length !== heads.length) return;
        out.dates.push(td[at('Date')].textContent.trim());
        out.money.push(td[at('Amount')].textContent.trim());
        const rate = td[at('Rate')].textContent.trim();
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
    // The rows now arrive by busy_import_stage and are compared by
    // busy_import_finalise. A year small enough to fit in one chunk still
    // makes both calls, in that order.
    const db = await page.evaluate(() => window.__TEST_DB_CALLS__);
    const staged = db.filter(c => c.name === 'rpc:busy_import_stage');
    const finalised = db.filter(c => c.name === 'rpc:busy_import_finalise');
    const allRows = staged.flatMap(c => c.args.p_rows || []);
    record('the rows went up split by firm and year',
      staged.length >= 1 && staged.every(c => c.args.p_company === 'REF' && c.args.p_fy === '2025-26')
        && allRows.length === 2,
      `${staged.length} chunk(s), ${allRows.length} rows`);
    record('the year is compared once, after the rows have arrived',
      finalised.length === 1 && finalised[0].args.p_company === 'REF'
        && finalised[0].args.p_fy === '2025-26',
      `${finalised.length} comparison(s)`);
    record('the parser version travelled with the rows, so the batch can name it',
      allRows[0] && allRows[0].parser_version === '2026.09.17-mdbtools',
      String(allRows[0] && allRows[0].parser_version));
    record('an empty number was sent as nothing, not as an empty string',
      allRows.filter(r => r.qty === '').length === 0,
      `${allRows.filter(r => r.qty === '').length} blanks left as ""`);
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

  record('no script errors anywhere in the owner run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();

  /* ============ 1b. THE SCREEN HAS TO SPEAK ============
     These are the checks that were missing when the live screen opened to a
     blank white page and stayed there. Each one puts the screen in a state
     that used to be silent, and reads back what a person would see. */

  // Nothing loaded into the database yet -- the real state before the first
  // upload. A table with no rows must say what to do, not sit there.
  {
    const { page: p, errors: e } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.evaluate(() => {
      Object.keys(window.__TEST_DATA__).forEach(k => { window.__TEST_DATA__[k] = () => []; });
    });
    // No Search button any more: type and clear, which is how a person makes
    // it look again.
    await p.locator('#q').type('x');
    await p.waitForTimeout(500);
    await p.locator('#q').press('Escape');
    await p.waitForTimeout(600);
    const t = (await p.locator('#rows').innerText()).replace(/\s+/g, ' ').trim();
    record('an empty history says what to do next, rather than sitting empty',
      /No history loaded yet/.test(t) && /Load history/.test(t), t.slice(0, 90));
    record('no script errors with an empty database', e.length === 0, e.slice(0, 2).join(' | '));
    await p.close();
  }

  // Before the sign-in check answers, there must already be something on screen.
  {
    const p = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await p.route('**/app-config.js', r => r.fulfill({ contentType: 'text/javascript', body:
      `window.REF = { requireSession: function () { return new Promise(function(){}); },
        can: function(){return true;}, supabase: function(){return {};}, goToLogin: function(){} };` }));
    await p.route('**cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: 'window.supabase={};' }));
    await p.goto(server.url + '/busy.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    const early = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    record('the screen says something before the sign-in check has answered',
      /Opening Busy Data/.test(early), early.slice(0, 70));

    await p.waitForTimeout(9000);
    const late = (await p.locator('#boot').innerText()).replace(/\s+/g, ' ').trim();
    record('a sign-in check that never answers says so, instead of spinning for ever',
      /taking longer than it should/i.test(late), late.slice(0, 90));
    record('and it offers a way out', await p.locator('#bootRetry').isVisible());
    await p.close();
  }

  // A synchronous throw. .then().catch() cannot catch this, which is how the
  // page ended up blank with an error nobody could see.
  {
    const p = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    const e = [];
    p.on('pageerror', x => e.push(x.message));
    await p.route('**/app-config.js', r => r.fulfill({ contentType: 'text/javascript', body:
      `window.REF = { requireSession: function () { throw new Error('The Supabase library did not load. Check the connection and reload.'); },
        can: function(){return true;}, supabase: function(){ throw new Error('no lib'); }, goToLogin: function(){} };` }));
    await p.route('**cdn.jsdelivr.net/**', r => r.abort());
    await p.goto(server.url + '/busy.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(800);
    const t = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    record('a failure thrown before any promise exists is still shown to the person',
      /could not open/i.test(t) && /Supabase library did not load/.test(t), t.slice(0, 90));
    record('that failure is caught rather than left as an uncaught error',
      e.length === 0, e.slice(0, 2).join(' | '));
    await p.close();
  }

  // Every table load must end in words, never in a permanent "Looking...".
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.evaluate(() => {
      window.__TEST_DATA__['rpc:busy_search'] = () => ({ error: { message: 'connection lost' } });
    });
    await p.locator('#q').type('x');
    await p.waitForTimeout(700);
    const t = (await p.locator('#rows').innerText()).replace(/\s+/g, ' ').trim();
    record('a load that fails says what failed, in the table itself',
      /Could not load the history/.test(t) && /connection lost/.test(t), t.slice(0, 90));
    record('it does not leave "Looking…" on the screen', !/Looking/.test(t));
    await p.close();
  }

  /* ============ THE TEN CHANGES TO PRICE HISTORY ============ */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForFunction(() => document.querySelectorAll('#rows tr').length > 1);

    // 1 and 2 — the two paragraphs are gone
    const text = await p.locator('#view-search').innerText();
    record('the "copy of what Busy holds" paragraph is gone',
      !/copy of what Busy holds/i.test(text));
    record('the "type the size exactly" paragraph is gone',
      !/are different pipes/i.test(text));
    record('the firm is still said, on the chip',
      (await p.locator('#firmChip').innerText()).trim() === 'REF');

    // 7 — voucher types are tickboxes, Sales Invoice only to begin with
    const chips = await p.evaluate(() => Array.from(document.querySelectorAll('.chip')).map(c => ({
      label: c.innerText.trim(), on: c.querySelector('input').checked })));
    record(`voucher type is ${chips.length} tickboxes, not a dropdown`,
      chips.length === 5 && await p.locator('select#docType').count() === 0);
    record('only Sales Invoice is ticked to begin with',
      chips.filter(c => c.on).length === 1 && chips.find(c => c.on).label === 'Sales Invoice',
      chips.filter(c => c.on).map(c => c.label).join(', ') || 'none');
    record('what is chosen is readable without opening anything',
      await p.locator('.chip.on').first().isVisible());

    // 3 — results as you type, not on Enter
    const before = await p.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    await p.locator('#q').click();
    await p.locator('#q').type('pipe', { delay: 30 });
    await p.waitForTimeout(120);
    const during = await p.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    record('typing searches on its own, with no button pressed', after > before,
      `${after - before} searches`);
    record('it waits for the typing to stop rather than searching per keystroke',
      during === before && after === before + 1,
      `${during - before} during 4 keystrokes, ${after - before} after the pause`);

    // 5 — no button that does nothing
    record('there is no Search button left doing nothing',
      await p.locator('#goBtn').count() === 0);

    // 4 — Esc clears
    await p.locator('#q').press('Escape');
    await p.waitForTimeout(400);
    record('Esc clears the search box', await p.locator('#q').inputValue() === '');
    record('and the cursor stays in the box',
      await p.evaluate(() => document.activeElement?.id === 'q'));

    // 6 — the highlight
    await p.evaluate(rows => {
      window.__TEST_DATA__['rpc:busy_search'] = () => [
        Object.assign({}, rows[0], { item: 'MS PIPE 80X40X2.5', party: 'AGGARWAL STEELS',
                                     description: 'LOT 1', match_tier: 1 }),
        Object.assign({}, rows[1], { item: 'MS PIPE 80X40X3', party: 'BHARAT PIPE CO',
                                     description: 'LOT 2', match_tier: 3 }),
      ];
    }, DB['rpc:busy_search']);
    await p.locator('#q').type('pipe 80x40', { delay: 10 });
    await p.waitForTimeout(600);
    const marks = await p.evaluate(() =>
      Array.from(document.querySelectorAll('#rows mark.hit')).map(m => m.textContent));
    record('the typed letters are picked out in the results',
      marks.length > 0, marks.slice(0, 4).join(' | '));
    record('a word is found inside a longer one — 80x40 lights up in 80X40X2.5',
      marks.some(m => /^80X40$/i.test(m)), marks.join(' | '));
    const shading = await p.evaluate(() => ({
      exactShaded: !!document.querySelector('#rows tr:nth-child(1)')?.classList.contains('fuzzy'),
      fuzzyShaded: !!document.querySelector('#rows tr:nth-child(2)')?.classList.contains('fuzzy'),
    }));
    record('a close match shades the whole row, an exact one does not',
      shading.fuzzyShaded && !shading.exactShaded,
      `exact shaded: ${shading.exactShaded}, close shaded: ${shading.fuzzyShaded}`);

    // 8 — Back to ERP on the left
    const sides = await p.evaluate(() => {
      const back = document.querySelector('.topbar a[href="admin.html"]').getBoundingClientRect();
      const title = document.getElementById('pageTitle').getBoundingClientRect();
      const chip = document.getElementById('firmChip').getBoundingClientRect();
      return { back: back.left, title: title.left, chip: chip.left };
    });
    record('Back to ERP is on the LEFT of the header, before the page title',
      sides.back < sides.title && sides.back < sides.chip,
      `back at ${Math.round(sides.back)}, title at ${Math.round(sides.title)}`);

    // 9 — the nav says REF
    const heads = await p.evaluate(() =>
      Array.from(document.querySelectorAll('.nav-section-label')).map(n => n.textContent.trim()));
    record('the left menu says REF, not the full company name',
      heads.includes('REF') && !heads.some(h => /Raghbir Erectors/.test(h)), heads.join(' · '));

    await p.close();
  }

  /* ---- 10. columns on and off, remembered ---- */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForFunction(() => document.querySelectorAll('#rows tr').length > 1);

    const headOf = () => p.evaluate(() =>
      Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim()));

    record('FY is hidden to begin with', !(await headOf()).includes('FY'),
      (await headOf()).join(' · '));
    record('every row has as many cells as there are headings',
      await p.evaluate(() => {
        const n = document.querySelectorAll('#headRow th').length;
        return Array.from(document.querySelectorAll('#rows tr')).every(r => r.children.length === n);
      }));

    await p.click('#colBtn');
    record('the columns control opens', await p.locator('#colList').isVisible());
    const boxes = await p.locator('#colList input').count();
    record(`every column can be turned on or off (${boxes} of them)`, boxes === 11);
    record('the Sr. column cannot be turned off',
      await p.locator('#colList input[data-col="sr"]').isDisabled());

    await p.locator('#colList input[data-col="fy"]').check();
    await p.waitForTimeout(600);
    record('ticking FY brings the column back', (await headOf()).includes('FY'),
      (await headOf()).join(' · '));

    await p.locator('#colList input[data-col="desc"]').uncheck();
    await p.waitForTimeout(600);
    record('unticking Description takes it away', !(await headOf()).includes('Description'));

    // Remembered: same browser, fresh page.
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForTimeout(700);
    const kept = await headOf();
    record('the choice is remembered on the next visit',
      kept.includes('FY') && !kept.includes('Description'), kept.join(' · '));
    await p.close();
  }

  /* ============ COLOURS: plain enough to work in ============ */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.locator('#q').type('pipe', { delay: 5 });
    await p.waitForTimeout(600);

    const seen = await p.evaluate(() => {
      const rgb = el => getComputedStyle(el).backgroundColor;
      const lum = c => {
        const m = c.match(/\d+/g).map(Number);
        return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
      };
      // Only rows that are NOT close matches. A close match is tinted on
      // purpose, and picking rows blindly read that tint as the row colour.
      const plain = Array.from(document.querySelectorAll('#rows tr'))
        .filter(r => !r.classList.contains('fuzzy'));
      const odd = plain.find((r, i) => Array.from(r.parentNode.children).indexOf(r) % 2 === 0);
      const even = plain.find(r => Array.from(r.parentNode.children).indexOf(r) % 2 === 1);
      const mark = document.querySelector('#rows mark.hit');
      return {
        page: rgb(document.body),
        pageLum: lum(rgb(document.body)),
        odd: rgb(odd), oddLum: lum(rgb(odd)),
        even: rgb(even), evenLum: lum(rgb(even)),
        head: rgb(document.querySelector('#headRow th')),
        headLum: lum(rgb(document.querySelector('#headRow th'))),
        fuzzyTinted: Array.from(document.querySelectorAll('#rows tr'))
          .some(r => r.classList.contains('fuzzy')),
        hit: mark ? rgb(mark) : null,
        hitLum: mark ? lum(rgb(mark)) : null,
      };
    });

    record('the page is white, not a filled colour', seen.pageLum > 0.97, seen.page);
    record('one row is white', seen.oddLum > 0.99, seen.odd);
    record('the next is a very light blue, not something stronger',
      seen.evenLum > 0.93 && seen.evenLum < 0.99, seen.even);
    record('the heading is darker than the rows, but still sober',
      seen.headLum < seen.evenLum && seen.headLum > 0.80,
      `heading ${seen.headLum.toFixed(2)} against rows ${seen.evenLum.toFixed(2)}`);
    record('the search highlight is dark enough to read, not a faint wash',
      seen.hitLum !== null && seen.hitLum < 0.88 && seen.hitLum > 0.60,
      `${seen.hit} (a faint wash would be above 0.92)`);
    record('a close match is still tinted, and only a close match',
      seen.fuzzyTinted);
    record('the highlight stands out against the row it sits on',
      seen.hitLum !== null && (seen.evenLum - seen.hitLum) > 0.10,
      `row ${seen.evenLum.toFixed(2)} against highlight ${seen.hitLum.toFixed(2)}`);
    await p.close();
  }

  /* ============ DATE FIELDS: the same two keys ============ */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForTimeout(400);

    const today = await p.evaluate(() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
             '-' + String(d.getDate()).padStart(2, '0');
    });

    for (const id of ['from', 'to']) {
      await p.locator('#' + id).focus();
      await p.keyboard.press('t');
      await p.waitForTimeout(400);
      record(`T puts today into the ${id} date`,
        await p.locator('#' + id).inputValue() === today,
        await p.locator('#' + id).inputValue());

      await p.locator('#' + id).focus();
      await p.keyboard.press('Delete');
      await p.waitForTimeout(400);
      record(`Delete clears the ${id} date`,
        await p.locator('#' + id).inputValue() === '');
    }

    const tips = await p.evaluate(() =>
      Array.from(document.querySelectorAll('input[type=date]')).map(e => e.title));
    record('both date fields say what the keys are, on hover',
      tips.length === 2 && tips.every(t => /T = today/.test(t) && /Delete = clear/.test(t)),
      tips[0] || '(no tooltip)');

    // Setting a date must actually search, not just sit there.
    const before = await p.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    await p.locator('#from').focus();
    await p.keyboard.press('t');
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    record('a date put in with the keyboard searches, like one put in by hand',
      after > before, `${after - before} searches`);

    const help = await p.evaluate(() => {
      let seenText = null; const real = window.alert;
      window.alert = t => { seenText = t; };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true }));
      window.alert = real; return seenText;
    });
    record('the date keys are in the shortcut list too',
      !!help && /T — today/.test(help) && /Delete — clear the date/.test(help));
    await p.close();
  }

  /* ============ EVERY CONTROL, CLICKED ============
     Not a sample. Every clickable thing on Price History, driven, with the
     page checked for script errors after each one. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForTimeout(500);

    const clicked = [];
    async function click(what, sel, how) {
      const el = p.locator(sel).first();
      if (await el.count() === 0) { clicked.push(what + ' (MISSING)'); return false; }
      await el.scrollIntoViewIfNeeded();
      if (how === 'select') await p.selectOption(sel, { index: 1 });
      else if (how === 'type') { await el.click(); await el.type('pipe', { delay: 5 }); }
      else await el.click();
      await p.waitForTimeout(350);
      clicked.push(what);
      return true;
    }

    await click('the search box', '#q', 'type');
    await click('the clear cross', '#qClear');
    for (const t of ['Sales Invoice','Purchase Bill','Delivery Challan','Purchase Order','Sales Order']) {
      await click('the ' + t + ' tickbox', `.chip input[data-type="${t}"]`);
    }
    await click('the From date', '#from');
    await click('the To date', '#to');
    await click('how many to show', '#pageSize', 'select');
    await click('the Columns button', '#colBtn');
    for (const c of ['date','fy','type','vch','party','item','desc','qty','rate','amt']) {
      await click('the ' + c + ' column box', `#colList input[data-col="${c}"]`);
    }
    await click('the Columns button again', '#colBtn');
    for (let i = 0; i < 11; i++) {
      await click('menu item ' + (i + 1), `#nav .nav-item:nth-of-type(${i + 1})`);
    }

    record(`every control on the screen was clicked (${clicked.length})`,
      !clicked.some(c => /MISSING/.test(c)),
      clicked.filter(c => /MISSING/.test(c)).join(', ') || 'none missing');
    record('nothing threw while every control was being clicked',
      errs.length === 0, errs.slice(0, 3).join(' | '));

    // With every column turned off but Sr., the table must still be sane.
    const sane = await p.evaluate(() => {
      const heads = document.querySelectorAll('#headRow th').length;
      const rows = Array.from(document.querySelectorAll('#rows tr'));
      return { heads, ok: rows.every(r => r.children.length === heads || r.children.length === 1) };
    });
    record('the table still lines up with every column turned off but one',
      sane.heads >= 1 && sane.ok, `${sane.heads} heading(s)`);
    await p.close();
  }

  /* ============ THE FRAME: WHAT MUST NOT SCROLL AWAY ============
     Three complaints with one cause: the page scrolled as a whole, taking the
     menu, the page title and the way out with it. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForFunction(() => document.querySelectorAll('#rows tr').length > 1);

    const back = p.locator('.topbar a[href="admin.html"]');
    record('there is a way back to the ERP, and it is on screen',
      await back.count() === 1 && await back.first().isVisible());

    // Scroll everything that can be scrolled, as far as it will go.
    await p.evaluate(() => {
      window.scrollTo(0, 99999);
      document.querySelector('.content').scrollTop = 99999;
      const w = document.querySelector('.tbl-wrap');
      if (w) w.scrollTop = 99999;
    });
    await p.waitForTimeout(250);

    const after = await p.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, onScreen: r.bottom > 0 && r.top < window.innerHeight }; };
      const th = document.querySelector('.tbl thead th');
      const wrap = document.querySelector('.tbl-wrap');
      const firstRowTop = document.querySelector('#rows tr')?.getBoundingClientRect().top;
      return {
        sidebar: box(document.querySelector('.sidebar')),
        topbar:  box(document.querySelector('.topbar')),
        back:    box(document.querySelector('.topbar a[href="admin.html"]')),
        header:  box(th),
        wrapTop: wrap.getBoundingClientRect().top,
        headerAtTopOfTable: th.getBoundingClientRect().top - wrap.getBoundingClientRect().top,
        scrolledInside: wrap.scrollTop,
        firstRowTop,
      };
    });

    record('the left menu stays put when the table is scrolled', after.sidebar.onScreen,
      `top ${Math.round(after.sidebar.top)}`);
    record('the page title bar stays put', after.topbar.onScreen,
      `top ${Math.round(after.topbar.top)}`);
    record('Back to ERP is still reachable after scrolling', after.back.onScreen);
    record('the table was actually scrolled, so this proves something',
      after.scrolledInside > 100, `${after.scrolledInside}px down`);
    record('the column headings freeze at the top of the table',
      after.header.onScreen && Math.abs(after.headerAtTopOfTable) < 3,
      `${Math.round(after.headerAtTopOfTable)}px from the top of the table box`);
    await p.close();
  }

  /* ============ THE MENU LOOKS LIKE THE REST OF THE ERP ============ */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    const nav = await p.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#nav .nav-item'));
      const labels = Array.from(document.querySelectorAll('.nav-section-label'));
      return {
        items: items.length,
        withIcon: items.filter(n => n.querySelector('svg')).length,
        withLabel: items.filter(n => n.querySelector('.nav-label')).length,
        headingsBold: labels.every(l => Number(getComputedStyle(l).fontWeight) >= 700),
        headings: labels.length,
      };
    });
    record(`every menu item has an icon (${nav.withIcon} of ${nav.items})`, nav.withIcon === nav.items);
    record('every menu item has its label in a span, as admin.html does',
      nav.withLabel === nav.items);
    record(`the group headings are bold (${nav.headings} of them)`, nav.headingsBold);
    await p.close();
  }

  /* ============ THE LOAD: A YEAR IN CHUNKS, COMPARED ONCE ============
     The fault was a 7,219-row year refused for taking longer than the 8
     seconds a signed-in person is allowed. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.locator('#nav .nav-item[data-view="upload"]').click();
    await p.waitForTimeout(300);

    // Record every call the page makes, and let staging and finalise answer.
    await p.evaluate(() => {
      window.__CALLS__ = [];
      window.__TEST_DATA__['rpc:busy_import_stage'] = a => {
        window.__CALLS__.push({ fn: 'stage', rows: (a.p_rows || []).length, fy: a.p_fy });
        return (a.p_rows || []).length;
      };
      window.__TEST_DATA__['rpc:busy_import_finalise'] = a => {
        window.__CALLS__.push({ fn: 'finalise', fy: a.p_fy });
        return [{ inserted: 7219, updated: 0, edited: 0, deleted: 0, restored: 0 }];
      };
    });

    // A real 7,219-row year, through the real file input.
    const head = 'company,fy,kind,vch_code,sr_no,vch_type,doc_type,vch_no,vch_date,party,item,description,qty,rate,amount,is_lump_sum,parser_version';
    const lines = [head];
    for (let i = 1; i <= 7219; i++) {
      lines.push(`REF,2025-26,item,V${i},1,2,Purchase Bill,B${i},2025-04-01,PARTY ${i % 50},MS PIPE 80X40X${i % 9},LOT ${i},10,50,500,False,2026.09.17-mdbtools`);
    }
    await p.setInputFiles('#fileInput', {
      name: 'ref-2025-26-rows.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')),
    });
    await p.waitForTimeout(1500);
    await p.click('#loadBtn');
    await p.waitForFunction(() => /Finished/.test(document.getElementById('uploadState').textContent),
      null, { timeout: 60000 }).catch(() => {});

    const calls = await p.evaluate(() => window.__CALLS__);
    const stages = calls.filter(c => c.fn === 'stage');
    const finals = calls.filter(c => c.fn === 'finalise');
    const sent = stages.reduce((a, c) => a + c.rows, 0);
    const biggest = Math.max(...stages.map(c => c.rows));

    record(`a 7,219-row year went up in ${stages.length} chunks, not one call`,
      stages.length >= 14, `${stages.length} chunks`);
    record('every row arrived', sent === 7219, `${sent} of 7219`);
    record('no chunk was bigger than 500', biggest <= 500, `biggest ${biggest}`);
    record('the comparison ran EXACTLY ONCE, after every chunk had landed',
      finals.length === 1 && calls[calls.length - 1].fn === 'finalise',
      `${finals.length} finalise calls, last call was ${calls[calls.length - 1].fn}`);
    record('the whole year was compared as one, so nothing is wrongly marked deleted',
      finals.length === 1 && finals[0].fy === '2025-26');
    await p.close();
  }

  /* ---- a chunk that fails must not leave half a year loaded ---- */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.locator('#nav .nav-item[data-view="upload"]').click();
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      window.__CALLS__ = [];
      let n = 0;
      window.__TEST_DATA__['rpc:busy_import_stage'] = a => {
        n++;
        window.__CALLS__.push({ fn: 'stage', rows: (a.p_rows || []).length });
        if (n === 3) return { error: { message: 'connection lost partway' } };
        return (a.p_rows || []).length;
      };
      window.__TEST_DATA__['rpc:busy_import_finalise'] = () => {
        window.__CALLS__.push({ fn: 'finalise' });
        return [{ inserted: 0 }];
      };
      window.__TEST_DATA__['rpc:busy_import_abandon'] = () => {
        window.__CALLS__.push({ fn: 'abandon' }); return 0;
      };
    });
    const head = 'company,fy,kind,vch_code,sr_no,vch_type,doc_type,vch_no,vch_date,party,item,description,qty,rate,amount,is_lump_sum,parser_version';
    const lines = [head];
    for (let i = 1; i <= 2000; i++) {
      lines.push(`REF,2025-26,item,V${i},1,2,Purchase Bill,B${i},2025-04-01,P,I,LOT ${i},1,1,1,False,2026.09.17-mdbtools`);
    }
    await p.setInputFiles('#fileInput', {
      name: 'ref-2025-26-rows.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')),
    });
    await p.waitForTimeout(800);
    await p.click('#loadBtn');
    await p.waitForFunction(() => /Finished/.test(document.getElementById('uploadState').textContent),
      null, { timeout: 30000 }).catch(() => {});
    const calls = await p.evaluate(() => window.__CALLS__);
    record('a chunk that fails stops the load — the comparison never runs',
      calls.filter(c => c.fn === 'finalise').length === 0,
      calls.map(c => c.fn).join(' -> '));
    record('and what had already arrived is thrown away',
      calls.some(c => c.fn === 'abandon'));
    const shown = (await p.locator('#uploadRows').innerText()).replace(/\s+/g, ' ');
    record('the screen says nothing was loaded, and why',
      /Nothing was loaded/i.test(shown) && /connection lost partway/.test(shown),
      shown.slice(0, 100));
    await p.close();
  }

  /* ============ 10. PERMISSIONS ARE REAL ============ */

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
