/* Partners Unlimited — Meetings page AGM data
   Loads published rows from public.agm_meetings (TEST, publishable key only).
   Anon can read published rows only. If the fetch fails or returns no rows,
   the static markup already in meetings.html is left unchanged. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://vcugotjdsurpbntuxgcf.supabase.co'; // TEST project (staging)
  var SUPABASE_KEY = 'sb_publishable_uG8N8yNJLHLz3PhzbGNJQg_HT_It5r8'; // publishable key, safe in the browser
  var COLUMNS = 'id,year,title,location,start_date,end_date,status,short_description,published,sort_order';
  var TIMEOUT_MS = 15000;
  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  var nextRoot = document.querySelector('[data-agm-next]');
  var listRoot = document.querySelector('[data-agm-list]') || document.querySelector('.agm-list');
  if (!nextRoot && !listRoot) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function parseDate(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3] };
  }

  function formatOne(p) {
    return p.d + ' ' + MONTHS[p.mo - 1] + ', ' + p.y;
  }

  /* Match the static 2024 card: "4 – 8 March, 2024" */
  function formatDates(start, end) {
    var a = parseDate(start);
    var b = parseDate(end);
    if (!a && !b) return '';
    if (a && !b) return formatOne(a);
    if (!a && b) return formatOne(b);
    if (a.y === b.y && a.mo === b.mo && a.d === b.d) return formatOne(a);
    if (a.y === b.y && a.mo === b.mo) {
      return a.d + ' \u2013 ' + b.d + ' ' + MONTHS[a.mo - 1] + ', ' + a.y;
    }
    if (a.y === b.y) {
      return a.d + ' ' + MONTHS[a.mo - 1] + ' \u2013 ' + b.d + ' ' + MONTHS[b.mo - 1] + ', ' + a.y;
    }
    return formatOne(a) + ' \u2013 ' + formatOne(b);
  }

  function rowTitle(row) {
    var title = String((row && row.title) || '').trim();
    if (title) return title;
    return row && row.year ? ('AGM ' + row.year) : 'AGM';
  }

  function nextValue(row) {
    var parts = [rowTitle(row)];
    var location = String((row && row.location) || '').trim();
    var dates = formatDates(row && row.start_date, row && row.end_date);
    if (location) parts.push(location);
    if (dates) parts.push(dates);
    return parts.join(', ');
  }

  function badgeLabel(status) {
    if (status === 'next') return 'Next meeting';
    if (status === 'past') return 'Past meeting';
    return '';
  }

  function renderNext(row) {
    if (!nextRoot) return;
    var valueEl = nextRoot.querySelector('.agm-next-value');
    if (!valueEl) {
      valueEl = el('p', 'agm-next-value');
      nextRoot.appendChild(valueEl);
    }
    valueEl.textContent = row ? nextValue(row) : 'To be announced';
  }

  function renderEntry(row) {
    var status = String((row && row.status) || 'tba').toLowerCase();
    if (status !== 'next' && status !== 'past' && status !== 'tba') status = 'tba';
    var location = String((row && row.location) || '').trim();
    var dates = formatDates(row && row.start_date, row && row.end_date);
    var description = String((row && row.short_description) || '').trim();

    var article = el('article', 'agm-entry');
    article.setAttribute('data-agm-year', row && row.year != null ? String(row.year) : '');
    article.setAttribute('data-agm-status', status);
    article.setAttribute('data-agm-location', location);
    article.setAttribute('data-agm-dates', dates);

    var head = el('div', 'agm-entry-head');
    head.appendChild(el('h3', '', rowTitle(row)));
    var badge = badgeLabel(status);
    if (badge) head.appendChild(el('span', 'agm-badge', badge));
    article.appendChild(head);

    if (location || dates || description) {
      if (location || dates) {
        var ul = el('ul', 'bullets');
        if (location) {
          var liLoc = document.createElement('li');
          liLoc.textContent = 'Venue: ' + location;
          ul.appendChild(liLoc);
        }
        if (dates) {
          var liDate = document.createElement('li');
          liDate.textContent = 'Date: ' + dates;
          ul.appendChild(liDate);
        }
        article.appendChild(ul);
      }
      if (description) article.appendChild(el('p', '', description));
    } else {
      article.appendChild(el('p', 'agm-tba', 'Details to be announced'));
    }
    return article;
  }

  function render(rows) {
    var nextRow = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].status || '').toLowerCase() === 'next') {
        nextRow = rows[i];
        break;
      }
    }
    renderNext(nextRow);
    if (!listRoot) return;
    listRoot.textContent = '';
    rows.forEach(function (row) {
      listRoot.appendChild(renderEntry(row));
    });
  }

  function load() {
    var url = SUPABASE_URL + '/rest/v1/agm_meetings?select=' + COLUMNS +
      '&published=eq.true&order=sort_order.asc,year.desc';
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
        if (!Array.isArray(rows) || !rows.length) return;
        render(rows);
      })
      .catch(function () {
        clearTimeout(timer);
        /* Leave the existing static content exactly as it is. */
      });
  }

  load();
})();
