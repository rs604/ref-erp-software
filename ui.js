/* ============================================================
   THE ERP'S SHARED CONTROLS — one file, every screen.

   Two things live here, both of them because they were about to be built
   a fifth time:

   1. THE CONTROL BAR. Every report opens with the same shape -- something
      to search for, a couple of narrow fields, and a way to take the
      result away. On a phone the ledger's version of it was six stacked
      rows: party, from, to, four range buttons two-by-two, and two
      download buttons with the words spelled out. The whole screen was
      controls, and the ledger itself began below the fold.

        Row 1   what you are looking at, full width    [PDF] [Excel]
        Row 2   From      To      Range

   2. THE PICKER. The party search was a native <datalist>. A datalist
      cannot be styled AT ALL -- the list that drops down belongs to the
      browser, not to the page -- which is why it rendered half see-through
      over the form on his phone, why it did it only sometimes, and why it
      had no hover, no selected row, no highlighted letters, no ellipsis
      and no arrow keys. There was nothing to fix. There was only something
      to replace.

   A screen uses them like this:

     <div class="card ctl">
       <div class="ctl-row">
         <div class="ctl-grow">... label + input ...</div>
         <div class="ctl-acts">... icon buttons ...</div>
       </div>
       <div class="ctl-row">... narrow fields ...</div>
     </div>

     REFUI.pick({ input: el, source: fn, onPick: fn });

   Both are here rather than in one page's <style> so that the next report
   inherits them instead of copying them. That is the fault this file is
   the answer to, stated once.
   ============================================================ */
