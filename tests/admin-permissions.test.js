/* ============================================================
   Roles & Permissions screen — docs/23-screen-tests.md

   Section 1 is the one Raghbir found by hand: he ticked a permission
   and the page jumped back to the top. Every clickable thing on this
   screen is clicked here, with the state recorded either side.

   Two things this test is careful about, or it would prove nothing:
     - the browser is told to bring a control into view BEFORE the state
       is recorded. Otherwise the test driver's own scrolling gets blamed
       on the screen
     - focus landing on the thing just clicked is correct, and is allowed

   Run:  NODE_PATH=/opt/node22/lib/node_modules node tests/admin-permissions.test.js
   ============================================================ */
'use strict';
const H = require('./harness');
const DATA = require('./fixtures/permissions-data.json');

const ACTION_COLUMNS = ['view', 'create', 'edit', 'approve', 'cancel'];

const OWNER = {
  id: 'u-owner', name: 'Raghbir Singh', is_owner: true, roles: ['owner'],
  permissions: [], must_change_password: false,
};

const HANDLERS = `{
  'me': function () { return { success: true, user: ${JSON.stringify(OWNER)} }; },
  'hr-actions': function () { return { success: true, requests: [] }; },
  'permissions-actions': function (p) {
    if (p.action === 'get_permissions_data') return Object.assign({ success: true }, ${JSON.stringify(DATA)});
    return { success: true };
  }
}`;

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

