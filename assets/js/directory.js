/* Partners Unlimited — Member Directory
   Reads public member listings from Supabase (read-only, public key).
   Filters by location (continent -> country) and a text search (company, city, or port).
   If a member or admin is signed in, contact details are loaded via RPC
   directory_member_contacts and merged onto cards by id: contact person,
   labeled emails (main / import / export, else the single email field),
   office address, and the principal and network booklet contacts (name,
   email, phone). Address, booklet contacts, and phone numbers are
   signed-in only and are never requested on the public members SELECT.
   A copy button is shown next to an email or phone already on the card. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://vcugotjdsurpbntuxgcf.supabase.co'; // TEST project (staging)
  var SUPABASE_KEY = 'sb_publishable_uG8N8yNJLHLz3PhzbGNJQg_HT_It5r8'; // publishable key, safe in the browser
  var COLUMNS = 'id,continent,region,country,city,ports,company_name,website,description';
  var TIMEOUT_MS = 15000;

  var els = {
    continent: document.getElementById('f-continent'),
    country: document.getElementById('f-country'),
    search: document.getElementById('f-search'),
    reset: document.getElementById('f-reset'),
    count: document.getElementById('dir-count'),
    notice: document.getElementById('dir-notice'),
    loading: document.getElementById('dir-loading'),
    empty: document.getElementById('dir-empty'),
    emptyReset: document.getElementById('dir-empty-reset'),
    error: document.getElementById('dir-error'),
    retry: document.getElementById('dir-retry'),
    grid: document.getElementById('dir-grid'),
    sessionNote: document.getElementById('dir-session-note')
  };
  if (!els.grid) return;

  var members = [];

  /* ---------- helpers ---------- */
  function uniqSorted(list) {
    var seen = {};
    return list.filter(function (v) {
      if (!v) return false;
      var k = v.toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    }).sort(function (a, b) { return a.localeCompare(b); });
  }
  function eqi(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }

  function fillSelect(select, allLabel, values, keep) {
    select.innerHTML = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      select.appendChild(o);
    });
    var stillThere = values.some(function (v) { return v === keep; });
    select.value = stillThere ? keep : '';
  }

  function safeUrl(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s || /\s/.test(s)) return null;
    if (!/^https?:\/\//i.test(s)) {
      // Only a bare domain (e.g. example.com or www.example.com/path) gets https:// added.
      // Anything else with a scheme or odd format (mailto:, javascript:, //host, ftp://) gets no link.
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#].*)?$/i.test(s)) return null;
      s = 'https://' + s;
    }
    try {
      var u = new URL(s);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null;
      return u;
    } catch (e) { return null; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Only allow a normal email as a mailto: link (has @, no spaces, no javascript:).
  function safeEmail(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s || /\s/.test(s)) return null;
    if (/javascript:/i.test(s)) return null;
    if (s.indexOf('@') === -1) return null;
    if (/^mailto:/i.test(s)) s = s.slice(7);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return null;
    return s;
  }

  // A single telephone number may become a tel: link. Labelled or combined
  // values (letters, slashes, two numbers in one field) stay plain text.
  function safePhone(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s || /javascript:/i.test(s)) return null;
    if (/[a-z\/,;]/i.test(s)) return null;
    if (s.indexOf('+') > 0) return null;
    if ((s.match(/\+/g) || []).length > 1) return null;
    if (!/^\+?[\d\s().-]+$/.test(s)) return null;
    var digits = s.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return s;
  }

  function telHref(safe) {
    var num = String(safe).replace(/[^\d+]/g, '');
    if (!/^\+?\d{7,15}$/.test(num)) return null;
    return 'tel:' + num;
  }

  var EMAIL_LABELS = { main: 'Main', import: 'Import', export: 'Export' };

  function displayEmailLabel(raw) {
    if (raw == null || raw === '') return null;
    return EMAIL_LABELS[String(raw).trim().toLowerCase()] || null;
  }

  // Normalise the optional emails array from the signed-in RPC (jsonb may
  // arrive as an array or a JSON string). Missing or invalid → null.
  function normalizeEmails(raw) {
    if (raw == null) return null;
    var list = raw;
    if (typeof raw === 'string') {
      try { list = JSON.parse(raw); } catch (e) { return null; }
    }
    return Array.isArray(list) ? list : null;
  }

  // Valid labeled addresses from emails[], or null to fall back to email.
  function labeledEmails(raw) {
    var list = normalizeEmails(raw);
    if (!list || !list.length) return null;
    var out = [];
    list.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var label = displayEmailLabel(item.label);
      if (!label) return;
      var email = safeEmail(item.email);
      if (!email) return;
      out.push({ label: label, email: email });
    });
    return out.length ? out : null;
  }

  function copyKindLabel(kind, text) {
    return kind + ' ' + text;
  }

  function copyButton(text, kind) {
    var copyBtn = el('button', 'dir-copy-email', 'Copy');
    copyBtn.type = 'button';
    copyBtn.setAttribute('data-copy', text);
    copyBtn.setAttribute('data-copy-kind', kind);
    copyBtn.setAttribute('aria-label', 'Copy ' + copyKindLabel(kind, text));
    copyBtn.setAttribute('aria-live', 'polite');
    copyBtn.addEventListener('click', onCopyClick);
    return copyBtn;
  }

  function emailControl(email, label) {
    var wrap = el('span', 'dir-email');
    if (label) wrap.appendChild(el('span', 'dir-email-label', label));
    var mail = el('a', null, email);
    mail.href = 'mailto:' + email;
    wrap.appendChild(mail);
    wrap.appendChild(copyButton(email, label ? label + ' email address' : 'email address'));
    return wrap;
  }

  function phoneControl(raw) {
    var text = String(raw).trim();
    var wrap = el('span', 'dir-email');
    var tel = safePhone(text);
    var href = tel ? telHref(tel) : null;
    if (href) {
      var link = el('a', null, text);
      link.href = href;
      wrap.appendChild(link);
    } else {
      wrap.appendChild(el('span', null, text));
    }
    wrap.appendChild(copyButton(text, 'phone number'));
    return wrap;
  }

  // Stacked name / email / phone for the Principal and Network booklet contacts.
  // Omits empty or unsafe values; returns null when nothing remains to show.
  function contactStack(name, email, phone) {
    var stack = el('span', 'dir-contact-block');
    name = (name || '').trim();
    if (name) stack.appendChild(el('span', 'dir-contact-name', name));
    var mail = safeEmail(email);
    if (mail) stack.appendChild(emailControl(mail, null));
    phone = (phone || '').trim();
    if (phone) stack.appendChild(phoneControl(phone));
    return stack.children.length ? stack : null;
  }

  // Copy text to the clipboard. Prefer the Clipboard API; fall back to a
  // hidden textarea + execCommand so this still works on older browsers.
  // Never alert() the address.
  function copyTextFallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.tabIndex = -1;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch (e) {}
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).catch(function () {
        if (copyTextFallback(text)) return;
        throw new Error('copy failed');
      });
    }
    return copyTextFallback(text) ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  var COPY_FEEDBACK_MS = 1800;

  function restoreCopyButton(btn) {
    var text = btn.getAttribute('data-copy') || '';
    var kind = btn.getAttribute('data-copy-kind') || '';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy ' + copyKindLabel(kind, text));
    btn.classList.remove('is-copied', 'is-failed');
  }

  function setCopyFeedback(btn, ok) {
    if (btn._copyTimer) {
      clearTimeout(btn._copyTimer);
      btn._copyTimer = null;
    }
    var text = btn.getAttribute('data-copy') || '';
    var kind = btn.getAttribute('data-copy-kind') || '';
    var label = copyKindLabel(kind, text);
    if (ok) {
      btn.textContent = 'Copied';
      btn.setAttribute('aria-label', 'Copied ' + label);
      btn.classList.add('is-copied');
      btn.classList.remove('is-failed');
    } else {
      btn.textContent = "Couldn't copy";
      btn.setAttribute('aria-label', "Couldn't copy " + label);
      btn.classList.add('is-failed');
      btn.classList.remove('is-copied');
    }
    btn._copyTimer = setTimeout(function () {
      btn._copyTimer = null;
      restoreCopyButton(btn);
    }, COPY_FEEDBACK_MS);
  }

  function onCopyClick(e) {
    var btn = e.currentTarget;
    var text = btn.getAttribute('data-copy');
    if (!text) return;
    copyText(text).then(function () {
      setCopyFeedback(btn, true);
    }).catch(function () {
      setCopyFeedback(btn, false);
    });
  }

  function showSessionNote(msg) {
    if (!els.sessionNote) return;
    els.sessionNote.textContent = msg || '';
    els.sessionNote.hidden = !msg;
  }

  function show(which) {
    els.loading.hidden = which !== 'loading';
    els.error.hidden = which !== 'error';
    els.empty.hidden = which !== 'empty';
    els.grid.hidden = which !== 'grid';
  }

  function setFiltersEnabled(on) {
    [els.continent, els.country, els.search, els.reset].forEach(function (c) {
      if (c) c.disabled = !on;
    });
  }

  /* ---------- filters ---------- */
  function current() {
    return {
      continent: els.continent.value,
      country: els.country.value,
      q: els.search ? els.search.value.trim() : ''
    };
  }

  function searchWords() {
    return current().q.toLowerCase().split(/\s+/).filter(Boolean);
  }

  // Public fields, plus signed-in contact fields only if already merged onto
  // the object (signed-in RPC). Public visitors must not search address,
  // phones, booklet contacts, or hidden emails.
  var SEARCH_CONTACT_FIELDS = [
    'contact_person', 'email', 'address',
    'principal_name', 'principal_email', 'principal_phone',
    'network_name', 'network_email', 'network_phone'
  ];

  function searchableText(m) {
    var parts = [
      m.company_name,
      m.city,
      m.country,
      m.continent,
      Array.isArray(m.ports) ? m.ports.join(' ') : m.ports,
      m.description,
      m.website
    ];
    SEARCH_CONTACT_FIELDS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(m, key)) parts.push(m[key]);
    });
    if (Object.prototype.hasOwnProperty.call(m, 'emails')) {
      var extra = normalizeEmails(m.emails) || [];
      extra.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var label = displayEmailLabel(item.label);
        if (label) parts.push(label);
        if (item.email != null) parts.push(item.email);
      });
    }
    return parts.map(function (v) { return v == null ? '' : String(v); }).join(' ').toLowerCase();
  }

  function matchesSearch(m, words) {
    if (!words.length) return true;
    var hay = searchableText(m);
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function refreshOptions() {
    var f = current();
    fillSelect(els.continent, 'All continents', uniqSorted(members.map(function (m) { return m.continent; })), f.continent);
    f.continent = els.continent.value;

    var inContinent = members.filter(function (m) { return !f.continent || eqi(m.continent, f.continent); });
    fillSelect(els.country, 'All countries', uniqSorted(inContinent.map(function (m) { return m.country; })), f.country);
  }

  // Select the option matching `want` regardless of letter case; returns false if none.
  function applyOption(select, want) {
    for (var i = 0; i < select.options.length; i++) {
      var o = select.options[i];
      if (o.value && eqi(o.value, want)) { select.value = o.value; return true; }
    }
    return false;
  }

  function showNotice(msg) {
    if (!els.notice) return;
    els.notice.textContent = msg || '';
    els.notice.hidden = !msg;
  }

  function filtered() {
    var f = current();
    var words = searchWords();
    return members.filter(function (m) {
      if (f.continent && !eqi(m.continent, f.continent)) return false;
      if (f.country && !eqi(m.country, f.country)) return false;
      if (!matchesSearch(m, words)) return false;
      return true;
    });
  }

  function syncUrl() {
    if (!window.history || !history.replaceState) return;
    var f = current();
    var p = new URLSearchParams();
    Object.keys(f).forEach(function (k) { if (f[k]) p.set(k, f[k]); });
    var q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
  }

  /* ---------- rendering ---------- */
  var pinSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

  function card(m) {
    var li = el('li', 'dir-card');
    var loc = el('p', 'dir-card-loc');
    loc.innerHTML = pinSvg;
    var locParts = [m.city, m.country].map(function (v) { return (v || '').trim(); }).filter(Boolean);
    var locText = locParts.join(', ');
    loc.appendChild(document.createTextNode(locText));
    li.appendChild(loc);
    li.appendChild(el('h3', null, m.company_name));

    var dl = el('dl', 'dir-meta');
    // Skip empty rows and rows that only repeat the location label above the name.
    function repeatsLocation(v) {
      v = String(v || '').trim();
      return !!v && (eqi(v, locText) || locParts.some(function (part) { return eqi(v, part); }));
    }
    function row(label, value, node) {
      if (!node && (!value || !String(value).trim() || repeatsLocation(value))) return;
      var d = el('div');
      d.appendChild(el('dt', null, label));
      var dd = el('dd', null, node ? null : value);
      if (node) dd.appendChild(node);
      d.appendChild(dd);
      dl.appendChild(d);
    }
    row('City', m.city); // shown only if it isn't already in the location label
    row('Ports', Array.isArray(m.ports) && m.ports.length ? m.ports.join(', ') : '');
    var u = safeUrl(m.website);
    if (u) {
      var a = el('a', null, u.hostname.replace(/^www\./, ''));
      a.href = u.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', 'Website of ' + m.company_name + ' (opens in a new tab)');
      row('Website', null, a);
    }
    // Signed-in extras only (merged after directory_member_contacts succeeds).
    var person = (m.contact_person || '').trim();
    if (person) row('Contact', person);
    var labeled = labeledEmails(m.emails);
    if (labeled) {
      var stack = el('span', 'dir-email-list');
      labeled.forEach(function (item) {
        stack.appendChild(emailControl(item.email, item.label));
      });
      row('Email', null, stack);
    } else {
      var email = safeEmail(m.email);
      if (email) row('Email', null, emailControl(email, null));
    }
    var address = Object.prototype.hasOwnProperty.call(m, 'address')
      ? String(m.address || '').trim()
      : '';
    if (address) {
      var addrNode = el('span', 'dir-address', address);
      if (/\r|\n/.test(address)) addrNode.classList.add('dir-address-multiline');
      row('Address', null, addrNode);
    }
    var principal = contactStack(m.principal_name, m.principal_email, m.principal_phone);
    if (principal) row('Principal', null, principal);
    var networkName = (m.network_name || '').trim();
    var networkEmail = (m.network_email || '').trim();
    var networkPhone = (m.network_phone || '').trim();
    if (networkName || networkEmail || networkPhone) {
      var network = contactStack(m.network_name, m.network_email, m.network_phone);
      if (network) row('Network', null, network);
    }
    if (dl.children.length) li.appendChild(dl);
    else li.classList.add('is-compact');

    var desc = (m.description || '').trim();
    if (desc) li.appendChild(el('p', 'dir-card-desc', desc));

    return li;
  }

  function render() {
    var list = filtered();
    var anyFilter = !!(els.continent.value || els.country.value || (els.search && els.search.value.trim()));
    els.reset.disabled = !anyFilter;
    els.grid.innerHTML = '';
    if (!list.length) {
      els.count.textContent = members.length ? 'No members match these filters.' : 'No members are listed yet.';
      show('empty');
      return;
    }
    var frag = document.createDocumentFragment();
    list.forEach(function (m) { frag.appendChild(card(m)); });
    els.grid.appendChild(frag);
    els.count.textContent = anyFilter
      ? 'Showing ' + list.length + ' of ' + members.length + ' member' + (members.length === 1 ? '' : 's')
      : 'Showing all ' + list.length + ' member' + (list.length === 1 ? '' : 's');
    show('grid');
  }

  function onChange() {
    showNotice('');
    refreshOptions();
    syncUrl();
    render();
  }

  function resetAll() {
    els.continent.value = '';
    els.country.value = '';
    if (els.search) els.search.value = '';
    onChange();
    if (els.search) els.search.focus();
    else els.continent.focus();
  }

  /* ---------- data ---------- */
  function load() {
    show('loading');
    setFiltersEnabled(false);
    els.count.textContent = 'Loading members\u2026';

    var url = SUPABASE_URL + '/rest/v1/members?select=' + COLUMNS +
      '&order=continent.asc,country.asc,company_name.asc';
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);

    fetch(url, {
      headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (rows) {
        clearTimeout(timer);
        members = Array.isArray(rows) ? rows : [];
        // Apply filters from the address bar, e.g. directory.html?country=China&q=port
        var p = new URLSearchParams(location.search);
        els.continent.innerHTML = '';
        refreshOptions();
        if (els.search) els.search.value = p.get('q') || '';
        var bad = false;
        [['continent', els.continent], ['country', els.country]].forEach(function (pair) {
          var want = (p.get(pair[0]) || '').trim();
          if (!want) return;
          if (applyOption(pair[1], want)) refreshOptions();
          else bad = true;
        });
        if (bad) {
          var kept = els.country.value || els.continent.value;
          showNotice('That location isn\u2019t in the directory yet; showing all members' + (kept ? ' in ' + kept : '') + '.');
          syncUrl(); // drops the unknown location parameter(s); keeps q
        } else if (Array.from(p.keys()).some(function (k) { return k !== 'continent' && k !== 'country' && k !== 'q'; })) {
          syncUrl(); // silently drop old/unsupported parameters such as ?place=
        }
        setFiltersEnabled(true);
        render();
        loadSignedInContacts();
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (window.console) console.warn('Member directory failed to load:', err);
        els.count.textContent = '';
        show('error');
      });
  }

  /* ---------- signed-in contact details (optional enhancement) ---------- */
  function accessTokenFromSession(session) {
    return session && session.access_token ? session.access_token : null;
  }

  function getAccessToken() {
    if (!window.PUAuth) return Promise.resolve(null);
    try {
      var client = PUAuth.createClient();
      return PUAuth.getSession(client).then(accessTokenFromSession).catch(function () {
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  var CONTACT_FIELDS = [
    'contact_person', 'email', 'emails', 'address',
    'principal_name', 'principal_email', 'principal_phone',
    'network_name', 'network_email', 'network_phone'
  ];

  function mergeContacts(rows) {
    var byId = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || row.id == null) return;
      var extra = {};
      // Only these contact fields — never copy status, notes, or unknown data.
      // If the RPC omits a newer field (older shape), that key is left unset.
      CONTACT_FIELDS.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(row, key)) extra[key] = row[key];
      });
      byId[String(row.id)] = extra;
    });
    members.forEach(function (m) {
      var extra = byId[String(m.id)];
      if (!extra) return;
      CONTACT_FIELDS.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) m[key] = extra[key];
      });
    });
  }

  function loadSignedInContacts() {
    showSessionNote('');
    getAccessToken().then(function (token) {
      if (!token) return;
      var ctrl = 'AbortController' in window ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
      return fetch(SUPABASE_URL + '/rest/v1/rpc/directory_member_contacts', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: '{}',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) return null; // not deployed yet, 401/403, etc. — keep public view
        return res.json();
      }).then(function (rows) {
        if (!Array.isArray(rows)) return;
        mergeContacts(rows);
        render();
        showSessionNote("You're signed in, so member contact details are visible.");
      }).catch(function () {
        clearTimeout(timer);
        // Silently keep the public directory view.
      });
    });
  }

  els.continent.addEventListener('change', function () { els.country.value = ''; onChange(); });
  els.country.addEventListener('change', onChange);
  if (els.search) els.search.addEventListener('input', onChange);
  els.reset.addEventListener('click', resetAll);
  els.emptyReset.addEventListener('click', resetAll);
  els.retry.addEventListener('click', load);

  load();
})();