(function () {
  'use strict';

  var ICONS = {
    pdf:    'M7 3h7l4 4v14H7zM14 3v4h4M9 13h6M9 17h6',
    excel:  'M7 3h7l4 4v14H7zM14 3v4h4M9.5 12l5 6M14.5 12l-5 6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
    down:   'M12 4v12M7 12l5 5 5-5M5 20h14',
  };

  /* The look lives in ui.css, linked beside theme.css BEFORE each page's
     own <style>. A stylesheet appended here at load time would come after
     every page's rules and quietly outrank them. */
  function style() {}

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' +
           (ICONS[name] || ICONS.search) + '"/></svg>';
  }

  /* THE TYPED LETTERS, LIT UP. Word by word, against the raw text, escaping
     each piece afterwards -- escaping first would let a search for "amp"
     light up the middle of an &amp; and hand the browser broken markup.

     A word the search matched FUZZILY is not in the label at all
     ("mottor" against HERO MOTORS), so nothing lights up for it. That is
     honest: the highlight says where the letters are, and there it has
     nothing to say. */
  function light(raw, q) {
    raw = String(raw === null || raw === undefined ? '' : raw);
    var words = String(q || '').trim().split(/\s+/).filter(function (w) { return w.length > 1; });
    if (!words.length) return esc(raw);
    words.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(' + words.map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')', 'gi');
    var out = '', last = 0, m;
    while ((m = re.exec(raw)) !== null) {
      out += esc(raw.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    return out + esc(raw.slice(last));
  }

  var seq = 0;

  /* ONE document listener for every picker there will ever be. A panel that
     redraws itself builds a new picker each time, and a listener added per
     picker would pile up a hundred deep behind an afternoon's clicking. */
  var LIVE = [];
  document.addEventListener('mousedown', function (e) {
    for (var i = LIVE.length - 1; i >= 0; i--) {
      if (!LIVE[i].wrap.isConnected) { LIVE.splice(i, 1); continue; }
      if (!LIVE[i].wrap.contains(e.target)) LIVE[i].shut();
    }
  });

  /* opts:
       input   the <input> that is already on the screen
       source  function (query) -> array, or a promise of one, of
               { value, label, note }  (label and note optional)
       onPick  function (value, row)
       min     letters before it asks (default 0 -- focus opens it)
       empty   what to say when there is nothing (default 'Nothing found.')
       max     how many rows to show (default 50)                           */
  function pick(opts) {
    style();
    var input = opts.input;
    if (!input || input.__refpick) return input && input.__refpick;

    // A datalist cannot be styled, so if one is still attached, detach it.
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var id = 'refpick-' + (seq++);
    var wrap = document.createElement('div');
    wrap.className = 'refpick';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var list = document.createElement('div');
    list.className = 'refpick-list';
    list.id = id;
    list.setAttribute('role', 'listbox');
    wrap.appendChild(list);
    input.setAttribute('aria-controls', id);

    var rows = [], at = -1, open = false, token = 0;

    function draw(q) {
      if (!rows.length) {
        list.innerHTML = '<div class="refpick-empty">' +
          esc(opts.empty || 'Nothing found.') + '</div>';
        return;
      }
      list.innerHTML = rows.map(function (r, i) {
        return '<button type="button" class="refpick-opt' + (i === at ? ' on' : '') +
          '" role="option" aria-selected="' + (i === at ? 'true' : 'false') +
          '" id="' + id + '-' + i + '" data-i="' + i + '">' +
          '<span class="t">' + light(r.label || r.value, q) + '</span>' +
          (r.note ? '<span class="n">' + esc(r.note) + '</span>' : '') + '</button>';
      }).join('');
    }

    function show(on) {
      open = !!on;
      list.classList.toggle('open', open);
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) {
        at = -1;
        input.removeAttribute('aria-activedescendant');
      }
    }

    function mark() {
      Array.prototype.forEach.call(list.children, function (el, i) {
        if (!el.classList) return;
        el.classList.toggle('on', i === at);
        if (el.setAttribute) el.setAttribute('aria-selected', i === at ? 'true' : 'false');
      });
      if (at >= 0 && list.children[at]) {
        input.setAttribute('aria-activedescendant', id + '-' + at);
        list.children[at].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function ask() {
      var q = String(input.value || '').trim();
      if (q.length < (opts.min || 0)) { show(false); return; }
      var mine = ++token;
      Promise.resolve(opts.source(q)).then(function (got) {
        if (mine !== token) return;                 // a later keystroke won
        rows = (got || []).slice(0, opts.max || 50);
        at = -1;
        draw(q);
        show(true);
      });
    }

    function choose(i) {
      var r = rows[i];
      if (!r) return;
      input.value = r.value;
      show(false);
      if (opts.onPick) opts.onPick(r.value, r);
    }

    input.addEventListener('input', ask);
    input.addEventListener('focus', ask);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!open) { ask(); e.preventDefault(); return; }
        if (!rows.length) return;
        e.preventDefault();
        at = e.key === 'ArrowDown'
          ? (at + 1) % rows.length
          : (at <= 0 ? rows.length - 1 : at - 1);
        mark();
        return;
      }
      if (e.key === 'Enter') {
        if (open && at >= 0) { e.preventDefault(); choose(at); }
        else { show(false); }
        return;
      }
      if (e.key === 'Escape') {
        if (open) { e.stopPropagation(); show(false); }
        return;
      }
      if (e.key === 'Tab') show(false);
    });

    /* TWO EVENTS, ONE JOB. mousedown only holds the focus still -- without
       preventDefault the input blurs and the list shuts out from under the
       finger before the click lands. The CHOOSING is on click, because a
       click is what a tap, a keyboard and anything driving the page all
       produce, and mousedown alone answered none of the last two. */
    list.addEventListener('mousedown', function (e) {
      if (e.target.closest('[data-i]')) e.preventDefault();
    });
    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]');
      if (!b) return;
      choose(Number(b.dataset.i));
    });

    LIVE.push({ wrap: wrap,
                isOpen: function () { return open; },
                shut: function () { if (open) show(false); } });

    var api = {
      close: function () { show(false); },
      refresh: ask,
      isOpen: function () { return open; },
      rows: function () { return rows.slice(); },
    };
    input.__refpick = api;
    return api;
  }

  /* A search over a list already in the page's hands: every typed word has
     to appear somewhere in the row, in any order. The server does the
     fuzzy matching where the list is too long to hold. */
  /* IS ONE OF MINE OPEN, AND IF SO, SHUT IT.

     busy.html catches keys in the CAPTURE phase and stops Escape dead
     before it reaches anything -- so the list could not be closed with it,
     and in fact Escape had been doing nothing in that box all along. A
     page that owns the keyboard has to be able to ask. */
  function closeOpen() {
    var shut = false;
    for (var i = LIVE.length - 1; i >= 0; i--) {
      if (!LIVE[i].wrap.isConnected) { LIVE.splice(i, 1); continue; }
      if (LIVE[i].isOpen()) { LIVE[i].shut(); shut = true; }
    }
    return shut;
  }

  function contains(list, q, field) {
    var words = String(q || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list.slice();
    return list.filter(function (r) {
      var hay = String((field ? r[field] : r) || '').toUpperCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  style();
  window.REFUI = { pick: pick, icon: icon, light: light, contains: contains,
                   closeOpen: closeOpen, style: style };
})();