(async () => {
  const server = await H.serve();
  const browser = await H.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message + (e.stack ? ' @ ' + e.stack.split('\n')[1].trim() : '')));
  // Requests to the outside world are refused on purpose by the harness, so
  // the browser's complaint about them is not a fault in the screen.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    pageErrors.push('console: ' + m.text());
  });

  // SCREEN lets the same test be pointed at an older copy of the page, to show
  // what a fix actually changed rather than asserting that it did.
  await H.open(server, page, { file: process.env.SCREEN || 'admin.html', user: OWNER, handlers: HANDLERS });
  await page.waitForSelector('#appShell', { state: 'visible' });
  await page.waitForSelector('#refnav-host .refnav-item[data-view="admin-panel"]');
  await H.go(page, 'admin-panel');   // H.go opens the module it lives in first
  await page.waitForSelector('.perm-cell-checkbox');

  const rowCount = await page.locator('.perm-emp-row').count();

  /* ---- how much of the database this screen can actually reach ----
     Checked first, before any clicking moves the selection. */
  {
    const onScreen = await page.evaluate(() =>
      new Set(Array.from(document.querySelectorAll('.perm-cell-checkbox')).map(cb => cb.dataset.permissionId)).size);
    const noColumn = DATA.permissions.filter(p => !ACTION_COLUMNS.includes(p.action)).map(p => p.key);
    const shared = [];
    const seen = new Set();
    DATA.permissions.forEach(p => {
      const k = p.category + '|' + p.sub_head + '|' + p.action;
      if (seen.has(k)) shared.push(p.key); else seen.add(k);
    });
    record(`every permission in the database has a box of its own (${onScreen} of ${DATA.permissions.length})`,
      onScreen === DATA.permissions.length,
      `no column for its action: ${noColumn.join(', ') || 'none'} · sharing one box with another permission: ${shared.join(', ') || 'none'}`);
  }

  // Put both columns somewhere other than the top, or nothing is being proved.
  const park = () => page.evaluate(() => {
    const d = document.getElementById('permDetailScrollArea');
    if (d) d.scrollTop = 240;
    // The older page had no id on its employee list; find it by shape instead,
    // so the same test can be run against both.
    const l = document.getElementById('permEmpListScroll')
      || document.querySelector('.perm-emp-row')?.parentElement;
    if (l) l.scrollTop = 60;
  });

  /* ================= 1. NOTHING MOVES THAT SHOULD NOT ================= */

  // One click, fully instrumented: bring it into view, record, click, record.
  async function clickAndCheck(el, mayChange) {
    await el.scrollIntoViewIfNeeded();
    const key = await el.evaluate(e => {
      if (e.dataset.permissionId) return 'perm:' + e.dataset.permissionId;
      if (e.dataset.category && e.dataset.action) return 'cat:' + e.dataset.category + '/' + e.dataset.action;
      if (e.dataset.action) return 'col:' + e.dataset.action;
      if (e.dataset.id) return 'row:' + e.dataset.id;
      return e.id ? '#' + e.id : e.tagName;
    });
    const before = await H.snapshot(page);
    await el.click();
    const after = await H.snapshot(page);
    return { problems: H.diff(before, after, { fieldsThatMayChange: mayChange, focusMayBe: key }), key, before, after };
  }

  async function sweep(selector, label, mayChangeFor) {
    await park();
    const n = await page.locator(selector).count();
    let kept = 0, moved = 0, toggled = 0;
    const complaints = [];
    for (let i = 0; i < n; i++) {
      const el = page.locator(selector).nth(i);
      const isBox = await el.evaluate(e => e.type === 'checkbox');
      const was = isBox ? await el.evaluate(e => e.checked) : null;
      const mayChange = await mayChangeFor(el);
      const { problems } = await clickAndCheck(el, mayChange);
      if (problems.length === 0) kept++; else { moved++; complaints.push('#' + i + ' ' + problems[0]); }
      if (isBox && await el.evaluate(e => e.checked) !== was) toggled++;
    }
    record(`${label}: clicked ${n} · ${kept} kept scroll · ${moved} moved`,
      moved === 0, complaints.slice(0, 4).join(' | '));
    return { n, toggled };
  }

  // A permission box may change itself and the category roll-up above it.
  const cells = await sweep('.perm-cell-checkbox', 'permission checkboxes', async el => {
    const d = await el.evaluate(e => ({ p: e.dataset.permissionId, c: e.dataset.category, a: e.dataset.action }));
    return ['perm:' + d.p, 'cat:' + d.c + '/' + d.a];
  });
  record(`every permission checkbox actually ticked (${cells.toggled} of ${cells.n})`, cells.toggled === cells.n);

  // A category box may change the boxes underneath it, in its own column.
  await sweep('.perm-category-checkbox', 'category roll-up boxes', async el => {
    const d = await el.evaluate(e => ({ c: e.dataset.category, a: e.dataset.action }));
    return await page.evaluate(o => {
      const keys = ['cat:' + o.c + '/' + o.a];
      document.querySelectorAll('.perm-cell-checkbox').forEach(cb => {
        if (cb.dataset.category === o.c && cb.dataset.action === o.a) keys.push('perm:' + cb.dataset.permissionId);
      });
      return keys;
    }, d);
  });

  // A column header may change everything in its column.
  await sweep('.perm-col-header', 'column headers', async el => {
    const a = await el.evaluate(e => e.dataset.action);
    return await page.evaluate(act => {
      const keys = [];
      document.querySelectorAll('.perm-cell-checkbox').forEach(cb => {
        if (cb.dataset.action === act) keys.push('perm:' + cb.dataset.permissionId);
      });
      document.querySelectorAll('.perm-category-checkbox').forEach(cb => {
        if (cb.dataset.action === act) keys.push('cat:' + cb.dataset.category + '/' + cb.dataset.action);
      });
      return keys;
    }, a);
  });

  // Grant All and Revoke All change every box, but must not move the page.
  {
    const everyBox = await page.evaluate(() => {
      const k = [];
      document.querySelectorAll('.perm-cell-checkbox').forEach(cb => k.push('perm:' + cb.dataset.permissionId));
      document.querySelectorAll('.perm-category-checkbox').forEach(cb => k.push('cat:' + cb.dataset.category + '/' + cb.dataset.action));
      return k;
    });
    for (const [id, label] of [['permRevokeAllBtn', 'Revoke All'], ['permGrantAllBtn', 'Grant All']]) {
      await park();
      const { problems } = await clickAndCheck(page.locator('#' + id), everyBox);
      record(`${label}: kept scroll`, problems.length === 0, problems.slice(0, 2).join(' | '));
    }
    const allOn = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.perm-cell-checkbox')).every(cb => cb.checked));
    record('Grant All actually ticked every box on the screen', allOn);
    // Untick ONE box in a category that has several under the same action.
    // Unticking the only box in a category would leave it plainly empty and
    // would prove nothing.
    const partial = await page.evaluate(() => {
      const counts = {};
      document.querySelectorAll('.perm-cell-checkbox').forEach(cb => {
        const k = cb.dataset.category + '/' + cb.dataset.action;
        (counts[k] = counts[k] || []).push(cb);
      });
      const group = Object.values(counts).find(g => g.length > 1);
      if (!group) return 'no category has two boxes in one column';
      group[0].click();
      const box = Array.from(document.querySelectorAll('.perm-category-checkbox'))
        .find(b => b.dataset.category === group[0].dataset.category && b.dataset.action === group[0].dataset.action);
      return box ? (box.indeterminate ? true : 'the box reads ' + (box.checked ? 'fully ticked' : 'empty'))
                 : 'no roll-up box found';
    });
    record('a part-ticked category reads as part-ticked, not as empty', partial === true, String(partial));
  }

  /* ================= 8. AFTER SAVING ================= */
  {
    await park();
    // Any one box will do here — what is being tested is what SAVING does,
    // not which permission was ticked. Position in a list of equivalent
    // controls is fine; position of a cell inside a row is not.
    await page.locator('.perm-cell-checkbox').first().click();
    await page.evaluate(() => { document.getElementById('permDetailScrollArea').scrollTop = 240; });
    const before = await H.snapshot(page);
    await page.click('#permSaveBtn');
    await page.waitForFunction(() => document.getElementById('permMsg')?.textContent === 'Saved.', null, { timeout: 5000 })
      .catch(() => {});
    const after = await H.snapshot(page);
    const problems = H.diff(before, after, { fieldsThatMayChange: [], focusMayMove: true });
    record('saving kept the scroll position in both columns', problems.length === 0, problems.slice(0, 3).join(' | '));
    record('Save switches itself off again once saved',
      await page.locator('#permSaveBtn').evaluate(b => b.disabled) === true);
    record('the save is confirmed on screen without a reload',
      (await page.locator('#permMsg').textContent()).trim() === 'Saved.');
    const badge = await page.evaluate(() =>
      document.querySelector('.perm-emp-row.active .perm-emp-access')?.textContent);
    record('the list badge caught up with what was saved', badge === 'HAS ACCESS', String(badge));
  }

  /* ================= picking a different person ================= */
  {
    await park();
    // Named, not counted. "the fifth row that is not active" happened to miss
    // the Owner today; a change to the fixture order would have had this test
    // quietly checking the one person who has no grid at all.
    const target = page.locator('.perm-emp-row:not(.active)')
      .filter({ hasNotText: 'Raghbir Singh' }).first();
    const targetId = await target.evaluate(e => e.dataset.id);
    const { problems, before, after } = await clickAndCheck(target, null);
    const listBefore = before.scrolls['#permEmpListScroll']?.[0];
    const listAfter = after.scrolls['#permEmpListScroll']?.[0];
    record('picking a different person left the employee list where it was',
      listBefore === listAfter, `${listBefore} -> ${listAfter}`);
    record('the window itself did not scroll', before.windowScroll[1] === after.windowScroll[1]);
    record('the person clicked is the one now highlighted',
      await page.evaluate(() => document.querySelector('.perm-emp-row.active')?.dataset.id) === targetId);
    record('the grid was rebuilt for the new person, as it should be',
      await page.locator('.perm-cell-checkbox').count() > 0);
    void problems;
  }

  /* ================= 5. THE LIST SCREEN ================= */
  {
    await park();
    const before = await H.snapshot(page);
    await page.locator('#permSearchInput').click();
    await page.locator('#permSearchInput').type('ar');
    const after = await H.snapshot(page);
    record('typing in the search box left the permission grid where it was',
      before.scrolls['#permDetailScrollArea']?.[0] === after.scrolls['#permDetailScrollArea']?.[0],
      `${before.scrolls['#permDetailScrollArea']?.[0]} -> ${after.scrolls['#permDetailScrollArea']?.[0]}`);
    record('the search box keeps the cursor while typing',
      await page.evaluate(() => document.activeElement?.id === 'permSearchInput'));
    const filtered = await page.locator('.perm-emp-row').count();
    record(`search narrowed the list (${rowCount} -> ${filtered})`, filtered > 0 && filtered < rowCount);
    await page.fill('#permSearchInput', '');
    record('clearing the search brings everyone back',
      await page.locator('.perm-emp-row').count() === rowCount);

    await page.selectOption('#permDeptFilterSelect', { index: 1 });
    const byDept = await page.locator('.perm-emp-row').count();
    record(`the department filter filters (${rowCount} -> ${byDept})`, byDept > 0 && byDept < rowCount);
    await page.selectOption('#permStatusFilterSelect', 'suspended');
    const both = await page.locator('.perm-emp-row').count();
    record('the two filters work together rather than replacing each other', both <= byDept);
    await page.selectOption('#permDeptFilterSelect', 'all');
    await page.selectOption('#permStatusFilterSelect', 'all');
    record('clearing both filters brings everyone back',
      await page.locator('.perm-emp-row').count() === rowCount);
  }

  /* ================= 10. PERMISSIONS ARE REAL ================= */
  {
    const owner = page.locator('.perm-emp-row').filter({ hasText: 'Raghbir Singh' }).first();
    await owner.scrollIntoViewIfNeeded();
    await owner.click();
    const grid = await page.locator('.perm-cell-checkbox').count();
    const saysWhy = (await page.locator('#permDetailScrollArea').textContent()).includes('automatic full access');
    record('the Owner shows no grid to tick, and says why', grid === 0 && saysWhy);
  }

  /* ---- the menu must actually reach the screens ---- */
  {
    const menu = await page.evaluate(() => {
      const list = document.getElementById('refnav-list');
      // The top level only: Home, then the modules, then the owner section.
      const top = Array.from(list.children).filter(n =>
        n.classList.contains('refnav-item') || n.classList.contains('refnav-soon'));
      return {
        order: top.map(n => n.querySelector('.lbl') ? n.querySelector('.lbl').textContent.trim()
                                                    : n.textContent.trim()),
        reachesBusy: list.querySelectorAll('.refnav-item[data-page="busy.html"]').length,
      };
    });
    record('the ERP menu actually reaches Busy Data', menu.reachesBusy > 0,
      `${menu.reachesBusy} Busy Data screens in the menu`);
    record('Busy Data is the second item in the main menu, straight after Home',
      menu.order[0] === 'Home' && menu.order[1] === 'Busy Data', menu.order.join(' · '));
  }

  record('no script errors anywhere in the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();

  const pass = results.filter(r => r.ok).length;
  console.log('\nRoles & Permissions — docs/23 sections 1, 5, 8 and 10\n');
  for (const r of results) {
    console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '\n           ' + r.detail : ''));
  }
  console.log(`\n${pass} of ${results.length} passed\n`);
  process.exit(pass === results.length ? 0 : 1);
})();
