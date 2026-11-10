/* Partners Unlimited — redesign preview: mobile nav + live directory stats. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://vcugotjdsurpbntuxgcf.supabase.co'; // TEST project (staging)
  var SUPABASE_KEY = 'sb_publishable_uG8N8yNJLHLz3PhzbGNJQg_HT_It5r8'; // publishable key, safe in the browser
  var TIMEOUT_MS = 12000;
  var FALLBACK = { members: 87, countries: 61, continents: 8 };
  var DIR_BASE = '../directory.html';

  /* ----- Mobile nav ----- */
  var toggle = document.querySelector('.nav-toggle');
  var mobileNav = document.getElementById('mobile-nav');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = !mobileNav.classList.contains('is-open');
      mobileNav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        mobileNav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('is-open')) {
        mobileNav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
        toggle.focus();
      }
    });
  }

  /* ----- Live stats ----- */
  function uniq(values) {
    var seen = Object.create(null);
    var out = [];
    values.forEach(function (v) {
      var key = (v || '').trim();
      if (!key) return;
      var id = key.toLowerCase();
      if (seen[id]) return;
      seen[id] = true;
      out.push(key);
    });
    return out;
  }

  function setStats(data) {
    document.querySelectorAll('[data-stat]').forEach(function (el) {
      var key = el.getAttribute('data-stat');
      if (data[key] == null) return;
      el.textContent = String(data[key]);
    });
  }

  function coverageUrl(name) {
    return DIR_BASE + '?continent=' + encodeURIComponent(name);
  }

  function renderCoverage(rows) {
    var grid = document.getElementById('coverage-grid');
    var fallback = document.getElementById('coverage-fallback');
    if (!grid) return;
    var counts = Object.create(null);
    rows.forEach(function (row) {
      var name = (row && row.continent || '').trim();
      if (!name) return;
      counts[name] = (counts[name] || 0) + 1;
    });
    var names = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    });
    if (!names.length) {
      grid.hidden = true;
      if (fallback) fallback.hidden = false;
      return;
    }
    grid.innerHTML = '';
    names.forEach(function (name) {
      var n = counts[name];
      var a = document.createElement('a');
      a.className = 'coverage-card';
      a.href = coverageUrl(name);
      var label = n === 1 ? '1 member' : n + ' members';
      a.innerHTML = '<span class="name"></span><span class="count"></span><span class="visually-hidden"> — view in the directory</span>';
      a.querySelector('.name').textContent = name;
      a.querySelector('.count').textContent = label;
      grid.appendChild(a);
    });
    grid.hidden = false;
    if (fallback) fallback.hidden = true;
  }

  function showCoverageFallback() {
    var grid = document.getElementById('coverage-grid');
    var fallback = document.getElementById('coverage-fallback');
    if (grid) grid.hidden = true;
    if (fallback) fallback.hidden = false;
  }

  setStats(FALLBACK);

  var url = SUPABASE_URL + '/rest/v1/members?select=id,continent,country';
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
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) throw new Error('empty');
      setStats({
        members: rows.length,
        countries: uniq(rows.map(function (r) { return r.country; })).length,
        continents: uniq(rows.map(function (r) { return r.continent; })).length
      });
      renderCoverage(rows);
    })
    .catch(function (err) {
      clearTimeout(timer);
      if (window.console) console.warn('Redesign stats failed to load:', err);
      setStats(FALLBACK);
      showCoverageFallback();
    });
})();
