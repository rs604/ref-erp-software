/* ============================================================
   Screen-test harness — docs/23-screen-tests.md

   Drives the real pages in a real browser (Chromium via Playwright).
   Nothing here talks to Supabase: app-config.js is swapped for a stub,
   so a test run cannot read or change live company data.

   What it gives a test:
     serve()            static web server over the repo
     open(url, opts)    a browser page with REF stubbed and the screen ready
     snapshot(page)     the state docs/23 section 1 says to record
     diff(before,after) what moved, in plain words
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() });
  }));
}

/* The stub that stands in for app-config.js. `user` is who the browser
   believes is signed in; `handlers` answers REF.call by function name. */
function refStub(user, handlerSrc) {
  return `
window.__TEST_CALLS__ = [];
window.__TEST_HANDLERS__ = ${handlerSrc};
window.REF = {
  URL: 'http://stub.invalid', KEY: 'stub',
  supabase: function () { throw new Error('no supabase in tests'); },
  toLoginEmail: function (v) { return String(v || '').toLowerCase(); },
  signIn: function () { return Promise.resolve({}); },
  signOut: function () { return Promise.resolve({}); },
  sendPasswordReset: function () { return Promise.resolve({}); },
  changePassword: function () { return Promise.resolve({}); },
  getSession: function () { return Promise.resolve({ access_token: 'stub' }); },
  call: function (fn, payload) {
    window.__TEST_CALLS__.push({ fn: fn, payload: payload });
    var h = window.__TEST_HANDLERS__[fn];
    var out = h ? h(payload || {}) : { success: true };
    return Promise.resolve(JSON.parse(JSON.stringify(out)));
  },
  me: function () { return Promise.resolve(${JSON.stringify(user)}); },
  can: function (u, key) { return !!u && (u.is_owner || (u.permissions || []).indexOf(key) !== -1); },
  requireSession: function () { return Promise.resolve(${JSON.stringify(user)}); },
  goToLogin: function () { window.__TEST_REDIRECTED__ = true; }
};`;
}

async function open(server, page, opts) {
  const stub = refStub(opts.user, opts.handlers);
  // app-config.js is replaced, so no test can reach the real project.
  await page.route('**/app-config.js', r => r.fulfill({ contentType: 'text/javascript', body: stub }));
  // Nothing external is fetched during a test run.
  await page.route('**cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: 'window.supabase={createClient:function(){throw new Error("stub")}};' }));
  // Anything not served by the local copy of the repo is refused outright, so a
  // test run cannot depend on, or leak to, the outside world.
  await page.route('**/*', r => {
    const u = r.request().url();
    // fallback(), not continue(): a local request must still reach the
    // app-config.js stub registered above it.
    return u.startsWith(server.url) ? r.fallback() : r.abort();
  });
  await page.goto(server.url + '/' + opts.file, { waitUntil: 'domcontentloaded' });
  return page;
}

/* ---- section 1: the state worth recording before every single action ---- */

const SNAPSHOT_FN = `() => {
  // A stable name for an element, so the same box can be compared before
  // and after even when the surrounding HTML was rewritten.
  function keyOf(el) {
    if (!el || el === document.body || el === document.documentElement) return el ? el.tagName : 'none';
    if (el.id) return '#' + el.id;
    if (el.dataset && el.dataset.permissionId) return 'perm:' + el.dataset.permissionId;
    if (el.dataset && el.dataset.category && el.dataset.action) return 'cat:' + el.dataset.category + '/' + el.dataset.action;
    if (el.dataset && el.dataset.action) return 'col:' + el.dataset.action;
    if (el.dataset && el.dataset.id) return 'row:' + el.dataset.id;
    var parts = [], n = el;
    while (n && n !== document.body) {
      var i = 1, s = n;
      while ((s = s.previousElementSibling)) i++;
      parts.unshift(n.tagName.toLowerCase() + ':' + i);
      n = n.parentElement;
    }
    return parts.join('>');
  }

  // Every element that can actually scroll, not a guessed list of them.
  var scrolls = {};
  document.querySelectorAll('*').forEach(function (el) {
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      scrolls[keyOf(el)] = [el.scrollTop, el.scrollLeft];
    }
  });

  var fields = {};
  document.querySelectorAll('input, select, textarea').forEach(function (el) {
    fields[keyOf(el)] = (el.type === 'checkbox' || el.type === 'radio')
      ? (el.checked ? 'checked' : '') + (el.indeterminate ? '/part' : '')
      : el.value;
  });

  var popups = [];
  document.querySelectorAll('.modal-overlay, [role="dialog"]').forEach(function (el) {
    if (el.offsetParent !== null || getComputedStyle(el).display !== 'none') popups.push(keyOf(el));
  });

  var a = document.activeElement;
  return {
    windowScroll: [window.scrollX, window.scrollY],
    scrolls: scrolls,
    fields: fields,
    popups: popups,
    focus: keyOf(a),
    url: location.href,
    counts: {
      cells: document.querySelectorAll('.perm-cell-checkbox').length,
      rows: document.querySelectorAll('.perm-emp-row').length
    }
  };
}`;

async function snapshot(page) {
  return await page.evaluate('(' + SNAPSHOT_FN + ')()');
}

/* Returns a list of plain-language complaints. Empty list means nothing moved. */
function diff(before, after, expected) {
  expected = expected || {};
  const out = [];

  if (!expected.navigates && before.url !== after.url) {
    out.push('the address changed: ' + before.url + ' -> ' + after.url);
  }
  if (!expected.scrollMayMove) {
    if (before.windowScroll[1] !== after.windowScroll[1]) {
      out.push('the page scrolled: ' + before.windowScroll[1] + ' -> ' + after.windowScroll[1]);
    }
    for (const k of Object.keys(before.scrolls)) {
      if (!(k in after.scrolls)) { out.push('the scrolling area ' + k + ' disappeared'); continue; }
      if (before.scrolls[k][0] !== after.scrolls[k][0]) {
        out.push(k + ' scrolled: ' + before.scrolls[k][0] + ' -> ' + after.scrolls[k][0]);
      }
    }
  }
  // Focus landing on the thing that was just clicked is correct, not a fault.
  if (!expected.focusMayMove && before.focus !== after.focus && after.focus !== expected.focusMayBe) {
    out.push('focus left ' + before.focus + ' and went to ' + after.focus);
  }
  for (const p of before.popups) {
    if (!after.popups.includes(p)) out.push('the popup ' + p + ' closed itself');
  }
  const allowed = new Set(expected.fieldsThatMayChange || []);
  for (const k of Object.keys(before.fields)) {
    if (allowed.has(k)) continue;
    if (!(k in after.fields)) { out.push('the field ' + k + ' vanished'); continue; }
    if (before.fields[k] !== after.fields[k]) {
      out.push('the field ' + k + ' changed on its own: "' + before.fields[k] + '" -> "' + after.fields[k] + '"');
    }
  }
  return out;
}

module.exports = { serve, open, snapshot, diff, chromium, ROOT };
