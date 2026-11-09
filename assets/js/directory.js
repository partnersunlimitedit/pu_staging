/* Partners Unlimited — Member Directory
   Reads public member listings from Supabase (read-only, public key).
   Filters by location only: continent -> country -> city/port. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://vcugotjdsurpbntuxgcf.supabase.co'; // TEST project (staging)
  var SUPABASE_KEY = 'sb_publishable_uG8N8yNJLHLz3PhzbGNJQg_HT_It5r8'; // publishable key, safe in the browser
  var COLUMNS = 'id,continent,region,country,city,ports,company_name,contact_person,website,description';
  var CONTACT_URL = 'contact-us.html';
  var TIMEOUT_MS = 15000;

  var els = {
    continent: document.getElementById('f-continent'),
    country: document.getElementById('f-country'),
    place: document.getElementById('f-place'),
    reset: document.getElementById('f-reset'),
    count: document.getElementById('dir-count'),
    notice: document.getElementById('dir-notice'),
    loading: document.getElementById('dir-loading'),
    empty: document.getElementById('dir-empty'),
    emptyReset: document.getElementById('dir-empty-reset'),
    error: document.getElementById('dir-error'),
    retry: document.getElementById('dir-retry'),
    grid: document.getElementById('dir-grid')
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
  function placesOf(m) {
    return [m.city].concat(Array.isArray(m.ports) ? m.ports : []).filter(Boolean);
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

  function show(which) {
    els.loading.hidden = which !== 'loading';
    els.error.hidden = which !== 'error';
    els.empty.hidden = which !== 'empty';
    els.grid.hidden = which !== 'grid';
  }

  function setFiltersEnabled(on) {
    [els.continent, els.country, els.place, els.reset].forEach(function (c) { c.disabled = !on; });
  }

  /* ---------- filters ---------- */
  function current() {
    return { continent: els.continent.value, country: els.country.value, place: els.place.value };
  }

  function refreshOptions() {
    var f = current();
    fillSelect(els.continent, 'All continents', uniqSorted(members.map(function (m) { return m.continent; })), f.continent);
    f.continent = els.continent.value;

    var inContinent = members.filter(function (m) { return !f.continent || eqi(m.continent, f.continent); });
    fillSelect(els.country, 'All countries', uniqSorted(inContinent.map(function (m) { return m.country; })), f.country);
    f.country = els.country.value;

    var inCountry = inContinent.filter(function (m) { return !f.country || eqi(m.country, f.country); });
    var places = [];
    inCountry.forEach(function (m) { places = places.concat(placesOf(m)); });
    fillSelect(els.place, 'All cities & ports', uniqSorted(places), f.place);
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
    return members.filter(function (m) {
      if (f.continent && !eqi(m.continent, f.continent)) return false;
      if (f.country && !eqi(m.country, f.country)) return false;
      if (f.place && !placesOf(m).some(function (p) { return eqi(p, f.place); })) return false;
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
    loc.appendChild(document.createTextNode([m.city, m.country].filter(Boolean).join(', ')));
    li.appendChild(loc);
    li.appendChild(el('h3', null, m.company_name));

    var dl = el('dl', 'dir-meta');
    function row(label, value, node) {
      if (!value && !node) return;
      var d = el('div');
      d.appendChild(el('dt', null, label));
      var dd = el('dd', null, node ? null : value);
      if (node) dd.appendChild(node);
      d.appendChild(dd);
      dl.appendChild(d);
    }
    row('Country', m.country);
    row('City', m.city);
    row('Ports', Array.isArray(m.ports) && m.ports.length ? m.ports.join(', ') : '');
    row('Contact', m.contact_person);
    var u = safeUrl(m.website);
    if (u) {
      var a = el('a', null, u.hostname.replace(/^www\./, ''));
      a.href = u.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', 'Website of ' + m.company_name + ' (opens in a new tab)');
      row('Website', null, a);
    }
    li.appendChild(dl);

    if (m.description) li.appendChild(el('p', 'dir-card-desc', m.description));

    var actions = el('div', 'dir-card-actions');
    var c = el('a', 'btn btn-primary', 'Contact this member');
    // Opens the visitor's e-mail app addressed to the PU team (never the member's own e-mail).
    // Falls back to the contact page if the e-mail helper didn't load.
    c.href = window.PUEmail
      ? PUEmail.mailto(PUEmail.memberSubject(m.company_name, m.id))
      : CONTACT_URL + '?member=' + encodeURIComponent(m.id) + '&company=' + encodeURIComponent(m.company_name);
    c.setAttribute('aria-label', 'Email Partners Unlimited about ' + m.company_name);
    actions.appendChild(c);
    li.appendChild(actions);
    return li;
  }

  function render() {
    var list = filtered();
    var anyFilter = !!(els.continent.value || els.country.value || els.place.value);
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
    els.place.value = '';
    onChange();
    els.continent.focus();
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
        // Apply filters from the address bar, e.g. directory.html?country=China
        var p = new URLSearchParams(location.search);
        els.continent.innerHTML = '';
        refreshOptions();
        var bad = false;
        [['continent', els.continent], ['country', els.country], ['place', els.place]].forEach(function (pair) {
          var want = (p.get(pair[0]) || '').trim();
          if (!want) return;
          if (applyOption(pair[1], want)) refreshOptions();
          else bad = true;
        });
        if (bad) {
          var kept = els.place.value || els.country.value || els.continent.value;
          showNotice('That location isn\u2019t in the directory yet; showing all members' + (kept ? ' in ' + kept : '') + '.');
          syncUrl(); // drops the unknown parameter(s) from the address bar
        }
        setFiltersEnabled(true);
        render();
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (window.console) console.warn('Member directory failed to load:', err);
        els.count.textContent = '';
        show('error');
      });
  }

  els.continent.addEventListener('change', function () { els.country.value = ''; els.place.value = ''; onChange(); });
  els.country.addEventListener('change', function () { els.place.value = ''; onChange(); });
  els.place.addEventListener('change', onChange);
  els.reset.addEventListener('click', resetAll);
  els.emptyReset.addEventListener('click', resetAll);
  els.retry.addEventListener('click', load);

  load();
})();
