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
function refStub(user, handlerSrc, dataSrc) {
  return `
window.__TEST_CALLS__ = [];
window.__TEST_HANDLERS__ = ${handlerSrc};
/* Stands in for the Supabase client. Every builder method returns the same
   object, so any chain the screen writes -- .from(t).select().eq().order()
   .limit() -- works without the harness having to know which methods exist.
   Awaiting it resolves with whatever the test put under that table or
   function name. Nothing leaves the browser. */
window.__TEST_DATA__ = ${dataSrc || '{}'};
window.__TEST_DB_CALLS__ = [];
/* A SERVER THAT IS ASKED FOR "hero" DOES NOT SEND BACK EVERYTHING.

   The stub used to answer with the whole fixture whatever the arguments
   were, which made a screenshot of the party dropdown show four names with
   no "hero" in them -- flattering the picture and hiding whether the list
   was showing what it was given. So when a call carries p_query, the stub
   filters the rows it returns the way the database would: every typed word
   somewhere in the row's name. It is still not the database's fuzzy match
   -- "mottor" finds nothing here and finds HERO MOTORS there -- and that
   difference is deliberate: a test may not claim the fuzzy matching works. */
function __stubFilter(rows, q) {
  var words = String(q || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length || !Array.isArray(rows)) return rows;
  return rows.filter(function (r) {
    if (!r || typeof r !== 'object') return true;
    var name = String(r.ledger || r.item || r.customer || r.party || '').toUpperCase();
    if (!name) return true;
    return words.every(function (w) { return name.indexOf(w) !== -1; });
  });
}
/* The same key busy_name_key() builds in the database. */
function __stubNameKey(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
    .split(/\s+/).filter(Boolean)
    .map(function (w) { return (w.length > 3 && w.slice(-1) === 'S') ? w.slice(0, -1) : w; })
    .join(' ');
}
function __stubResult(name, args) {
  window.__TEST_DB_CALLS__.push({ name: name, args: args });
  var v = window.__TEST_DATA__[name];
  if (typeof v === 'function') v = v(args);
  if (v === undefined) return { data: [], error: null };
  if (v && v.error) return { data: null, error: v.error };
  // Only the lookup lists a picker asks per keystroke. busy_search also
  // takes a p_query, and it is the DATABASE's search -- filtering its rows
  // here by a substring would quietly rewrite what that screen is testing.
  if (name === 'rpc:busy_party_list' && args && args.p_query) {
    v = __stubFilter(v, args.p_query);
  }
  /* NEARLY THE SAME NAME IS A RULE, NOT A FIXTURE. The stub answered the
     near-identical-name list for EVERY party, so a note about R S
     INDUSTRIES appeared over HINDON METAFORMS' ledger and pushed the
     first entry off the first screen. The rule is small enough to keep
     honest here: spacing, punctuation and plurals out, then compare. */
  if (name === 'rpc:busy_similar_ledgers' && Array.isArray(v)) {
    var want = __stubNameKey(args && args.p_ledger);
    v = v.filter(function (r) { return __stubNameKey(r && r.ledger) === want; });
  }
  /* A LEDGER ECHOES THE PARTY IT WAS ASKED ABOUT. The stub answered with
     the fixture's party whatever was asked, and the near-identical-name
     note -- which names the ledger whose balance is on screen -- came out
     saying "This one is HINDON METAFORMS" over R S INDUSTRIES' figures.
     The page was right; the stub was lying, and only the screenshot said
     so. */
  if (name === 'rpc:busy_ledger' && args && args.p_party &&
      v && typeof v === 'object' && !Array.isArray(v) && 'party' in v) {
    v = Object.assign({}, v, { party: args.p_party });
  }
  return { data: v, error: null };
}
function __stubBuilder(name, args) {
  var single = false;
  var box = {};
  var proxy = new Proxy(box, {
    get: function (t, prop) {
      if (prop === 'then') {
        return function (resolve, reject) {
          var r = __stubResult(name, args);
          if (single) r = { data: (r.data && r.data[0]) || null, error: r.error };
          return Promise.resolve(r).then(resolve, reject);
        };
      }
      if (prop === 'catch') return function (f) { return Promise.resolve(__stubResult(name, args)).catch(f); };
      if (prop === 'single' || prop === 'maybeSingle') {
        return function () { single = true; return proxy; };
      }
      return function () { return proxy; };
    }
  });
  return proxy;
}
window.__TEST_RPCS__ = [];
window.__TEST_SUPABASE__ = {
  from: function (t) { return __stubBuilder('table:' + t, null); },
  /* Recorded, so a test can ask what the page ASKED FOR and not only what it
     drew with what came back. The stub answers the same fixture whatever the
     arguments, so "is the right question being asked" has to be checked on
     the question. */
  rpc: function (fn, params) {
    window.__TEST_RPCS__.push({ fn: fn, params: params || {} });
    return __stubBuilder('rpc:' + fn, params);
  },
  storage: {
    from: function (b) {
      return {
        createSignedUrl: function () {
          return Promise.resolve({ data: { signedUrl: 'blob:stub-download' }, error: null });
        },
        list: function () { return Promise.resolve({ data: [], error: null }); }
      };
    }
  },
  auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'stub' } } }); } }
};
window.REF = {
  URL: 'http://stub.invalid', KEY: 'stub',
  supabase: function () { return window.__TEST_SUPABASE__; },
  toLoginEmail: function (v) { return String(v || '').toLowerCase(); },
  signIn: function () { return Promise.resolve({}); },
  signOut: function () { return Promise.resolve({}); },
  sendPasswordReset: function () { return Promise.resolve({}); },
  changePassword: function () { return Promise.resolve({}); },
  /* A cold arrival with no session at all: a null user means nobody is
     signed in, and the pages must behave as they do for a stranger. */
  getSession: function () { return Promise.resolve(${user ? "{ access_token: 'stub' }" : 'null'}); },
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
  const stub = refStub(opts.user, opts.handlers, opts.data);
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

/* Go to a screen the way a person does: through the shared menu. The module
   it lives in is opened first, because docs/11 keeps modules collapsed until
   they are asked for. One helper, so a test never has to know the menu's
   markup -- that knowledge belongs in nav.js and nowhere else. */
async function go(page, view, firm) {
  await page.evaluate(function (a) {
    var sel = '#refnav-host .refnav-item[data-view="' + a.view + '"]' +
              (a.firm ? '[data-firm="' + a.firm + '"]' : '');
    var item = document.querySelector(sel);
    if (!item) throw new Error('no menu entry for ' + a.view + (a.firm ? ' ' + a.firm : ''));
    var kids = item.closest('.refnav-children');
    if (kids && !kids.classList.contains('open')) {
      var toggle = document.querySelector('.refnav-item[data-toggle="' + kids.id + '"]');
      if (toggle) toggle.click();
    }
    item.click();
  }, { view: view, firm: firm || null });
  await page.waitForTimeout(400);
}

module.exports = { serve, open, snapshot, diff, go, chromium, ROOT };
