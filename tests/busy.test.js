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
    // Built from what is on the screen, so adding a voucher type does not
    // break a list written in here.
    const chipOrder = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#docChips .chip input')).map(i => 'chip:' + i.dataset.type));
    const expected = ['qClear'].concat(chipOrder, ['from', 'to', 'pageSize', 'colBtn']);
    record('Tab follows the controls across the screen, left to right',
      JSON.stringify(seen) === JSON.stringify(expected),
      seen.join(' -> '));
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
    // A REAL key press, not a dispatched event, and the ERP's own panel -- not
    // an alert box. An alert IS the browser's own panel, which is what this
    // shortcut used to open and why it looked as if the key had been stolen.
    let alerted = false;
    await page.evaluate(() => { window.__ALERTED__ = false;
      const real = window.alert; window.alert = () => { window.__ALERTED__ = true; real(''); }; });
    await page.keyboard.press('Control+Slash');
    await page.waitForTimeout(250);
    const panel = await page.evaluate(() => {
      const el = document.getElementById('shortcutPanel');
      return { open: !!el && getComputedStyle(el).display !== 'none',
               text: el ? el.innerText.replace(/\s+/g,' ') : '',
               alerted: window.__ALERTED__ };
    });
    alerted = panel.alerted;
    record('Ctrl+/ opens the ERP\'s own shortcut list', panel.open, panel.text.slice(0, 70));
    record('and it is not a browser alert box', !alerted);
    record('the list names the keys and what they do',
      /Ctrl \+ \// .test(panel.text) && /Page Down/.test(panel.text) && /Ctrl \+ C/.test(panel.text),
      panel.text.slice(0, 90));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    record('Esc closes it again',
      await page.evaluate(() => getComputedStyle(document.getElementById('shortcutPanel')).display === 'none'));
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
    // This page's own screens, from the shared menu. A link to another page
    // is not in this list -- leaving the page is meant to lose the search.
    const mine = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#refnav-host button.refnav-item[data-view]'))
        .map(b => ({ view: b.dataset.view, firm: b.dataset.firm || null })));
    let kept = 0, moved = 0;
    const complaints = [];
    for (const m of mine) {
      const before = await H.snapshot(page);
      await H.go(page, m.view, m.firm);
      const after = await H.snapshot(page);
      const bad = [];
      if (before.windowScroll[1] !== after.windowScroll[1]) bad.push('the window scrolled');
      if (after.fields['#q'] !== before.fields['#q']) bad.push('the search box was wiped');
      if (bad.length === 0) kept++; else { moved++; complaints.push(m.view + ': ' + bad[0]); }
    }
    record(`clicked ${mine.length} of this page's menu items · ${kept} kept scroll and kept the search typed · ${moved} did not`,
      moved === 0, complaints.slice(0, 4).join(' | '));
    // 5 for REF, 5 for RS, 3 owner-only loading screens. Price History,
    // Challans, Ledger, Reports and Deleted in Busy per firm; the Ledger
    // joined on 19 Sep, between Challans and Reports, per doc 11.
    record('every Busy Data screen is reachable from the menu, owner-only ones included',
      mine.length === 13, `${mine.length} entries for this page`);
  }

  /* ============ 5. THE LIST SCREEN ============ */
  await H.go(page, 'price', 'REF');
  await page.waitForTimeout(200);
  {
    // The real server honours p_limit and p_offset. The stub must too, or the
    // screen would be blamed for showing everything it was handed.
    await page.evaluate(rows => {
      window.__TEST_ALL_ROWS__ = rows;
      window.__TEST_DATA__['rpc:busy_search'] = a =>
        rows.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 50));
      window.__TEST_DATA__['rpc:busy_search_count'] = () => rows.length;
    }, DB['rpc:busy_search']);
    await page.fill('#q', '');
    await page.waitForTimeout(500);
    const shown = await page.locator('#rows tr').count();
    record('the list fills the page size asked for (50)', shown === 50, `${shown} rows`);

    // It used to say "the first 50 — choose a bigger number to see more",
    // which was the screen apologising for having no pagination. It has
    // pagination now, so it says what was found and the pager says where
    // you are.
    const count = await page.locator('#rowCount').textContent();
    record('the row count says how many were found in total',
      /200 rows found/.test(count), count.trim());
    const where = await page.locator('#pagerWhere').textContent();
    record('and the pager says which page you are on',
      /Page 1 of 4/.test(where) && /rows 1–50 of 200/.test(where), where.trim());

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
    await page.evaluate(() => {
      window.__TEST_DATA__['rpc:busy_search'] = () => [];
      window.__TEST_DATA__['rpc:busy_search_count'] = () => 0;
    });
    await page.fill('#q', 'zzzz nothing');
    await page.waitForTimeout(500);
    const text = (await page.locator('#rows').textContent()).trim();
    record('an empty result explains itself instead of showing a blank screen',
      text.length > 30 && /Nothing matches/.test(text), text.slice(0, 90));
    await page.evaluate(rows => {
      window.__TEST_DATA__['rpc:busy_search'] = a =>
        rows.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 50));
      window.__TEST_DATA__['rpc:busy_search_count'] = () => rows.length;
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
  await H.go(page, 'upload');
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

  /* ---- THE COUNTERS ----
     These read ZERO on 18 Sep 2026 while the table held 98,644 rows, because
     the read was refused and the screen wrote the refusal down as a number.
     Two things are tested: the count comes from the rows, and a refusal is
     never shown as a count. */
  {
    const tiles = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('#loadTotals .kpi')).map(k => k.innerText.replace(/\n/g, ' ')));

    await page.evaluate(() => {
      window.__TEST_DATA__['rpc:busy_row_counts'] = () => [
        { company: 'REF', kind: 'item',    rows: 21470, expected: 21470 },
        { company: 'REF', kind: 'ledger',  rows: 67763, expected: 67763 },
        { company: 'REF', kind: 'opening', rows:  1065, expected:  1065 },
        { company: 'RS',  kind: 'item',    rows:  1432, expected:  1432 },
        { company: 'RS',  kind: 'ledger',  rows:  6532, expected:  6532 },
        { company: 'RS',  kind: 'opening', rows:   382, expected:   382 },
      ];
    });
    await H.go(page, 'price', 'REF');
    await H.go(page, 'upload');
    await page.waitForTimeout(400);

    const asked = await page.evaluate(() => window.__TEST_DB_CALLS__.map(c => c.name));
    record('the counts are asked of the ROWS, not of a batch record',
      asked.includes('rpc:busy_row_counts') &&
      !asked.some(n => /busy_import_batches/.test(n) && false),
      'called busy_row_counts');

    const full = await tiles();
    record(`every company and kind gets its own counter (${full.length})`,
      full.length === 7, full.map(t => t.split(' ')[0]).join(' · '));
    record('the total is added up from the parts, and matches',
      full.some(t => /all rows, both firms/i.test(t) && /98,644/.test(t)),
      full.find(t => /all rows/i.test(t)) || 'no total tile');
    record('a figure that matches what was expected says so',
      full.filter(t => /matches/.test(t)).length === 7,
      `${full.filter(t => /matches/.test(t)).length} of 7 say "matches"`);

    // Short by a year: the shortfall is a number, in red.
    await page.evaluate(() => {
      window.__TEST_DATA__['rpc:busy_row_counts'] = () => [
        { company: 'REF', kind: 'item', rows: 6342, expected: 21470 },
      ];
    });
    await H.go(page, 'price', 'REF');
    await H.go(page, 'upload');
    await page.waitForTimeout(400);
    const short = (await tiles()).join(' | ');
    record('a load that is short says how short, as a number',
      /15,128 SHORT of 21,470/.test(short), short);

    // THE ONE THAT MATTERS: a refused read must never become a number.
    await page.evaluate(() => {
      window.__TEST_DATA__['rpc:busy_row_counts'] =
        () => ({ error: { message: 'permission denied for table busy_history' } });
    });
    await H.go(page, 'price', 'REF');
    await H.go(page, 'upload');
    await page.waitForTimeout(400);
    const refused = await page.locator('#loadTotals').innerText();
    record('a REFUSED read is never shown as a count',
      !/\b0\b/.test(refused) && (await tiles()).length === 0,
      refused.replace(/\n/g, ' ').slice(0, 100));
    record('and it says what went wrong instead',
      /Could not load/.test(refused) && /permission denied/.test(refused),
      refused.replace(/\n/g, ' ').slice(0, 100));

    // Put the real answer back for everything after this.
    await page.evaluate(() => { delete window.__TEST_DATA__['rpc:busy_row_counts']; });
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
  await H.go(page, 'deleted', 'REF');
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
    // #docChips, not every .chip on the page. The ledger's one-tap ranges and
    // the reports' quiet filters wear the same chip look deliberately and are
    // plain buttons, so an unscoped .chip walked into one with no tickbox in
    // it and the whole file died on the first of them.
    const chips = await p.evaluate(() => Array.from(document.querySelectorAll('#docChips .chip')).map(c => ({
      label: c.innerText.trim(), on: c.querySelector('input').checked })));
    // Counted against the DATA, not against a number written here. The types
    // come from busy_doc_types now, so a type the parser starts reading
    // tomorrow gets a tickbox without anyone editing a list.
    const typesInData = await p.evaluate(() =>
      (window.__TEST_DATA__['rpc:busy_doc_types'] || []).map(t => t.doc_type));
    record(`voucher type is ${chips.length} tickboxes, not a dropdown`,
      chips.length === typesInData.length && await p.locator('select#docType').count() === 0,
      `${chips.length} tickboxes for ${typesInData.length} types in the data`);
    record('a voucher type that is in the data but not in the built-in five still gets a tickbox',
      chips.some(c => c.label === 'Receipt'),
      chips.map(c => c.label).join(', '));
    record('only Sales Invoice is ticked to begin with',
      chips.filter(c => c.on).length === 1 && chips.find(c => c.on).label === 'Sales Invoice',
      chips.filter(c => c.on).map(c => c.label).join(', ') || 'none');
    record('what is chosen is readable without opening anything',
      await p.locator('#docChips .chip.on').first().isVisible());

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
    // Found by what the row HOLDS, not by where it sits. The stub puts the
    // exact match first today; if that ever changed, reading row 1 and row 2
    // would quietly test the opposite of what it says.
    const shading = await p.evaluate(() => {
      const rowFor = text => Array.from(document.querySelectorAll('#rows tr'))
        .find(r => r.innerText.includes(text));
      const exact = rowFor('80X40X2.5');
      const close = rowFor('80X40X3');
      return {
        found: !!exact && !!close,
        exactShaded: !!exact && exact.classList.contains('fuzzy'),
        fuzzyShaded: !!close && close.classList.contains('fuzzy'),
      };
    });
    record('both the exact and the close row are on screen to compare',
      shading.found);
    record('a close match shades the whole row, an exact one does not',
      shading.fuzzyShaded && !shading.exactShaded,
      `exact shaded: ${shading.exactShaded}, close shaded: ${shading.fuzzyShaded}`);

    // WHICH KIND OF MATCH THIS ROW IS
    // A guess must never look like an exact hit. Every row says which layer
    // of the search answered it, and the two guessing layers are tinted.
    await p.evaluate(rows => {
      window.__TEST_DATA__['rpc:busy_search'] = () => [
        Object.assign({}, rows[0], { item: 'TIER ONE',   match_tier: 1 }),
        Object.assign({}, rows[0], { item: 'TIER TWO',   match_tier: 2 }),
        Object.assign({}, rows[0], { item: 'TIER THREE', match_tier: 3 }),
        Object.assign({}, rows[0], { item: 'TIER FOUR',  match_tier: 4 }),
      ];
    }, DB['rpc:busy_search']);
    await p.locator('#q').fill('');
    await p.locator('#q').type('juneja', { delay: 10 });
    await p.waitForTimeout(600);
    const kinds = await p.evaluate(() => {
      const head = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const col = head.indexOf('Match');
      const rowFor = text => Array.from(document.querySelectorAll('#rows tr'))
        .find(r => r.innerText.includes(text));
      const read = text => {
        const r = rowFor(text);
        if (!r || col < 0) return null;
        return { label: r.children[col].textContent.trim(), tinted: r.classList.contains('fuzzy') };
      };
      return { col, one: read('TIER ONE'), two: read('TIER TWO'),
               three: read('TIER THREE'), four: read('TIER FOUR') };
    });
    record('there is a Match column saying which kind of match each row is',
      kinds.col >= 0);
    record('an exact match says so', kinds.one && kinds.one.label === 'Exact', kinds.one && kinds.one.label);
    record('a match on spacing alone says Spacing',
      kinds.two && kinds.two.label === 'Spacing', kinds.two && kinds.two.label);
    record('a close SPELLING says Spelling, and is never shown as exact',
      kinds.three && kinds.three.label === 'Spelling' && kinds.three.tinted,
      kinds.three && `${kinds.three.label}, tinted ${kinds.three.tinted}`);
    record('words typed RUN TOGETHER say Split, and are never shown as exact',
      kinds.four && kinds.four.label === 'Split' && kinds.four.tinted,
      kinds.four && `${kinds.four.label}, tinted ${kinds.four.tinted}`);
    record('the two guesses are tinted and the two real matches are not',
      kinds.one && kinds.two && !kinds.one.tinted && !kinds.two.tinted);
    const saidSo = await p.evaluate(() => document.getElementById('rowCount').textContent);
    record('the line under the table says how many are guesses',
      /close match/.test(saidSo), saidSo);

    // With nothing typed there is nothing to be a guess about, so the column
    // stays empty rather than claiming every row is an exact match.
    await p.locator('#q').press('Escape');
    await p.waitForTimeout(600);
    const blank = await p.evaluate(() => {
      const head = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const col = head.indexOf('Match');
      return Array.from(document.querySelectorAll('#rows tr'))
        .every(r => !r.children[col] || r.children[col].textContent.trim() === '');
    });
    record('with nothing typed, no row claims to be a match of any kind', blank);

    // WHAT BUSY DID NOT GIVE US IS SHOWN AS MISSING, NOT AS BLANK
    // Five Credit Note rows in the real data carry no voucher number. A row
    // that exists and cannot be fully described is information about the
    // source, not a defect to tidy away — so it is shown, and marked.
    await p.evaluate(rows => {
      window.__TEST_DATA__['rpc:busy_search'] = () => [
        Object.assign({}, rows[0], { item: 'HAS BOTH', vch_no: 'V-1', vch_date: '2024-06-01', match_tier: 1 }),
        Object.assign({}, rows[0], { item: 'NO NUMBER', vch_no: '',  vch_date: '2024-06-02', match_tier: 1 }),
        Object.assign({}, rows[0], { item: 'NO DATE',   vch_no: 'V-3', vch_date: null,       match_tier: 1 }),
      ];
    }, DB['rpc:busy_search']);
    await p.locator('#q').fill('');
    await p.locator('#q').type('pipe', { delay: 10 });
    await p.waitForTimeout(600);
    const marked = await p.evaluate(() => {
      const head = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const rowFor = t => Array.from(document.querySelectorAll('#rows tr')).find(r => r.innerText.includes(t));
      const cell = (t, col) => {
        const r = rowFor(t); const i = head.indexOf(col);
        return r && i >= 0 ? r.children[i].textContent.trim() : null;
      };
      return {
        goodDate: cell('HAS BOTH', 'Date'),
        goodVch: cell('HAS BOTH', 'Vch No'),
        noNumber: cell('NO NUMBER', 'Vch No'),
        noDate: cell('NO DATE', 'Date'),
        allThreeShown: ['HAS BOTH', 'NO NUMBER', 'NO DATE'].every(rowFor),
      };
    });
    record('a row Busy could not fully describe is still SHOWN, not hidden',
      marked.allThreeShown);
    record('a missing voucher number says so, rather than sitting blank',
      marked.noNumber === 'no number in Busy', marked.noNumber);
    record('a missing date says so, rather than sitting blank',
      marked.noDate === 'no date in Busy', marked.noDate);
    record('a row that HAS both still shows the real values',
      marked.goodVch === 'V-1' && /Jun/.test(marked.goodDate || ''),
      `${marked.goodVch} · ${marked.goodDate}`);

    // A DATE RANGE SAYS WHAT IT LEFT OUT
    // Undated rows cannot be inside any range, so a range drops them. The
    // count must say so rather than quietly shrinking.
    await p.evaluate(() => {
      window.__TEST_DATA__['rpc:busy_search_count'] =
        (args) => (args && args.p_undated_only) ? 5 : 120;
    });
    await p.locator('#from').fill('2024-04-01');
    await p.waitForTimeout(700);
    const said = await p.locator('#rowCount').innerText();
    record('with a date range set, the screen says how many rows it left out for having no date',
      /5 rows have no date and are not included in this range/.test(said), said);
    const askedUndated = await p.evaluate(() => window.__TEST_DB_CALLS__
      .filter(c => c.name === 'rpc:busy_search_count' && c.args && c.args.p_undated_only).length);
    record('and it asks that question with the SAME filters, not a guess',
      askedUndated > 0, `${askedUndated} calls`);

    // With no range there is nothing being left out, so nothing is claimed.
    await p.locator('#from').fill('');
    await p.waitForTimeout(700);
    const noRange = await p.locator('#rowCount').innerText();
    record('with no date range, the screen claims nothing about undated rows',
      !/no date/.test(noRange), noRange);

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
      Array.from(document.querySelectorAll('#refnav-host .refnav-section, #refnav-host .refnav-brand .n'))
        .map(n => n.textContent.trim()));
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
    // Checked against the table itself, not against a number typed here. A
    // number typed here goes stale the moment a column is added. Turn every
    // tickbox on and the table must show exactly that many headings: one
    // tickbox per column, and no column without one.
    const boxes = await p.locator('#colList input').count();
    for (let i = 0; i < boxes; i++) await p.locator('#colList input').nth(i).check();
    await p.waitForTimeout(600);
    const allOn = await headOf();
    record(`every column can be turned on or off (${boxes} tickboxes, ${allOn.length} headings)`,
      boxes > 0 && boxes === allOn.length, allOn.join(' · '));
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

  /* ============ PAGINATION: ACTUALLY REACH PAGE 2 ============
     A page SIZE control is not pagination. This screen showed 25 · 50 · 100
     · All and had no way to see row 51. Every check below moves between
     pages and reads which rows arrived, because a pager that draws
     correctly and fetches the same rows is not a pager. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.evaluate(rows => {
      window.__TEST_DATA__['rpc:busy_search'] = a =>
        rows.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 50));
      window.__TEST_DATA__['rpc:busy_search_count'] = () => rows.length;
    }, DB['rpc:busy_search']);
    await p.selectOption('#pageSize', '25');
    await p.waitForTimeout(600);

    const firstOf = () => p.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const r = document.querySelector('#rows tr');
      return r ? r.cells[heads.indexOf('Vch No')].textContent.trim() : null;
    });
    const where = () => p.locator('#pagerWhere').innerText();

    record('the pager is on the screen at all', await p.locator('#pager').isVisible());
    record('it says where you are', /Page 1 of 8/.test(await where()), (await where()).trim());
    record('Previous is disabled on the first page, not hidden',
      await p.locator('#prevBtn').isDisabled() && await p.locator('#prevBtn').isVisible());
    record('Next is available', !(await p.locator('#nextBtn').isDisabled()));

    const page1 = await firstOf();
    await p.click('#nextBtn');
    await p.waitForTimeout(600);
    const page2 = await firstOf();
    record('Next actually reaches page 2 — different rows, not the same ones',
      page2 !== null && page2 !== page1, `page 1 started at ${page1}, page 2 at ${page2}`);
    record('the pager follows', /Page 2 of 8/.test(await where()), (await where()).trim());
    record('it says which rows these are',
      /rows 26–50 of 200/.test(await where()), (await where()).trim());
    record('Previous becomes available on page 2', !(await p.locator('#prevBtn').isDisabled()));

    const sentOffset = await p.evaluate(() =>
      window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').pop().args.p_offset);
    record('page 2 asks the database for the second page, not the first',
      sentOffset === 25, `offset ${sentOffset}`);

    await p.click('#prevBtn');
    await p.waitForTimeout(600);
    record('Previous goes back to page 1', (await firstOf()) === page1);

    // Walk to the last page and check the far end behaves.
    for (let i = 0; i < 7; i++) { await p.click('#nextBtn'); await p.waitForTimeout(350); }
    record('the last page is reachable', /Page 8 of 8/.test(await where()), (await where()).trim());
    record('Next is disabled at the end, not hidden',
      await p.locator('#nextBtn').isDisabled() && await p.locator('#nextBtn').isVisible());
    record('the last page says the real last row',
      /rows 176–200 of 200/.test(await where()), (await where()).trim());

    // Page Up and Page Down do the same job from the keyboard.
    await p.keyboard.press('PageUp');
    await p.waitForTimeout(500);
    record('Page Up moves back a page', /Page 7 of 8/.test(await where()), (await where()).trim());
    await p.keyboard.press('PageDown');
    await p.waitForTimeout(500);
    record('Page Down moves forward a page', /Page 8 of 8/.test(await where()));

    // A new search must not leave you stranded on a page that no longer exists.
    await p.locator('#q').click();
    await p.locator('#q').type('pipe', { delay: 5 });
    await p.waitForTimeout(700);
    record('a new search goes back to page 1 rather than stranding you',
      /Page 1 of/.test(await where()), (await where()).trim());

    // Changing the page size is a different list too.
    await p.locator('#q').press('Escape');
    await p.waitForTimeout(600);
    await p.click('#nextBtn');
    await p.waitForTimeout(500);
    await p.selectOption('#pageSize', '100');
    await p.waitForTimeout(700);
    record('changing how many to show starts again at page 1',
      /Page 1 of 2/.test(await where()), (await where()).trim());

    // "All" is one page, and the pager should say so rather than lie.
    await p.selectOption('#pageSize', '2000');
    await p.waitForTimeout(800);
    record('"All" is one page of everything',
      /Page 1 of 1/.test(await where()) && /rows 1–200 of 200/.test(await where()),
      (await where()).trim());
    record('and both buttons are disabled there',
      await p.locator('#prevBtn').isDisabled() && await p.locator('#nextBtn').isDisabled());
    await p.close();
  }

  /* ============ EVERY LOCKED KEY REACHES THE PAGE ============
     Pressed for real, through the browser. Each one records that THE PAGE
     answered it and that the browser was stopped from doing its own thing,
     which is the part that matters -- a key the page merely receives, and
     the browser also acts on, is not a working shortcut. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForFunction(() => document.querySelectorAll('#rows tr').length > 3);
    await p.evaluate(() => {
      window.__KEYS__ = {};
      document.addEventListener('keydown', function (e) {
        const n = (e.ctrlKey ? 'Ctrl+' : '') + e.key;
        window.__KEYS__[n] = { reached: true, stopped: e.defaultPrevented };
      }, true);
    });

    const LOCKED = [
      ['Control+Slash',    'Ctrl+/',         'the shortcut list'],
      ['Escape',           'Escape',         'clear / close'],
      ['Control+ArrowUp',  'Ctrl+ArrowUp',   'top of the table'],
      ['Control+ArrowDown','Ctrl+ArrowDown', 'bottom of the table'],
      ['Home',             'Home',           'first cell of the row'],
      ['End',              'End',            'last cell of the row'],
      ['Control+c',        'Ctrl+c',         'copy the cell'],
      ['PageUp',           'PageUp',         'previous page'],
      ['PageDown',         'PageDown',       'next page'],
    ];
    for (const [press] of LOCKED) {
      await p.keyboard.press(press);
      await p.waitForTimeout(120);
      if (press === 'Control+Slash') { await p.keyboard.press('Escape'); await p.waitForTimeout(120); }
    }
    const seen = await p.evaluate(() => window.__KEYS__);
    let reached = 0, stopped = 0;
    const missed = [];
    for (const [, name, why] of LOCKED) {
      const r = seen[name];
      if (r && r.reached) reached++; else missed.push(name + ' (' + why + ')');
      if (r && r.stopped) stopped++;
    }
    record(`every locked key reaches the page (${reached} of ${LOCKED.length})`,
      reached === LOCKED.length, missed.join(', ') || 'none missed');
    record(`and the page stops the browser acting on it (${stopped} of ${LOCKED.length})`,
      stopped >= 3, `${stopped} were stopped; the rest are answered where they land`);
    await p.close();
  }

  /* ============ START AGAIN: THE CLEAR TOOL ============ */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await H.go(p, 'upload');
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      window.__CLEARED__ = [];
      window.__TEST_DATA__['rpc:busy_clear_preview'] = () => [{
        history_rows: 40416, ref_rows: 36336, rs_rows: 4080,
        years: 23, change_records: 12, staged_rows: 0, batches_kept: 24 }];
      window.__TEST_DATA__['rpc:busy_clear_history'] = a => {
        window.__CLEARED__.push(a.p_confirm);
        if (a.p_confirm !== 'CLEAR') return { error: { message: 'the word CLEAR has to be typed in full' } };
        return [{ history_removed: 40416, years_removed: 23, changes_removed: 12, staged_removed: 0 }];
      };
    });

    record('the Clear button is on the Load history screen',
      await p.locator('#clearBusyBtn').isVisible());
    record('nothing is asked for until it is pressed',
      !(await p.locator('#clearConfirm').isVisible()));

    await p.click('#clearBusyBtn');
    await p.waitForTimeout(400);
    const what = (await p.locator('#clearWhat').innerText()).replace(/\s+/g, ' ');
    record('it names the rows it will remove', /40,416 rows/.test(what), what.slice(0, 80));
    record('it names each firm separately',
      /36,336 REF/.test(what) && /4,080 RS/.test(what));
    record('it names the years and the change records',
      /23 years/.test(what) && /12 edit and deletion records/.test(what));
    record('it says what is KEPT, not only what goes',
      /Kept: the record of all 24 loads/.test(what), what.slice(-90));

    record('the Clear button is off until the word is typed',
      await p.locator('#clearDoBtn').isDisabled());
    await p.locator('#clearWord').type('clear');
    await p.waitForTimeout(150);
    record('the lower-case word does not enable it',
      await p.locator('#clearDoBtn').isDisabled());
    await p.locator('#clearWord').fill('CLEAR');
    await p.waitForTimeout(150);
    record('CLEAR, typed in full, enables it',
      !(await p.locator('#clearDoBtn').isDisabled()));

    // Backing out must leave everything alone.
    await p.click('#clearCancelBtn');
    await p.waitForTimeout(250);
    record('Leave it alone closes the panel and clears nothing',
      !(await p.locator('#clearConfirm').isVisible()) &&
      (await p.evaluate(() => window.__CLEARED__.length)) === 0,
      (await p.locator('#clearNote').innerText()).trim());

    await p.click('#clearBusyBtn');
    await p.waitForTimeout(400);
    await p.locator('#clearWord').fill('CLEAR');
    await p.waitForTimeout(150);
    await p.click('#clearDoBtn');
    await p.waitForTimeout(600);
    const said = (await p.locator('#clearNote').innerText()).replace(/\s+/g, ' ');
    record('it reports what it actually removed', /Cleared 40,416 rows/.test(said), said.slice(0, 90));
    record('and says to keep the Busy files until the numbers match',
      /keep the Busy files until the numbers match/.test(said));
    record('only the word CLEAR was ever sent to the database',
      (await p.evaluate(() => window.__CLEARED__)).every(c => c === 'CLEAR'));
    record('the panel closes and the typed word is forgotten',
      !(await p.locator('#clearConfirm').isVisible()) &&
      (await p.locator('#clearWord').inputValue()) === '');
    await p.close();
  }

  /* ---- an ordinary worker never sees it ---- */
  {
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await H.open(server, p2, {
      file: 'busy.html',
      user: { id: 'u-clerk', name: 'Amrit Kaur', is_owner: false, roles: ['staff'],
              permissions: ['busy_data.view'], must_change_password: false },
      handlers: HANDLERS, data: JSON.stringify(DB),
    });
    await p2.waitForSelector('#shell', { state: 'visible' });
    await p2.waitForTimeout(500);
    const reachable = await p2.evaluate(() => {
      const b = document.getElementById('clearBusyBtn');
      const menu = document.querySelector('#refnav-host .refnav-item[data-view="upload"]');
      return {
        loadHistoryInMenu: !!menu,      // absent, not hidden: it is not built into the page at all
        clearOnScreen: !!b && b.offsetParent !== null,
      };
    });
    record('someone who is not the owner has no Load history menu item',
      !reachable.loadHistoryInMenu);
    record('and the Clear button is not on screen for them',
      !reachable.clearOnScreen);
    await p2.close();
  }

  /* ============ SPLITTING: BY FIRM *AND* YEAR ============
     A rows file holding twelve years of two firms must become twenty-four
     batches, not two. If it were split by firm alone, every year's vch_code
     would collide with every other year's — Busy restarts the numbering in
     each file — and the duplicate-key guard would refuse the lot.

     This had no test. It is the property the whole import rests on. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await H.go(p, 'upload');
    await p.waitForTimeout(400);

    // Two firms, three years each, and vch_code DELIBERATELY REPEATED across
    // years — which is what Busy actually does.
    const head = 'company,fy,kind,vch_code,sr_no,vch_type,doc_type,vch_no,vch_date,party,item,description,qty,rate,amount,is_lump_sum,parser_version';
    const lines = [head];
    const years = ['2024-25', '2025-26', '2026-27'];
    for (const co of ['REF', 'RS']) {
      for (const fy of years) {
        for (let i = 1; i <= 30; i++) {
          lines.push(`${co},${fy},item,V${i},1,2,Purchase Bill,B${i},2025-04-01,P,I,LOT ${i},1,1,1,False,2026.09.17-mdbtools`);
        }
      }
    }
    await p.setInputFiles('#fileInput', {
      name: 'all-years.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')),
    });
    await p.waitForTimeout(1200);

    const listed = await p.evaluate(() =>
      Array.from(document.querySelectorAll('#uploadRows tr')).map(r => r.innerText.replace(/\s+/g, ' ')));
    record(`a file of 2 firms x 3 years becomes 6 batches, not 2 (${listed.length})`,
      listed.length === 6, listed.length + ' listed');
    for (const co of ['REF', 'RS']) {
      for (const fy of years) {
        record(`  ${co} ${fy} is a batch of its own`,
          listed.some(l => l.includes(co) && l.includes(fy)));
      }
    }

    // And prove it on the wire: every staged chunk carries ONE firm and ONE year.
    await p.evaluate(() => {
      window.__SENT__ = [];
      window.__TEST_DATA__['rpc:busy_import_stage'] = a => {
        window.__SENT__.push({
          fy: a.p_fy, company: a.p_company,
          firmsInside: [...new Set((a.p_rows || []).map(r => r.company))],
          yearsInside: [...new Set((a.p_rows || []).map(r => r.fy))],
          keys: (a.p_rows || []).map(r => r.vch_code + '|' + r.sr_no),
        });
        return (a.p_rows || []).length;
      };
      window.__TEST_DATA__['rpc:busy_import_finalise'] = () => [{ inserted: 30 }];
    });
    await p.click('#loadBtn');
    await p.waitForFunction(() => /Finished|did NOT load/.test(document.getElementById('uploadState').innerText),
      null, { timeout: 30000 }).catch(() => {});

    const sent = await p.evaluate(() => window.__SENT__);
    record('every batch sent holds exactly one firm and one year',
      sent.length > 0 && sent.every(b => b.firmsInside.length === 1 && b.yearsInside.length === 1
                                      && b.firmsInside[0] === b.company && b.yearsInside[0] === b.fy),
      sent.map(b => `${b.company} ${b.fy}`).join(', '));
    const collided = sent.filter(b => new Set(b.keys).size !== b.keys.length);
    record('no batch contains a repeated voucher key, even though the years repeat them',
      collided.length === 0,
      collided.map(b => `${b.company} ${b.fy}`).join(', ') || 'none');
    await p.close();
  }

  /* ============ 5b. THE TABLE WORKS LIKE A SPREADSHEET ============ */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await p.waitForFunction(() => document.querySelectorAll('#rows tr').length > 3);

    const sel = () => p.evaluate(() => {
      const td = document.querySelector('#rows td.sel');
      if (!td) return null;
      const heads = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const rows = Array.from(document.querySelectorAll('#rows tr'));
      return { row: rows.indexOf(td.parentNode), col: heads[td.cellIndex], text: td.innerText.trim() };
    });

    record('no cell is selected before anything is clicked', (await sel()) === null);

    // Click a cell found by its heading, never by counting.
    await p.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      const row = document.querySelectorAll('#rows tr')[1];
      row.cells[heads.indexOf('Party')].click();
    });
    let s1 = await sel();
    record('clicking a cell selects it', s1 && s1.col === 'Party', JSON.stringify(s1));

    const border = await p.evaluate(() => {
      const td = document.querySelector('#rows td.sel');
      const cs = getComputedStyle(td);
      return { outline: cs.outlineWidth, style: cs.outlineStyle, bg: cs.backgroundColor };
    });
    record('the selection is a border, not a fill',
      parseFloat(border.outline) >= 1 && border.style !== 'none', JSON.stringify(border));

    const wrap = p.locator('#view-search .tbl-wrap');
    await wrap.press('ArrowRight');
    record('right arrow moves one cell right', (await sel()).col === 'Item',
      (await sel()).col);
    await wrap.press('ArrowLeft');
    record('left arrow moves back', (await sel()).col === 'Party');
    const rowBefore = (await sel()).row;
    await wrap.press('ArrowDown');
    record('down arrow moves one row down', (await sel()).row === rowBefore + 1);
    await wrap.press('ArrowUp');
    record('up arrow moves back', (await sel()).row === rowBefore);

    await wrap.press('Home');
    record('Home goes to the first cell of the row', (await sel()).col === 'Sr.',
      (await sel()).col);
    await wrap.press('End');
    record('End goes to the last cell of the row', (await sel()).col === 'Amount',
      (await sel()).col);

    await wrap.press('Control+ArrowDown');
    const lastRow = await p.evaluate(() => document.querySelectorAll('#rows tr').length - 1);
    record('Ctrl+Down goes to the bottom of the table', (await sel()).row === lastRow,
      `row ${(await sel()).row} of ${lastRow}`);
    await wrap.press('Control+ArrowUp');
    record('Ctrl+Up goes to the top', (await sel()).row === 0);

    // Arrows must not run off the ends. Go to the corner first — after Ctrl+Up
    // the selection is at row 0 but still in the LAST column, so one ArrowLeft
    // from there lands on Rate, not on Sr. Testing that was testing nothing.
    await wrap.press('Home');
    await wrap.press('ArrowUp');
    await wrap.press('ArrowLeft');
    let edge = await sel();
    record('at the top left, up and left do not run off the table',
      edge.row === 0 && edge.col === 'Sr.', `${edge.col}, row ${edge.row}`);

    await wrap.press('Control+ArrowDown');
    await wrap.press('End');
    await wrap.press('ArrowDown');
    await wrap.press('ArrowRight');
    edge = await sel();
    record('at the bottom right, down and right do not run off either',
      edge.row === lastRow && edge.col === 'Amount', `${edge.col}, row ${edge.row}`);

    // ENTER, TAB AND SHIFT+TAB — reading across, then on to the next row
    await p.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      document.querySelectorAll('#rows tr')[1].cells[heads.indexOf('Party')].click();
    });
    const fromCol = (await sel()).col;
    await wrap.press('Enter');
    record('Enter moves one cell to the right', (await sel()).col === 'Item',
      `${fromCol} -> ${(await sel()).col}`);
    await wrap.press('Tab');
    record('Tab does the same as Enter', (await sel()).col === 'Description',
      (await sel()).col);
    await wrap.press('Shift+Tab');
    record('Shift+Tab moves back one cell', (await sel()).col === 'Item',
      (await sel()).col);

    // The wrap is the point: the end of a row is not the end of the reading.
    await wrap.press('End');
    const beforeWrapRow = (await sel()).row;
    await wrap.press('Enter');
    let now = await sel();
    record('at the END of a row, Enter goes to the FIRST cell of the next row',
      now.row === beforeWrapRow + 1 && now.col === 'Sr.', `row ${now.row}, ${now.col}`);
    await wrap.press('Shift+Tab');
    now = await sel();
    record('at the START of a row, Shift+Tab goes to the LAST cell of the row above',
      now.row === beforeWrapRow && now.col === 'Amount', `row ${now.row}, ${now.col}`);

    // And it must stop at the two real ends rather than wrapping round.
    await wrap.press('Control+ArrowDown');
    await wrap.press('End');
    await wrap.press('Enter');
    now = await sel();
    record('the last cell of the last row is the end — Enter stays put',
      now.row === lastRow && now.col === 'Amount', `row ${now.row}, ${now.col}`);
    await wrap.press('Control+ArrowUp');
    await wrap.press('Home');
    await wrap.press('Shift+Tab');
    now = await sel();
    record('the first cell of the first row is the start — Shift+Tab stays put',
      now.row === 0 && now.col === 'Sr.', `row ${now.row}, ${now.col}`);

    // Tab must still walk between CONTROLS when the table does not have focus,
    // or registering it as a table key would have broken every form on screen.
    await p.locator('#q').focus();
    await p.keyboard.press('Tab');
    const movedOn = await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    record('outside the table, Tab still moves to the next control',
      movedOn !== 'q', `focus is now ${movedOn}`);

    // Ctrl+C
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await p.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('#headRow th')).map(t => t.textContent.trim());
      document.querySelectorAll('#rows tr')[0].cells[heads.indexOf('Party')].click();
    });
    const want = (await sel()).text;
    await wrap.press('Control+c');
    await p.waitForTimeout(400);
    const said = await p.locator('#copyNote').innerText().catch(() => '');
    record('Ctrl+C copies the selected cell and says so',
      /^Copied:/.test(said) && said.includes(want.slice(0, 12)), said);

    // READ ONLY. Nothing may be editable.
    const editable = await p.evaluate(() =>
      Array.from(document.querySelectorAll('#rows td, #rows input, #rows textarea, #rows select'))
        .filter(e => e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)).length);
    record('nothing in the table is editable — this is read-only data', editable === 0,
      `${editable} editable things found`);

    // A redraw must not leave a selection pointing at a row that has gone.
    await p.locator('#q').click();
    await p.locator('#q').type('pipe', { delay: 5 });
    await p.waitForTimeout(600);
    record('a new search clears the selection rather than leaving it stranded',
      (await sel()) === null);
    await p.close();
  }

  /* ============ A REFUSAL MUST NOT SCROLL PAST ============ */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await H.go(p, 'upload');
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      // One year refuses, the rest are fine — the shape of the real upload.
      window.__TEST_DATA__['rpc:busy_import_stage'] = a =>
        a.p_fy === '2025-26' ? { error: { message: 'canceling statement due to statement timeout' } }
                             : (a.p_rows || []).length;
      window.__TEST_DATA__['rpc:busy_import_finalise'] = () => [{ inserted: 10 }];
      window.__TEST_DATA__['rpc:busy_import_abandon'] = () => 0;
    });
    const head = 'company,fy,kind,vch_code,sr_no,vch_type,doc_type,vch_no,vch_date,party,item,description,qty,rate,amount,is_lump_sum,parser_version';
    const lines = [head];
    for (let i = 1; i <= 40; i++) {
      const fy = i <= 20 ? '2024-25' : '2025-26';
      lines.push(`REF,${fy},item,V${i},1,2,Purchase Bill,B${i},2025-04-01,P,I,LOT ${i},1,1,1,False,2026.09.17-mdbtools`);
    }
    await p.setInputFiles('#fileInput', {
      name: 'ref-rows.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')),
    });
    await p.waitForTimeout(900);
    await p.click('#loadBtn');
    await p.waitForFunction(() => /did NOT load|Finished/.test(document.getElementById('uploadState').innerText),
      null, { timeout: 30000 }).catch(() => {});
    const state = (await p.locator('#uploadState').innerText()).replace(/\s+/g, ' ');
    record('one year refused does NOT report the run as finished',
      !/^Finished/.test(state) && /did NOT load/.test(state), state.slice(0, 110));
    record('the summary names which year is missing', /2025-26/.test(state), state.slice(0, 110));
    record('and says not to move the files off the Busy PC',
      /Do not move any file/.test(state));
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

    /* EVERY date field, not "both". There were two when this was written and
       there are five now -- the ledger's From and To and the material-price
       date joined them. Pinning the count to 2 turned a rule about all date
       fields into a rule about the two that existed on the day, which is the
       kind of test that fails for being right. */
    const tips = await p.evaluate(() =>
      Array.from(document.querySelectorAll('input[type=date]'))
        .map(e => ({ id: e.id, tip: e.title })));
    const mute = tips.filter(t => !/T = today/.test(t.tip) || !/Delete = clear/.test(t.tip));
    record('every date field on the page says what the keys are, on hover',
      tips.length >= 2 && mute.length === 0,
      `${tips.length} date fields` +
      (mute.length ? ' — silent: ' + mute.map(m => '#' + m.id).join(', ') : ''));

    // Setting a date must actually search, not just sit there.
    const before = await p.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    await p.locator('#from').focus();
    await p.keyboard.press('t');
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => window.__TEST_DB_CALLS__.filter(c => c.name === 'rpc:busy_search').length);
    record('a date put in with the keyboard searches, like one put in by hand',
      after > before, `${after - before} searches`);

    await p.keyboard.press('Control+Slash');
    await p.waitForTimeout(250);
    const help = await p.evaluate(() =>
      document.getElementById('shortcutPanel').innerText.replace(/\s+/g, ' '));
    record('the date keys are in the shortcut list too',
      /T\b/.test(help) && /Today/.test(help) && /Clear the date/.test(help), help.slice(-70));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
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
      await click('the ' + t + ' tickbox', `#docChips .chip input[data-type="${t}"]`);
    }
    await click('the From date', '#from');
    await click('the To date', '#to');
    await click('how many to show', '#pageSize', 'select');
    await click('the Columns button', '#colBtn');
    for (const c of ['date','fy','type','vch','party','item','desc','qty','rate','amt']) {
      await click('the ' + c + ' column box', `#colList input[data-col="${c}"]`);
    }
    await click('the Columns button again', '#colBtn');
    const menuViews = await p.evaluate(() =>
      Array.from(document.querySelectorAll('#refnav-host button.refnav-item[data-view]'))
        .map(b => b.dataset.view + (b.dataset.firm ? ':' + b.dataset.firm : '')));
    for (const v of menuViews) {
      const [view, firm] = v.split(':');
      clicked.push('menu ' + v);
      await H.go(p, view, firm);
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
        sidebar: box(document.getElementById('refnav-host')),
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

  /* ============ THE MENU IS THE ERP'S, NOT THIS PAGE'S ============ */
  /* What the menu looks like is tested once, in tests/nav.test.js, against
     the one file that draws it. All this page has to prove is that it uses
     that menu rather than keeping one of its own. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    const nav = await p.evaluate(() => ({
      shared: !!document.getElementById('refnav-host'),
      ownMenu: !!document.querySelector('#nav, #sidebarNav'),
      entries: document.querySelectorAll('#refnav-host .refnav-item[data-page]').length,
      reachesOtherPages: [...new Set(Array.from(
        document.querySelectorAll('#refnav-host .refnav-item[data-page]'))
        .map(i => i.dataset.page))].sort(),
    }));
    record('this page uses the ERP\'s shared menu', nav.shared);
    record('and does not keep a second menu of its own', !nav.ownMenu);
    record(`the menu reaches the rest of the ERP from here (${nav.reachesOtherPages.length} pages)`,
      nav.reachesOtherPages.includes('admin.html') && nav.reachesOtherPages.includes('busy.html'),
      nav.reachesOtherPages.join(', '));
    await p.close();
  }

  /* ============ THE LOAD: A YEAR IN CHUNKS, COMPARED ONCE ============
     The fault was a 7,219-row year refused for taking longer than the 8
     seconds a signed-in person is allowed. */
  {
    const { page: p } = await openBusy(server, browser, OWNER);
    await p.waitForSelector('#shell', { state: 'visible' });
    await H.go(p, 'upload');
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
    await H.go(p, 'upload');
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

  /* ---------- A SALES FIGURE IS TAXABLE, AND NET OF RETURNS ----------
     He checked 2026-27 against a number he already knew. The screen said
     2.39 crore; the truth is 1.8 crore. Two faults, both mine: the figure
     carried GST, and it never subtracted what came back -- ten credit
     notes worth 21.6 lakh, including 11 lakh from Gursewak Singh Nijjar.

     These three numbers are HIS, verified against Busy:
         gross 2,02,44,255  -  credit notes 21,63,948  =  net 1,80,80,307
     so the fixture carries them and the screen is held to them. */
  {
    const { page: p3 } = await openBusy(server, browser, OWNER);
    await p3.waitForTimeout(1300);
    await H.go(p3, 'reports', 'REF');
    await p3.waitForTimeout(1300);

    const kpi = await p3.evaluate(() => {
      const first = document.querySelector('#kpis .kpi');
      return first ? first.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    const digits = t => (t.match(/[\d,]{6,}/g) || []).map(x => Number(x.replace(/,/g, '')));
    const shown = digits(kpi);
    record('the headline sales figure is NET, not gross and not GST-inclusive',
      shown.includes(18080307) && !shown.includes(23887252), kpi.slice(0, 90));
    record('and the deduction is shown on the card, not hidden',
      shown.includes(20244255) && shown.includes(2163948) && /credit notes/i.test(kpi),
      kpi.slice(0, 120));
    record('the card says the figure excludes GST',
      /excluding GST/i.test(kpi));

    // No screen anywhere may print the GST-inclusive total as a sale.
    const anywhere = await p3.evaluate(() =>
      document.getElementById('view-reports').textContent.replace(/\s+/g, ' '));
    record('the GST-inclusive total appears nowhere on the reports screen',
      !/2,38,87,252|23887252/.test(anywhere));

    /* ---- THE MATERIAL REPORT ASKS FOR THE ITEM FIRST ----
       It was built backwards: a date and a months-before figure at the top,
       the item search at the bottom. He arrives with "Avon wants another
       slat conveyor, what do I charge?" -- a date asked first assumes he
       already knows which sale he means, and that is what he came to find.

       So the order itself is the thing under test: no setting may be on
       screen until an item has been searched and a sale picked. */
    await p3.evaluate(() => document.querySelector('.rep-tab[data-rep="materials"]').click());
    await p3.waitForTimeout(900);
    const step1 = await p3.evaluate(() => {
      const on = el => el && el.offsetParent !== null;
      return {
        searchShown: on(document.getElementById('matSearch')),
        monthsAsked: on(document.getElementById('matBefore')),
        anyDateAsked: Array.from(document.querySelectorAll('#rep-materials input[type=date]'))
                        .some(e => e.offsetParent !== null),
        salesShown: on(document.getElementById('matSales')),
        panelShown: on(document.getElementById('matPanel')),
      };
    });
    record('the material report asks for the ITEM first, and nothing else',
      step1.searchShown && !step1.monthsAsked && !step1.anyDateAsked
        && !step1.salesShown && !step1.panelShown, JSON.stringify(step1));

    await p3.evaluate(() => {
      const el = document.getElementById('matSearch');
      el.value = 'slat conveyor';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p3.waitForTimeout(900);
    const step2 = await p3.evaluate(() => ({
      sales: document.querySelectorAll('#matSales [data-sale]').length,
      monthsAsked: !!document.getElementById('matBefore'),
      panelShown: document.getElementById('matPanel').offsetParent !== null,
    }));
    record('searching an item shows its sales, and still asks for no settings',
      step2.sales > 1 && !step2.monthsAsked && !step2.panelShown, JSON.stringify(step2));

    await p3.evaluate(() => document.querySelector('#matSales [data-sale]').click());
    await p3.waitForTimeout(1100);
    const step3 = await p3.evaluate(() => {
      const t = document.getElementById('matPanel').textContent.replace(/\s+/g, ' ');
      return {
        monthsOnPanel: !!document.querySelector('#matPanel #matBefore'),
        shareOnPanel: !!document.querySelector('#matPanel #matShare'),
        otherItemOnPanel: !!document.querySelector('#matPanel #matOther'),
        namesTheSale: /Sold to .+, \d/.test(t),
        saysWhichMonth: /Steel priced for/.test(t),
        priorPrices: /charged for this machine before/.test(t),
      };
    });
    record('picking a sale shows the comparison for THAT sale',
      step3.namesTheSale && step3.saysWhichMonth && step3.priorPrices, JSON.stringify(step3));
    record('and the months-before setting lives on that panel, beside what it changes',
      step3.monthsOnPanel && step3.shareOnPanel && step3.otherItemOnPanel,
      JSON.stringify(step3));

    /* THE PRICE HISTORY IS ABOUT ONE MACHINE, NOT ONE NAME.

       Under SKD CONVEYOR the old panel listed an extension at 3.25 lakh
       beside a complete assembly line at 26.25 lakh and called it a price
       history. The server compares the description now, so the panel must
       show what it compared -- and must say "no comparable earlier sale"
       rather than draw an empty box. */
    const hist = await p3.evaluate(() => {
      const el = document.getElementById('matHist');
      const t = el.textContent.replace(/\s+/g, ' ');
      return {
        text: t,
        rows: el.querySelectorAll('.tbl tbody tr').length,
        cards: el.querySelectorAll('.rc').length,
        marksThisOne: /this one/.test(t),
        // Its own element: textContent runs the cells together, so the amount
        // above this line ends "...12,00,000" and "2 sales of" has no edge.
        what: (document.getElementById('matHistWhat') || {}).textContent || '',
      };
    });
    record('the price history says HOW MANY sales it compared, and of what',
      /^2 sales of INCLINED SLAT CONVEYOR, L 24 FT X 3 FT W\b/.test(hist.what),
      hist.what.slice(0, 120));
    record('it prints every matched description, so what was compared can be seen',
      /24 FT L X 3 FT W/.test(hist.text) && /L 24 FT X 3 FT W/.test(hist.text),
      `${hist.rows} rows · ${hist.cards} cards`);
    record('it never lists a sale of a different size under this one\'s heading',
      !/16 FEET/.test(hist.text) && !/20"/.test(hist.text), hist.text.slice(0, 200));
    record('and it says which of them is the sale in hand', hist.marksThisOne);
    record('the rule itself is on the screen, not only in the code',
      /fuzzy on words, exact on numbers/i.test(hist.text) &&
      /no description matches only other sales with no description/i.test(hist.text));
    record('the matched sales are on the phone too, as cards, not a hidden table',
      hist.cards >= 2, `${hist.cards} cards`);

    /* The stub answers the same rows whatever it is asked, so the only place
       the new rule can be checked on this side is the QUESTION. It must carry
       the sale's own description and ask the server to match on it -- and the
       "check another item" box, which has no sale in hand, must not. */
    const asked = await p3.evaluate(() => (window.__TEST_RPCS__ || [])
      .filter(c => c.fn === 'busy_item_price_history').map(c => c.params));
    record('the price history asks the server to match on the description',
      asked.length > 0 && asked[asked.length - 1].p_match_desc === true,
      JSON.stringify(asked[asked.length - 1] || null));
    record('and hands it the description of the sale he picked',
      asked.length > 0 && asked[asked.length - 1].p_desc === 'L 24 FT X 3 FT W',
      String(asked.length && asked[asked.length - 1].p_desc));

    // Sum the parts, compare against the whole -- his rule, now standard.
    await p3.evaluate(() => document.querySelector('.rep-tab[data-rep="items"]').click());
    await p3.waitForTimeout(900);
    const recon = await p3.evaluate(() => document.getElementById('itemCount').textContent
      .replace(/\s+/g, ' ').trim());
    record('the items report sums its parts and compares them with the whole',
      /net sales/i.test(recon) && /cannot be put against a machine|they agree/i.test(recon),
      recon.slice(0, 130));
    await p3.close();
  }

  /* ---------- NEITHER FIRM'S NUMBER ON THE OTHER FIRM'S PAPER ----------
     The ledger prints on a letterhead, and that sheet goes to a customer.
     Putting REF's GSTIN on an RS ledger is not a formatting slip: it is a
     wrong tax document, sent out, over a signature.

     There are exactly two firms and exactly two GST numbers, so the rule
     is simply stated and worth stating: each letterhead carries its own
     number and never the other one. */
  {
    const REF_GSTIN = '03ADVPS6303E1ZI';
    const RS_GSTIN  = '03CCTPS7440B1ZI';
    // LETTERHEAD lives inside the page's own scope, which is right -- it is
    // not a global for anything to reach. So the source is what is read.
    const src = require('fs').readFileSync(require('path').join(H.ROOT, 'busy.html'), 'utf8');
    const block = src.slice(src.indexOf('var LETTERHEAD'), src.indexOf('function stamp'));
    const refPart = block.slice(block.indexOf('REF:'), block.indexOf('RS:'));
    const rsPart  = block.slice(block.indexOf('RS:'));
    record('the REF letterhead carries REF\'s GST number',
      refPart.includes(REF_GSTIN) && !refPart.includes(RS_GSTIN));
    record('the RS letterhead carries RS\'s GST number, and never REF\'s',
      rsPart.includes(RS_GSTIN) && !rsPart.includes(REF_GSTIN));
    // The PAN is the middle ten characters of the GSTIN. Checked rather than
    // trusted, because it was derived and not copied off the invoice.
    record('each PAN is the one inside its own GST number',
      refPart.includes(REF_GSTIN.slice(2, 12)) && rsPart.includes(RS_GSTIN.slice(2, 12)),
      `${REF_GSTIN.slice(2, 12)} and ${RS_GSTIN.slice(2, 12)}`);
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
