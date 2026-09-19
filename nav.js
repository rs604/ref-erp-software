/* ============================================================
   THE ERP'S NAVIGATION — one file, every page.

   Raghbir opened the ERP and found there was no way to get from one
   screen to another. index.html, submit.html and reset.html had no menu
   at all; admin.html and busy.html each had their own, written by hand,
   and neither could reach the other's screens. He had been reaching
   admin.html by bookmark for weeks, so nobody noticed.

   So: ONE definition of the menu, ONE piece of behaviour, loaded by
   every page. Adding a screen means adding a line to MENU below, and it
   appears everywhere at once. There is no second copy to forget.

   A page mounts it with:

     REFNav.mount({
       page:   'admin.html',        // which page this is
       user:   user,                // from REF.requireSession()
       onView: function (v) {...}   // switch to a view inside THIS page
     });

   A leaf that belongs to this page calls onView. A leaf that belongs to
   another page is a link to it. Same list either way, so a person never
   has to know which screen lives in which file.
   ============================================================ */
(function () {
  'use strict';

  /* ---- THE MENU, as locked in docs/11 ----------------------------------
     Order: Home · Busy Data · Masters · Purchase · Accounts · Production ·
     Reports · Settings, then a divider and OWNER ONLY.

     Busy Data sits second because it is what Raghbir opens most.

     HRMS is not in the docs/11 list, which was written before the salary
     sheet, the km tracker and the loans screen existed. They are live and
     used daily, so they are in the menu rather than unreachable. Worth
     Raghbir's decision: keep HRMS as its own module, or fold it in.

     built:false is a screen that does not exist yet. It is shown to
     EVERYONE, greyed and not clickable, because the shape of the ERP is
     worth seeing while it is being built. That is a different question
     from permission, which removes an entry altogether.                 */
  var MENU = [
    // Home is the DASHBOARD: approvals waiting, and the state of the
    // business -- what Raghbir looks at first thing. It is thin today and
    // fills in later; the menu points at it either way.
    { label: 'Home', icon: 'home', page: 'admin.html', view: 'home' },

    { label: 'Busy Data', icon: 'database', children: [
      { section: 'REF' },
      { label: 'Price History',  page: 'busy.html', view: 'price',    firm: 'REF', perm: 'busy_data.view' },
      { label: 'Challans',       page: 'busy.html', view: 'challans', firm: 'REF', perm: 'busy_data.view' },
      { label: 'Ledger',         page: 'busy.html', view: 'ledger',   firm: 'REF', perm: 'busy_data.view' },
      { label: 'Reports',        page: 'busy.html', view: 'reports',  firm: 'REF', perm: 'busy_data.view' },
      { label: 'Deleted in Busy', page: 'busy.html', view: 'deleted', firm: 'REF', owner: true },
      { section: 'RS' },
      { label: 'Price History',  page: 'busy.html', view: 'price',    firm: 'RS', perm: 'busy_data.view' },
      { label: 'Challans',       page: 'busy.html', view: 'challans', firm: 'RS', perm: 'busy_data.view' },
      { label: 'Ledger',         page: 'busy.html', view: 'ledger',   firm: 'RS', perm: 'busy_data.view' },
      { label: 'Reports',        page: 'busy.html', view: 'reports',  firm: 'RS', perm: 'busy_data.view' },
      { label: 'Deleted in Busy', page: 'busy.html', view: 'deleted', firm: 'RS', owner: true },
      { section: 'Loading' },
      { label: 'Load history',   page: 'busy.html', view: 'upload',   owner: true },
      { label: 'Download the uploader', page: 'busy.html', view: 'download', owner: true },
      { label: 'Setup instructions',    page: 'busy.html', view: 'setup',    owner: true },
    ] },

    { label: 'HRMS', icon: 'people', children: [
      { label: 'Km Tracker',        page: 'admin.html', view: 'km-tracker',        perm: 'km_tracker.view' },
      { label: 'Add a km reading',  page: 'submit.html',                            perm: 'km_tracker.submit' },
      { label: 'Salary Calculator', page: 'admin.html', view: 'salary-calculator', perm: 'payroll.view' },
      { label: 'Loans & Advances',  page: 'admin.html', view: 'loans-advances',    perm: 'loans_advances.view' },
    ] },

    { label: 'Masters', icon: 'box', children: [
      { label: 'Items',     built: false },
      { label: 'Units',     built: false },
      { label: 'Vendors',   page: 'admin.html', view: 'vendor-master',   perm: 'vendor_master.view' },
      { label: 'Customers', built: false },
      { label: 'Employees', page: 'admin.html', view: 'employee-master', perm: 'employee_master.view' },
    ] },

    { label: 'Purchase', icon: 'cart', children: [
      { label: 'Requests',  built: false },
      { label: 'Orders',    built: false },
      { label: 'Follow-up', built: false },
      { label: 'Approvals', built: false },
    ] },

    { label: 'Accounts', icon: 'rupee', children: [
      { label: 'Purchase invoices', built: false },
      { label: 'Payments',          built: false },
      { label: 'Advances',          built: false },
    ] },

    { label: 'Production', icon: 'factory', built: false },
    { label: 'Reports',    icon: 'chart',   built: false },

    { label: 'Settings', icon: 'gear', children: [
      { label: 'Users & permissions', page: 'admin.html', view: 'admin-panel',  perm: 'admin.users' },
      { label: 'HR dropdowns',        page: 'admin.html', view: 'hr-dropdowns', perm: 'employee_master.view' },
    ] },

    { divider: true, label: 'OWNER ONLY' },
    { label: 'Decisions', icon: 'book', page: 'admin.html', view: 'documentation', owner: true },
    { label: 'Checklist', icon: 'check', owner: true, built: false },
  ];

  /* One small set of icons, drawn once. A menu entry names one. */
  var ICONS = {
    home:     'M3 12l9-9 9 9M5 10v10h14V10',
    database: 'M3 5c0-1.1 4-2 9-2s9 .9 9 2v14c0 1.1-4 2-9 2s-9-.9-9-2zM3 5c0 1.1 4 2 9 2s9-.9 9-2M3 12c0 1.1 4 2 9 2s9-.9 9-2',
    people:   'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    box:      'M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7.3L12 12l8.7-4.7M12 12v9',
    cart:     'M9 20a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM19 20a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6',
    rupee:    'M6 4h12M6 9h12M15 4c0 5-3 5-6 5l8 11',
    factory:  'M3 21h18M5 21V10l5 3V10l5 3V7l4 2v12',
    chart:    'M3 3v18h18M7 15l4-5 3 3 5-7',
    gear:     'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    book:     'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z',
    check:    'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  };

  var CSS = [
    '.refnav-shell { display:flex; min-height:100vh; }',
    '.refnav { width:232px; flex:0 0 232px; background:#1a2229; color:#fff;',
    '  display:flex; flex-direction:column; position:sticky; top:0; height:100vh; overflow-y:auto; }',
    '.refnav-brand { padding:18px 18px 14px; border-bottom:1px solid rgba(255,255,255,.1); }',
    '.refnav-brand .n { font-weight:700; font-size:16px; letter-spacing:1.5px; }',
    '.refnav-brand .t { font-size:12px; color:rgba(255,255,255,.55); letter-spacing:1.4px; margin-top:2px; }',
    '.refnav-list { flex:1; padding:10px 8px; }',
    '.refnav-item { display:flex; align-items:center; gap:10px; width:100%;',
    '  background:none; border:0; color:rgba(255,255,255,.82); font:inherit; font-size:13px;',
    '  text-align:left; padding:9px 10px; border-radius:6px; cursor:pointer; text-decoration:none; }',
    '.refnav-item:hover { background:rgba(255,255,255,.09); color:#fff; }',
    '.refnav-item.active { background:rgba(255,255,255,.14); color:#fff; font-weight:600; }',
    '.refnav-item svg { width:17px; height:17px; flex:0 0 17px; }',
    '.refnav-item .lbl { flex:1; min-width:0; }',
    '.refnav-arrow { width:13px; height:13px; transition:transform .15s ease; opacity:.65; }',
    '.refnav-item.open .refnav-arrow { transform:rotate(90deg); }',
    '.refnav-children { display:none; padding-left:12px; }',
    '.refnav-children.open { display:block; }',
    '.refnav-children .refnav-item { font-size:12.5px; padding-left:14px; }',
    '.refnav-section { font-size:12px; letter-spacing:.8px; text-transform:uppercase;',
    '  color:rgba(255,255,255,.4); padding:9px 12px 3px; }',
    '.refnav-divider { border-top:1px solid rgba(255,255,255,.12); margin:10px 6px 2px; }',
    /* A screen that is not built yet says so. It is never a working-looking
       button that does nothing. */
    '.refnav-soon { display:flex; align-items:center; gap:10px; padding:9px 10px;',
    '  font-size:13px; color:rgba(255,255,255,.34); cursor:default; }',
    '.refnav-soon svg { width:17px; height:17px; flex:0 0 17px; opacity:.5; }',
    '.refnav-soon .lbl { flex:1; min-width:0; }',
    /* 12px is the floor for anything anyone has to read -- docs/23 section 9.
       This said "not built yet" at 11.5px and the phone test caught it. */
    '.refnav-soon .tag { font-size:12px; font-style:italic; white-space:nowrap; }',
    '.refnav-children .refnav-soon { font-size:12.5px; padding-left:14px; }',
    '.refnav-foot { padding:12px 18px; border-top:1px solid rgba(255,255,255,.1);',
    '  font-size:12px; color:rgba(255,255,255,.45); }',
    /* The hamburger only exists where the menu cannot. */
    '.refnav-open-btn { display:none; background:none; border:1px solid #d9dfe5; border-radius:8px;',
    '  color:#1a2229; cursor:pointer; flex:0 0 auto; width:44px; height:44px;',
    '  align-items:center; justify-content:center; }',
    '.refnav-backdrop { display:none; }',
    '@media (max-width:880px) {',
    '  .refnav-shell { flex-direction:column; }',
    '  .refnav-open-btn { display:inline-flex; }',
    '  .refnav { position:fixed; top:0; left:0; bottom:0; width:272px; max-width:84vw;',
    '    height:100vh; flex:none; transform:translateX(-100%); transition:transform .18s ease;',
    '    z-index:70; box-shadow:2px 0 18px rgba(15,23,32,.28); }',
    '  .refnav-shell.refnav-on .refnav { transform:none; }',
    '  .refnav-backdrop { display:block; position:fixed; inset:0; background:rgba(15,23,32,.45);',
    '    z-index:65; opacity:0; pointer-events:none; transition:opacity .18s ease; }',
    '  .refnav-shell.refnav-on .refnav-backdrop { opacity:1; pointer-events:auto; }',
    '  .refnav-item, .refnav-soon { min-height:44px; }',
    '}',
  ].join('\n');

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
           '<path d="' + path + '"/></svg>';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Absent, never greyed. Someone without the permission does not learn
     that the screen exists. */
  /* TWO DIFFERENT REASONS, TWO DIFFERENT ANSWERS.

     NOT ALLOWED  -> absent. A greyed row still tells someone the screen
                     exists, and who may see it is not their business.
     NOT BUILT    -> shown, greyed, not clickable. Everyone sees it. A menu
                     that grows an item every week looks unfinished; a menu
                     that is complete with some of it greyed looks like a
                     plan, and that is what it is.

     So `built:false` is NOT a permission question and is never filtered
     here. Only `owner` and `perm` are. */
  function allowed(entry, user) {
    if (entry.owner && !(user && user.is_owner)) return false;
    if (entry.perm && !(window.REF && window.REF.can(user, entry.perm))) return false;
    return true;
  }

  /* A module with nothing left inside it after permissions is not shown at
     all -- an empty heading is worse than no heading. */
  function visibleChildren(entry, user) {
    if (!entry.children) return null;
    var out = [], pending = null;
    entry.children.forEach(function (c) {
      if (c.section) { pending = c; return; }
      if (!allowed(c, user)) return;
      if (pending) { out.push(pending); pending = null; }
      out.push(c);
    });
    return out;
  }

  function leafHtml(leaf, opts, idx) {
    if (leaf.section) return '<div class="refnav-section">' + esc(leaf.label || leaf.section) + '</div>';
    if (leaf.built === false) {
      return '<div class="refnav-soon" aria-disabled="true"><span class="lbl">' + esc(leaf.label) +
             '</span><span class="tag">not built yet</span></div>';
    }
    var here = (leaf.page === opts.page);
    var attrs = ' data-nav="' + idx + '"' +
                (leaf.firm ? ' data-firm="' + esc(leaf.firm) + '"' : '') +
                (leaf.view ? ' data-view="' + esc(leaf.view) + '"' : '') +
                ' data-page="' + esc(leaf.page) + '"';
    if (here && leaf.view) {
      return '<button type="button" class="refnav-item"' + attrs + '>' +
             '<span class="lbl">' + esc(leaf.label) + '</span></button>';
    }
    var href = leaf.page + (leaf.view ? '#' + encodeURIComponent(leaf.view) +
               (leaf.firm ? ':' + encodeURIComponent(leaf.firm) : '') : '');
    return '<a class="refnav-item" href="' + esc(href) + '"' + attrs + '>' +
           '<span class="lbl">' + esc(leaf.label) + '</span></a>';
  }

  function render(opts) {
    var user = opts.user, html = '', n = 0;
    MENU.forEach(function (entry) {
      if (entry.divider) {
        if (!(user && user.is_owner)) return;
        html += '<div class="refnav-divider"></div><div class="refnav-section">' +
                esc(entry.label) + '</div>';
        return;
      }
      if (!allowed(entry, user)) return;

      if (entry.children) {
        var kids = visibleChildren(entry, user);
        var real = kids.filter(function (k) { return !k.section; });
        if (!real.length) return;
        var id = 'refnav-kids-' + (n++);
        var openNow = real.some(function (k) { return k.page === opts.page; });
        html += '<button type="button" class="refnav-item' + (openNow ? ' open' : '') +
                '" data-toggle="' + id + '">' +
                svg(ICONS[entry.icon] || ICONS.box) +
                '<span class="lbl">' + esc(entry.label) + '</span>' +
                '<svg class="refnav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg>' +
                '</button><div class="refnav-children' + (openNow ? ' open' : '') + '" id="' + id + '">';
        kids.forEach(function (k) { html += leafHtml(k, opts, n++); });
        html += '</div>';
        return;
      }

      if (entry.built === false) {
        html += '<div class="refnav-soon" aria-disabled="true">' + svg(ICONS[entry.icon] || ICONS.box) +
                '<span class="lbl">' + esc(entry.label) + '</span>' +
                '<span class="tag">not built yet</span></div>';
        return;
      }
      html += leafHtml(
        { label: entry.label, page: entry.page, view: entry.view, firm: entry.firm },
        opts, n++).replace('<span class="lbl">', svg(ICONS[entry.icon] || ICONS.box) + '<span class="lbl">');
    });
    return html;
  }

  /* What the address bar says this page should be showing. Written by the
     menu when it sends you to another page, read by that page on arrival. */
  function fromHash() {
    var h = decodeURIComponent(String(window.location.hash || '').replace(/^#/, ''));
    if (!h) return null;
    var bits = h.split(':');
    return { view: decodeURIComponent(bits[0]), firm: bits[1] ? decodeURIComponent(bits[1]) : null };
  }

  function mount(opts) {
    opts = opts || {};
    if (!document.getElementById('refnav-style')) {
      var st = document.createElement('style');
      st.id = 'refnav-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    var host = document.getElementById(opts.into || 'refnav-host');
    if (!host) return null;
    host.className = 'refnav';
    host.innerHTML =
      '<div class="refnav-brand"><div class="n">REF</div><div class="t">ERP</div></div>' +
      '<nav class="refnav-list" id="refnav-list">' + render(opts) + '</nav>' +
      '<div class="refnav-foot">Raghbir Erectors &amp; Fabricators</div>';

    var shell = host.closest('.refnav-shell') || host.parentElement;
    var backdrop = shell.querySelector('.refnav-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'refnav-backdrop';
      shell.insertBefore(backdrop, shell.firstChild);
    }

    var btn = document.querySelector('.refnav-open-btn');

    function setOpen(open) {
      shell.classList.toggle('refnav-on', open);
      if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
      }
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) {
        var first = host.querySelector('.refnav-item');
        if (first) first.focus();
      }
    }
    function isOpen() { return shell.classList.contains('refnav-on'); }

    if (btn) btn.addEventListener('click', function () { setOpen(!isOpen()); });
    backdrop.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { setOpen(false); if (btn) btn.focus(); }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 880 && isOpen()) setOpen(false);
    });

    /* Bound once, to the list, so a menu entry added to MENU later needs no
       wiring of its own. */
    host.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        var kids = document.getElementById(toggle.dataset.toggle);
        if (kids) { kids.classList.toggle('open'); toggle.classList.toggle('open'); }
        return;
      }
      var item = e.target.closest('.refnav-item[data-page]');
      if (!item) return;
      // Picking anything closes the drawer: on a phone it is covering the
      // very thing that was just asked for.
      setOpen(false);
      if (item.tagName === 'A') return;          // a link to another page: let it go
      markActive(item);
      if (opts.onView) opts.onView(item.dataset.view, item.dataset.firm || null);
    });

    function markActive(item) {
      Array.prototype.forEach.call(host.querySelectorAll('.refnav-item'), function (n) {
        n.classList.remove('active');
      });
      if (item) item.classList.add('active');
    }

    function select(view, firm) {
      var sel = '.refnav-item[data-view="' + view + '"]' + (firm ? '[data-firm="' + firm + '"]' : '');
      markActive(host.querySelector(sel));
    }

    return { setOpen: setOpen, isOpen: isOpen, select: select, fromHash: fromHash };
  }

  window.REFNav = { MENU: MENU, mount: mount, fromHash: fromHash };
})();
