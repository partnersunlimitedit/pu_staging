/* Partners Unlimited — Admin portal
   All private reads/writes go through SECURITY DEFINER RPCs (PUAuth.CONFIG.rpc).
   Branch on error.code (not HTTP status). Never log member personal data. */
(function () {
  'use strict';

  var page = document.body && document.body.getAttribute('data-admin-page');
  if (!page || page === 'signin') return;
  if (!window.PUAuth || typeof supabase === 'undefined') return;

  var client = PUAuth.createClient();
  var RPC = PUAuth.CONFIG.rpc;
  var SIGN_IN = PUAuth.urlFor('signIn');
  var MEMBER_HOME = PUAuth.urlFor('memberHome');

  function $(id) { return document.getElementById(id); }

  function showAlert(el, message, kind) {
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.className = 'admin-alert' + (kind ? ' is-' + kind : '');
  }

  function showDetailAlert(message, kind) {
    var el = $('admin-detail-alert');
    showAlert(el, message, kind);
    if (message && el && !el.hidden) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function flashSavedButton() {
    var btn = $('admin-save-btn');
    if (!btn) return;
    setBusy(btn, false, 'Saved');
    btn.classList.add('is-saved');
    window.setTimeout(function () {
      if (!btn || btn.textContent !== 'Saved') return;
      btn.classList.remove('is-saved');
      setBusy(btn, false, 'Save');
    }, 2500);
  }

  function friendlyError(err, fallback) {
    return PUAuth.friendlyAuthError(err, fallback || 'Something went wrong. Please try again.');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return '—'; }
  }

  function toDateInput(iso) {
    if (!iso) return '';
    var s = String(iso);
    return s.length >= 10 ? s.slice(0, 10) : '';
  }

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* Hong Kong calendar date (YYYY-MM-DD). Do not use UTC or the browser's local zone. */
  function hkToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  function daysUntilRenewal(renewalDate) {
    if (!renewalDate) return null;
    var day = String(renewalDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    var today = hkToday();
    var a = Date.parse(day + 'T00:00:00Z');
    var b = Date.parse(today + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((a - b) / 86400000);
  }

  function formatDaysLeft(days) {
    if (days == null) return 'No expiry set';
    if (days === 0) return 'Expires today';
    if (days === 1) return '1 day left';
    if (days > 0) return days + ' days left';
    var ago = -days;
    if (ago === 1) return 'Expired (1 day ago)';
    return 'Expired (' + ago + ' days ago)';
  }

  function daysLeftClass(days) {
    if (days == null) return '';
    if (days < 0) return 'is-expired';
    if (days === 0) return 'is-today';
    return '';
  }

  function fmtDateOnly(iso) {
    if (!iso) return '—';
    var s = String(iso).slice(0, 10);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return fmtDate(iso);
    return String(Number(m[3])) + ' ' + MONTHS_SHORT[Number(m[2]) - 1] + ' ' + m[1];
  }

  function termLabel(years) {
    if (years == null || years === '') return '';
    var n = Number(years);
    if (!n) return '';
    return n === 1 ? '1 year' : (n + ' years');
  }

  function portsToText(ports) {
    if (Array.isArray(ports)) return ports.filter(Boolean).join(', ');
    if (typeof ports === 'string') return ports;
    return '';
  }

  function textToPorts(text) {
    return String(text || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  }


  var BOOKLET_FIELDS = [
    'address',
    'principal_name', 'principal_email', 'principal_phone',
    'network_name', 'network_email', 'network_phone'
  ];

  var FIELD_LABELS = {
    company_name: 'Company name',
    contact_person: 'Contact person',
    website: 'Website',
    continent: 'Continent',
    region: 'Region',
    country: 'Country',
    city: 'City',
    ports: 'Ports',
    description: 'Description',
    email: 'Email',
    emails: 'Emails',
    address: 'Office address',
    principal_name: 'Principal name',
    principal_email: 'Principal email',
    principal_phone: 'Principal phone',
    network_name: 'Network name',
    network_email: 'Network email',
    network_phone: 'Network phone'
  };

  function fieldLabel(k) {
    return FIELD_LABELS[k] || String(k || '').replace(/_/g, ' ');
  }

  function bookletInputId(key, prefix) {
    return prefix + key.replace(/_/g, '-');
  }

  function normalizeBookletValue(key, value) {
    var s = String(value == null ? '' : value).trim();
    if (key === 'principal_email' || key === 'network_email') s = s.toLowerCase();
    return s;
  }

  function currentBookletValue(member, key) {
    if (!member) return '';
    return normalizeBookletValue(key, member[key]);
  }

  function validateBookletFields(values) {
    var emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    var phoneRe = /^[+0-9() /.,A-Za-z-]+$/;
    var limits = {
      address: 500,
      principal_name: 200,
      network_name: 200,
      principal_phone: 100,
      network_phone: 100,
      principal_email: 254,
      network_email: 254
    };
    for (var i = 0; i < BOOKLET_FIELDS.length; i++) {
      var key = BOOKLET_FIELDS[i];
      var s = normalizeBookletValue(key, values[key]);
      if (!s) continue;
      if (s.length > (limits[key] || 300)) {
        return { ok: false, error: fieldLabel(key) + ' is too long.' };
      }
      if ((key === 'principal_email' || key === 'network_email') && !emailRe.test(s)) {
        return { ok: false, error: fieldLabel(key) + ' is not a valid email address.' };
      }
      if ((key === 'principal_phone' || key === 'network_phone') && !phoneRe.test(s)) {
        return { ok: false, error: fieldLabel(key) + ' can only use +, digits, spaces, dashes, parentheses, slashes, periods, and letters.' };
      }
    }
    return { ok: true, error: null };
  }

  function readBookletForm() {
    var out = {};
    BOOKLET_FIELDS.forEach(function (key) {
      var el = $(bookletInputId(key, 'm-'));
      out[key] = el ? normalizeBookletValue(key, el.value) : '';
    });
    return out;
  }

  /* admin_update_member uses COALESCE: NULL/omitted leaves a field unchanged.
     Empty string writes '' rather than NULL, so this form does not send blanks
     to clear. Clearing is via the owner edit-request path. */
  function bookletUpdateArgs(formValues, previous) {
    var args = {};
    var skippedClears = [];
    BOOKLET_FIELDS.forEach(function (key) {
      var next = normalizeBookletValue(key, formValues[key]);
      var prev = currentBookletValue(previous, key);
      if (next === prev) return;
      if (next === '') {
        skippedClears.push(key);
        return;
      }
      args['p_' + key] = next;
    });
    return { args: args, skippedClears: skippedClears };
  }


  function statusBadge(status) {
    var s = status || 'pending';
    var span = document.createElement('span');
    span.className = 'admin-badge is-' + s;
    span.textContent = s;
    return span;
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (label) btn.textContent = label;
  }

  function upsertCache(row) {
    if (!row || row.id == null) return;
    var idx = membersCache.findIndex(function (r) { return String(r.id) === String(row.id); });
    if (idx >= 0) membersCache[idx] = row;
    else membersCache.push(row);
  }

  /* ---------- auth ---------- */
  async function requireAdmin() {
    var session = await PUAuth.getSession(client);
    if (!session) {
      location.replace(SIGN_IN);
      return null;
    }
    var ok = await PUAuth.checkIsAdmin(client);
    if (!ok) {
      location.replace(MEMBER_HOME);
      return null;
    }
    var isSuper = await PUAuth.checkIsSuperAdmin(client);
    await PUAuth.applyAdminChrome(client, { isSuperAdmin: isSuper });
    return { session: session, isAdmin: true, isSuperAdmin: isSuper };
  }

  function signOut() { return PUAuth.signOut(client); }

  /* ---------- member RPCs (single place for admin data access) ---------- */
  function listRpcOpts() {
    var opts = {};
    if (listFilters.expiry === 'missing') opts.p_missing_renewal_only = true;
    else if (listFilters.expiry === 'expired') opts.p_expired_only = true;
    if (listFilters.expireBefore && listFilters.expiry !== 'missing') {
      opts.p_renewal_on_or_before = listFilters.expireBefore;
    }
    if (listFilters.order && listFilters.order !== 'id') opts.p_order = listFilters.order;
    return opts;
  }

  async function fetchMembersForAdmin() {
    return PUAuth.adminListMembers(client, listRpcOpts());
  }

  function syncExpiryFilterUi() {
    var before = $('f-expire-before');
    if (!before) return;
    var missing = listFilters.expiry === 'missing';
    before.disabled = missing;
    before.title = missing
      ? 'Date range does not apply when listing members with no expiry.'
      : '';
  }

  function resetListFilters() {
    listFilters.search = '';
    listFilters.status = '';
    listFilters.expiry = 'all';
    listFilters.expireBefore = '';
    listFilters.order = 'id';
    if ($('f-search')) $('f-search').value = '';
    if ($('f-status')) $('f-status').value = '';
    if ($('f-expiry')) $('f-expiry').value = 'all';
    if ($('f-expire-before')) $('f-expire-before').value = '';
    if ($('f-sort')) $('f-sort').value = 'id';
    syncExpiryFilterUi();
  }

  async function fetchMemberById(id) {
    return client.rpc(RPC.adminGetMember, { p_member_id: Number(id) });
  }

  function buildMemberArgs(form, opts) {
    opts = opts || {};
    var ports = textToPorts(form.portsText);
    var args = {
      p_continent: form.continent,
      p_country: form.country,
      p_company_name: form.company_name,
      p_region: form.region == null ? '' : form.region,
      p_city: form.city == null ? '' : form.city,
      p_ports: ports,
      p_contact_person: form.contact_person == null ? '' : form.contact_person,
      p_website: form.website == null ? '' : form.website,
      p_description: form.description == null ? '' : form.description,
      p_email: form.email == null ? '' : form.email,
      p_status: form.status || 'pending',
      p_membership_tier: form.membership_tier == null ? '' : form.membership_tier,
      p_notes: form.notes == null ? '' : form.notes
    };
    return args;
  }

  /* Insert: omit date/term when blank (server leaves both null; term-only computes today+N).
     Update: omit blanks (NULL = leave unchanged). Setting a date alone must not send term. */
  function applyExpiryArgs(args, form, mode) {
    var date = form.renewal_date || '';
    var term = form.membership_term_years || '';
    var skippedBlankDate = false;
    if (mode === 'insert') {
      if (date) args.p_renewal_date = date;
      if (term) args.p_membership_term_years = Number(term);
      return { skippedBlankDate: false };
    }
    var prevDate = toDateInput(currentMember && currentMember.renewal_date);
    var prevTerm = (currentMember && currentMember.membership_term_years != null)
      ? String(currentMember.membership_term_years)
      : '';
    if (date && date !== prevDate) args.p_renewal_date = date;
    else if (!date && prevDate) skippedBlankDate = true;
    if (term && term !== prevTerm) args.p_membership_term_years = Number(term);
    return { skippedBlankDate: skippedBlankDate };
  }

  function readForm() {
    return {
      company_name: ($('m-company').value || '').trim(),
      contact_person: ($('m-contact').value || '').trim(),
      continent: $('m-continent').value || '',
      region: ($('m-region').value || '').trim(),
      country: ($('m-country').value || '').trim(),
      city: ($('m-city').value || '').trim(),
      portsText: $('m-ports').value || '',
      website: ($('m-website').value || '').trim(),
      description: ($('m-description').value || '').trim(),
      membership_tier: ($('m-tier').value || '').trim(),
      renewal_date: $('m-renewal') ? ($('m-renewal').value || '') : '',
      membership_term_years: $('m-term') ? ($('m-term').value || '') : '',
      status: $('m-status').value || 'pending',
      notes: ($('m-notes').value || '').trim()
    };
  }

  function updateExpiryHint() {
    var el = $('m-expiry-days');
    if (!el) return;
    var date = $('m-renewal') && $('m-renewal').value;
    if (!date) {
      el.textContent = 'No expiry set';
      el.className = 'field-note muted';
      return;
    }
    var days = daysUntilRenewal(date);
    var cls = daysLeftClass(days);
    el.textContent = formatDaysLeft(days) + ' (from ' + fmtDateOnly(date) + ', Hong Kong date)';
    el.className = 'field-note admin-expiry-meta' + (cls ? ' ' + cls : '');
  }

  var emailsLoadSeq = 0;

  async function hydrateEmails(m, isNew) {
    var box = $('m-emails');
    if (!box || !window.MemberEmails) return;
    MemberEmails.bind(box);
    var seq = ++emailsLoadSeq;
    var rows;
    if (isNew) {
      MemberEmails.renderList(box, [{ label: 'main', email: '' }], { blankIfEmpty: true });
      return;
    }
    try {
      rows = await MemberEmails.loadForAdmin(client, m);
    } catch (err) {
      rows = MemberEmails.rowsFromMember(m);
    }
    if (seq !== emailsLoadSeq) return;
    MemberEmails.renderList(box, rows || [], { blankIfEmpty: false });
  }

  function readValidatedEmails() {
    if (!window.MemberEmails) {
      return { ok: false, error: 'Email list is not available.', emails: [] };
    }
    return MemberEmails.validate(MemberEmails.collectFrom($('m-emails')));
  }

  /* ---------- MEMBERS PAGE ---------- */
  var membersCache = [];
  var currentMember = null;
  var listFilters = { search: '', status: '', expiry: 'all', expireBefore: '', order: 'id' };
  var pendingExpiryAction = null;

  function syncApproveButton() {
    var approve = $('admin-approve-btn');
    if (!approve) return;
    approve.disabled = false;
    approve.title = 'Set status to active';
  }

  function fillForm(m, isNew) {
    currentMember = m ? Object.assign({}, m) : null;
    $('m-id').value = m && m.id != null ? String(m.id) : '';
    $('admin-detail-eyebrow').textContent = isNew ? 'Add member' : 'Edit member';
    $('admin-detail-title').textContent = isNew
      ? 'New member'
      : (m && m.company_name ? m.company_name : 'Member');

    $('m-company').value = (m && m.company_name) || '';
    $('m-contact').value = (m && m.contact_person) || '';
    $('m-continent').value = (m && m.continent) || '';
    $('m-region').value = (m && m.region) || '';
    $('m-country').value = (m && m.country) || '';
    $('m-city').value = (m && m.city) || '';
    $('m-ports').value = portsToText(m && m.ports);
    $('m-website').value = (m && m.website) || '';
    $('m-description').value = (m && m.description) || '';
    $('m-tier').value = (m && m.membership_tier) || '';
    if ($('m-renewal')) $('m-renewal').value = toDateInput(m && m.renewal_date);
    if ($('m-term')) {
      $('m-term').value = (m && m.membership_term_years != null) ? String(m.membership_term_years) : '';
    }
    if ($('m-renew-term')) {
      var existingTerm = m && Number(m.membership_term_years);
      $('m-renew-term').value = (existingTerm >= 1 && existingTerm <= 5) ? String(existingTerm) : '1';
    }
    updateExpiryHint();
    var expiryActions = $('admin-expiry-actions');
    if (expiryActions) expiryActions.hidden = !!isNew;
    $('m-status').value = (m && m.status) || 'pending';
    $('m-notes').value = (m && m.notes) || '';
    BOOKLET_FIELDS.forEach(function (key) {
      var el = $(bookletInputId(key, 'm-'));
      if (el) el.value = (m && m[key]) || '';
    });
    $('m-created').textContent = m && m.created_at ? fmtDate(m.created_at) : '—';
    $('m-updated').textContent = m && m.updated_at ? fmtDate(m.updated_at) : '—';
    hydrateEmails(m, isNew);

    var hideBtn = $('admin-hide-btn');
    var removeBtn = $('admin-remove-btn');
    if (isNew) {
      hideBtn.hidden = true;
      removeBtn.hidden = true;
    } else {
      hideBtn.hidden = false;
      removeBtn.hidden = false;
      hideBtn.disabled = false;
      if (m && m.status === 'active') {
        hideBtn.textContent = 'Hide';
        hideBtn.title = 'Set status to pending (hide from public directory)';
      } else if (m && m.status === 'removed') {
        hideBtn.textContent = 'Restore to pending';
        hideBtn.title = 'Set status to pending';
      } else {
        hideBtn.textContent = 'Hide';
        hideBtn.disabled = true;
        hideBtn.title = 'Already pending (hidden from public directory)';
      }
    }
    $('admin-approve-btn').hidden = false;
    syncApproveButton();
    showDetailAlert('', null);
    var loginsCard = $('admin-logins-card');
    if (loginsCard) {
      if (isNew || !(m && m.id)) {
        loginsCard.hidden = true;
      } else {
        loginsCard.hidden = false;
        loadMemberLogins(m.id);
      }
    }
  }

  function showView(name) {
    $('admin-list-view').hidden = name !== 'list';
    $('admin-detail-view').hidden = name !== 'detail';
  }

  function setListState(which) {
    $('admin-list-loading').hidden = which !== 'loading';
    $('admin-list-empty').hidden = which !== 'empty';
    $('admin-list-error').hidden = which !== 'error';
    var showRows = which === 'grid';
    var isNarrow = window.matchMedia('(max-width: 900px)').matches;
    if (showRows) {
      $('admin-table-wrap').hidden = isNarrow;
      $('admin-cards').hidden = !isNarrow;
    } else {
      $('admin-table-wrap').hidden = true;
      $('admin-cards').hidden = true;
    }
  }

  function filteredMembers() {
    var q = (listFilters.search || '').trim().toLowerCase();
    var st = listFilters.status || '';
    return membersCache.filter(function (m) {
      if (st && m.status !== st) return false;
      if (!q) return true;
      var emailList = '';
      if (Array.isArray(m.emails)) {
        emailList = m.emails.map(function (row) { return (row && row.email) || ''; }).join(' ');
      }
      var hay = [
        m.company_name, m.contact_person, m.country, m.city, m.region, m.continent,
        m.email, emailList, m.membership_tier,
        m.address, m.principal_name, m.principal_email, m.principal_phone,
        m.network_name, m.network_email, m.network_phone
      ].map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
      return hay.indexOf(q) !== -1;
    });
  }

  async function openMember(id) {
    showView('detail');
    showAlert($('admin-detail-alert'), 'Loading…', 'info');
    var res = await fetchMemberById(id);
    if (res.error) {
      showDetailAlert(friendlyError(res.error, 'Could not load member.'), 'error');
      var cached = membersCache.find(function (row) { return String(row.id) === String(id); });
      if (cached) fillForm(cached, false);
      return;
    }
    var row = res.data;
    if (Array.isArray(row)) row = row[0];
    if (!row) {
      showDetailAlert('Member not found.', 'error');
      return;
    }
    upsertCache(row);
    fillForm(row, false);
    if (history.replaceState) {
      history.replaceState(null, '', 'members.html?id=' + encodeURIComponent(id));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openNew() {
    fillForm({ status: 'pending', ports: [] }, true);
    showView('detail');
    if (history.replaceState) history.replaceState(null, '', 'members.html?new=1');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToList(preserveFilters) {
    var loginsCard = $('admin-logins-card');
    if (loginsCard) loginsCard.hidden = true;
    showView('list');
    if (history.replaceState) {
      var p = new URLSearchParams();
      if (preserveFilters !== false) {
        if (listFilters.search) p.set('q', listFilters.search);
        if (listFilters.status) p.set('status', listFilters.status);
        if (listFilters.expiry && listFilters.expiry !== 'all') p.set('expiry', listFilters.expiry);
        if (listFilters.expireBefore) p.set('before', listFilters.expireBefore);
        if (listFilters.order && listFilters.order !== 'id') p.set('sort', listFilters.order);
      }
      var qs = p.toString();
      history.replaceState(null, '', 'members.html' + (qs ? '?' + qs : ''));
    }
  }

  function fillExpiryCell(el, m) {
    if (!el) return;
    el.textContent = '';
    var date = m && m.renewal_date;
    if (!date) {
      var none = document.createElement('span');
      none.className = 'admin-expiry-meta';
      none.textContent = 'No expiry set';
      el.appendChild(none);
      return;
    }
    var d = document.createElement('span');
    d.className = 'admin-expiry-date';
    d.textContent = fmtDateOnly(date);
    el.appendChild(d);
    var days = daysUntilRenewal(date);
    var meta = document.createElement('span');
    var cls = daysLeftClass(days);
    meta.className = 'admin-expiry-meta' + (cls ? ' ' + cls : '');
    var parts = [];
    var term = termLabel(m.membership_term_years);
    if (term) parts.push(term);
    parts.push(formatDaysLeft(days));
    meta.textContent = parts.join(' · ');
    el.appendChild(meta);
  }

  function renderList() {
    var rows = filteredMembers();
    var tbody = $('admin-table-body');
    var cards = $('admin-cards');
    tbody.innerHTML = '';
    cards.innerHTML = '';

    var anyFilter = !!(listFilters.search || listFilters.status ||
      (listFilters.expiry && listFilters.expiry !== 'all') ||
      listFilters.expireBefore ||
      (listFilters.order && listFilters.order !== 'id'));
    if ($('f-reset')) $('f-reset').disabled = !anyFilter;
    $('admin-count').textContent = membersCache.length
      ? ('Showing ' + rows.length + ' of ' + membersCache.length + ' member' + (membersCache.length === 1 ? '' : 's'))
      : 'No members loaded';

    if (!rows.length) {
      setListState('empty');
      return;
    }

    rows.forEach(function (m) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('data-id', m.id);
      tr.innerHTML = '<td class="company"></td><td class="loc"></td><td class="st"></td><td class="tier"></td><td class="ren"></td><td class="upd"></td>';
      tr.querySelector('.company').textContent = m.company_name || '—';
      tr.querySelector('.loc').textContent = [m.city, m.country].filter(Boolean).join(', ') || '—';
      tr.querySelector('.st').appendChild(statusBadge(m.status));
      tr.querySelector('.tier').textContent = m.membership_tier || '—';
      fillExpiryCell(tr.querySelector('.ren'), m);
      tr.querySelector('.upd').textContent = fmtDate(m.updated_at);
      tr.addEventListener('click', function () { openMember(m.id); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMember(m.id); }
      });
      tbody.appendChild(tr);

      var li = document.createElement('li');
      li.className = 'admin-card';
      li.tabIndex = 0;
      var top = document.createElement('div');
      top.className = 'admin-card-top';
      var h = document.createElement('h3');
      h.textContent = m.company_name || '—';
      top.appendChild(h);
      top.appendChild(statusBadge(m.status));
      li.appendChild(top);
      var meta = document.createElement('div');
      meta.className = 'admin-card-meta';
      var loc = document.createElement('div');
      loc.textContent = [m.city, m.country].filter(Boolean).join(', ') || 'No location';
      meta.appendChild(loc);
      var expiryLine = document.createElement('div');
      fillExpiryCell(expiryLine, m);
      meta.appendChild(expiryLine);
      li.appendChild(meta);
      li.addEventListener('click', function () { openMember(m.id); });
      cards.appendChild(li);
    });
    setListState('grid');
  }

  async function loadMembers() {
    setListState('loading');
    $('admin-count').textContent = 'Loading…';
    showAlert($('admin-alert'), '', null);
    var res = await fetchMembersForAdmin();
    if (res.error) {
      membersCache = [];
      $('admin-list-error-msg').textContent = friendlyError(
        res.error,
        'Could not load members via admin_list_members.'
      );
      setListState('error');
      $('admin-count').textContent = '';
      return;
    }
    membersCache = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
    renderList();
  }

  async function saveMember(extra) {
    var alertEl = $('admin-detail-alert');
    showDetailAlert('', null);
    var form = readForm();
    if (extra && extra.status) form.status = extra.status;

    if (!form.company_name || !form.continent || !form.country) {
      showDetailAlert('Company name, continent and country are required.', 'error');
      return false;
    }

    var emailsCheck = readValidatedEmails();
    if (!emailsCheck.ok) {
      showDetailAlert(emailsCheck.error, 'error');
      return false;
    }
    form.email = window.MemberEmails ? MemberEmails.firstMainEmail(emailsCheck.emails) : (form.email || '');

    var booklet = readBookletForm();
    var bookletCheck = validateBookletFields(booklet);
    if (!bookletCheck.ok) {
      showDetailAlert(bookletCheck.error, 'error');
      return false;
    }
    Object.keys(booklet).forEach(function (k) { form[k] = booklet[k]; });
    var id = ($('m-id').value || '').trim();
    var bookletPatch = bookletUpdateArgs(booklet, id ? currentMember : null);
    var skippedClears = bookletPatch.skippedClears;
    var args = buildMemberArgs(form);
    var expiryInfo = applyExpiryArgs(args, form, id ? 'update' : 'insert');
    if (id) {
      Object.keys(bookletPatch.args).forEach(function (k) { args[k] = bookletPatch.args[k]; });
    }
    var saveBtn = $('admin-save-btn');
    setBusy(saveBtn, true, 'Saving…');

    try {
      var res;
      if (id) {
        args.p_member_id = Number(id);
        res = await PUAuth.adminUpdateMember(client, args);
      } else {
        res = await PUAuth.adminInsertMember(client, args);
      }
      if (res.error) {
        showDetailAlert(friendlyError(res.error, 'Could not save member.'), 'error');
        setBusy(saveBtn, false, 'Save');
        return false;
      }
      var saved = res.data;
      if (Array.isArray(saved)) saved = saved[0];
      if (saved) {
        var bookletErr = null;
        if (!id && saved.id != null && Object.keys(bookletPatch.args).length) {
          var bookletRes = await client.rpc(RPC.adminUpdateMember, Object.assign({
            p_member_id: Number(saved.id)
          }, bookletPatch.args));
          if (bookletRes.error) {
            bookletErr = friendlyError(bookletRes.error, 'Could not save office address or booklet contacts.');
          } else {
            var bookletRow = bookletRes.data;
            if (Array.isArray(bookletRow)) bookletRow = bookletRow[0];
            if (bookletRow) saved = bookletRow;
          }
        }
        var emailErr = null;
        if (saved.id != null && RPC.adminSetMemberEmails) {
          var emailRes = await client.rpc(RPC.adminSetMemberEmails, {
            p_member_id: Number(saved.id),
            p_emails: emailsCheck.emails
          });
          if (emailRes.error) {
            emailErr = friendlyError(emailRes.error, 'Could not save the directory email list.');
          } else {
            var returned = emailRes.data;
            if (returned && !Array.isArray(returned) && Array.isArray(returned.emails)) {
              returned = returned.emails;
            }
            saved.emails = Array.isArray(returned) ? returned : emailsCheck.emails;
            saved.email = window.MemberEmails
              ? (MemberEmails.firstMainEmail(saved.emails) || null)
              : (form.email || null);
          }
        }
        upsertCache(saved);
        fillForm(saved, false);
        var saveParts = [];
        if (bookletErr) saveParts.push('Member saved, but office address or booklet contacts could not be updated. ' + bookletErr);
        if (emailErr) saveParts.push(bookletErr ? 'The email list could not be updated. ' + emailErr : ('Member saved, but the email list could not be updated. ' + emailErr));
        if (!saveParts.length) saveParts.push('Saved.');
        if (skippedClears.length) {
          saveParts.push(
            skippedClears.map(fieldLabel).join(', ') +
            (skippedClears.length === 1 ? ' was' : ' were') +
            ' left unchanged because the admin form cannot clear booklet fields. The member owner can submit an empty value for approval.'
          );
        }
        if (expiryInfo.skippedBlankDate) {
          saveParts.push('Expiry date was left unchanged. Use Clear expiry to remove the date and term.');
        }
        var saveKind = (bookletErr || emailErr) ? 'error' : 'ok';
        showDetailAlert(saveParts.join(' '), saveKind);
        if (history.replaceState) {
          history.replaceState(null, '', 'members.html?id=' + encodeURIComponent(saved.id));
        }
        setBusy(saveBtn, false, saveKind === 'ok' ? 'Saved' : 'Save');
        if (saveKind === 'ok') flashSavedButton();
      } else {
        showDetailAlert('Saved.', 'ok');
        await loadMembers();
        flashSavedButton();
      }
      if (saveBtn && !saveBtn.classList.contains('is-saved')) setBusy(saveBtn, false, 'Save');
      return true;
    } catch (err) {
      showDetailAlert(friendlyError(err, 'Could not save member.'), 'error');
      setBusy(saveBtn, false, 'Save');
      return false;
    }
  }

  function openModal() { $('admin-modal').hidden = false; $('admin-modal-confirm').focus(); }
  function closeModal() { $('admin-modal').hidden = true; }

  async function initMembers() {
    var gate = $('admin-gate');
    gate.hidden = false;
    var auth = await requireAdmin();
    gate.hidden = true;
    if (!auth) return;

    $('admin-denied').hidden = true;
    if (window.MemberEmails) MemberEmails.bind($('m-emails'));
    showView('list');

    $('admin-signout-btn').addEventListener('click', signOut);
    $('admin-add-btn').addEventListener('click', openNew);
    $('admin-back-btn').addEventListener('click', function () { backToList(true); loadMembers(); });
    $('admin-list-retry').addEventListener('click', loadMembers);
    $('admin-empty-reset').addEventListener('click', function () {
      resetListFilters();
      loadMembers();
    });
    $('f-search').addEventListener('input', function () { listFilters.search = $('f-search').value; renderList(); });
    $('f-status').addEventListener('change', function () { listFilters.status = $('f-status').value; renderList(); });
    if ($('f-expiry')) {
      $('f-expiry').addEventListener('change', function () {
        listFilters.expiry = $('f-expiry').value || 'all';
        syncExpiryFilterUi();
        loadMembers();
      });
    }
    if ($('f-expire-before')) {
      $('f-expire-before').addEventListener('change', function () {
        listFilters.expireBefore = $('f-expire-before').value || '';
        loadMembers();
      });
    }
    if ($('f-sort')) {
      $('f-sort').addEventListener('change', function () {
        listFilters.order = $('f-sort').value || 'id';
        loadMembers();
      });
    }
    $('f-reset').addEventListener('click', function () {
      resetListFilters();
      loadMembers();
    });
    if ($('m-renewal')) {
      $('m-renewal').addEventListener('input', updateExpiryHint);
      $('m-renewal').addEventListener('change', updateExpiryHint);
    }
    $('admin-member-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      await saveMember();
    });

    $('admin-approve-btn').addEventListener('click', async function () {
      var alertEl = $('admin-detail-alert');
      var id = ($('m-id').value || '').trim();
      if (!id) {
        var ok = await saveMember({ status: 'active' });
        if (ok) showDetailAlert('Member approved (status = active).', 'ok');
        return;
      }
      setBusy($('admin-approve-btn'), true, 'Approving…');
      var args = { p_member_id: Number(id), p_status: 'active' };
      var res = await client.rpc(RPC.adminUpdateMember, args);
      setBusy($('admin-approve-btn'), false, 'Approve');
      if (res.error) {
        showDetailAlert(friendlyError(res.error, 'Could not approve member.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showDetailAlert('Member approved (status = active).', 'ok');
      syncApproveButton();
    });

    $('admin-hide-btn').addEventListener('click', async function () {
      var alertEl = $('admin-detail-alert');
      var id = ($('m-id').value || '').trim();
      if (!id) return;
      setBusy($('admin-hide-btn'), true, 'Updating…');
      var res = await client.rpc(RPC.adminHideMember, { p_member_id: Number(id) });
      setBusy($('admin-hide-btn'), false, 'Hide');
      if (res.error) {
        showDetailAlert(friendlyError(res.error, 'Could not hide member.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showDetailAlert('Hidden from directory (status = pending).', 'ok');
    });

    $('admin-remove-btn').addEventListener('click', openModal);
    $('admin-modal').querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    $('admin-modal-confirm').addEventListener('click', async function () {
      closeModal();
      var alertEl = $('admin-detail-alert');
      var id = ($('m-id').value || '').trim();
      if (!id) return;
      var res = await client.rpc(RPC.adminRemoveMember, {
        p_member_id: Number(id),
        p_note: 'Removed via admin portal'
      });
      if (res.error) {
        showDetailAlert(friendlyError(res.error, 'Could not remove member.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showDetailAlert('Member removed (soft delete; status = removed).', 'ok');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('admin-modal').hidden) closeModal();
    });
    window.addEventListener('resize', function () {
      if (!$('admin-list-view').hidden && membersCache.length) renderList();
    });

    var params = new URLSearchParams(location.search);
    if (params.get('q')) { listFilters.search = params.get('q'); $('f-search').value = listFilters.search; }
    if (params.get('status')) { listFilters.status = params.get('status'); $('f-status').value = listFilters.status; }
    if (params.get('expiry') && $('f-expiry')) {
      var ex = params.get('expiry');
      if (ex === 'missing' || ex === 'expired' || ex === 'all') {
        listFilters.expiry = ex;
        $('f-expiry').value = ex;
      }
    }
    if (params.get('before') && $('f-expire-before')) {
      listFilters.expireBefore = params.get('before');
      $('f-expire-before').value = listFilters.expireBefore;
    }
    if (params.get('sort') && $('f-sort')) {
      var sort = params.get('sort');
      if (sort === 'id' || sort === 'renewal_date_asc' || sort === 'renewal_date_desc') {
        listFilters.order = sort;
        $('f-sort').value = sort;
      }
    }
    syncExpiryFilterUi();

    function openExpiryModal(action, title, body, confirmLabel, confirmClass) {
      pendingExpiryAction = action;
      $('admin-expiry-modal-title').textContent = title;
      $('admin-expiry-modal-body').textContent = body;
      var btn = $('admin-expiry-modal-confirm');
      btn.textContent = confirmLabel || 'Confirm';
      btn.className = confirmClass || 'btn btn-primary';
      $('admin-expiry-modal').hidden = false;
      btn.focus();
    }

    function closeExpiryModal() {
      var modal = $('admin-expiry-modal');
      if (modal) modal.hidden = true;
      pendingExpiryAction = null;
    }

    async function renewMember() {
      var alertEl = $('admin-detail-alert');
      var id = ($('m-id').value || '').trim();
      var years = Number($('m-renew-term') && $('m-renew-term').value);
      if (!id) return;
      if (!(years >= 1 && years <= 5)) {
        showDetailAlert('Pick a membership term of 1 to 5 years to renew.', 'error');
        return;
      }
      setBusy($('admin-renew-btn'), true, 'Renewing…');
      var res = await PUAuth.adminRenewMember(client, id, years);
      setBusy($('admin-renew-btn'), false, 'Renew membership');
      if (res.error) {
        showDetailAlert(friendlyError(res.error, 'Could not renew this membership.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) {
        upsertCache(row);
        fillForm(row, false);
        var date = fmtDateOnly(row.renewal_date);
        var days = formatDaysLeft(daysUntilRenewal(row.renewal_date));
        var term = termLabel(row.membership_term_years);
        showDetailAlert('Membership renewed' + (term ? ' for ' + term : '') + '. New expiry: ' + date + ' (' + days + ').', 'ok');
      } else {
        showDetailAlert('Membership renewed.', 'ok');
      }
    }

    async function clearExpiry() {
      var alertEl = $('admin-detail-alert');
      var id = ($('m-id').value || '').trim();
      if (!id) return;
      setBusy($('admin-clear-expiry-btn'), true, 'Clearing…');
      var res = await PUAuth.adminUpdateMember(client, {
        p_member_id: Number(id),
        p_clear_renewal_date: true
      });
      setBusy($('admin-clear-expiry-btn'), false, 'Clear expiry');
      if (res.error) {
        showDetailAlert(friendlyError(res.error, 'Could not clear the expiry date.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showDetailAlert('Expiry date and membership term have been cleared.', 'ok');
    }

    if ($('admin-renew-btn')) {
      $('admin-renew-btn').addEventListener('click', function () {
        var id = ($('m-id').value || '').trim();
        var years = Number($('m-renew-term') && $('m-renew-term').value);
        if (!id) return;
        if (!(years >= 1 && years <= 5)) {
          showDetailAlert('Pick a membership term of 1 to 5 years to renew.', 'error');
          return;
        }
        var term = termLabel(years);
        openExpiryModal(
          'renew',
          'Renew membership?',
          'Renew this membership for ' + term + '? The new expiry is calculated on the server: it extends the current expiry if that date is still valid, or starts from today if the membership has expired or has no date. Status is not changed.',
          'Renew',
          'btn btn-primary'
        );
      });
    }
    if ($('admin-clear-expiry-btn')) {
      $('admin-clear-expiry-btn').addEventListener('click', function () {
        var id = ($('m-id').value || '').trim();
        if (!id) return;
        openExpiryModal(
          'clear',
          'Clear expiry?',
          'Clear the expiry date and membership term for this member? You can set them again afterwards.',
          'Clear expiry',
          'btn admin-btn-danger'
        );
      });
    }
    var expiryModal = $('admin-expiry-modal');
    if (expiryModal) {
      expiryModal.querySelectorAll('[data-modal-close]').forEach(function (el) {
        el.addEventListener('click', closeExpiryModal);
      });
      $('admin-expiry-modal-confirm').addEventListener('click', async function () {
        var action = pendingExpiryAction;
        closeExpiryModal();
        if (action === 'renew') await renewMember();
        else if (action === 'clear') await clearExpiry();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !expiryModal.hidden) closeExpiryModal();
      });
    }

    var loginsModal = $('logins-modal');
    if (loginsModal) {
      loginsModal.querySelectorAll('[data-modal-close]').forEach(function (el) {
        el.addEventListener('click', closeLoginsModal);
      });
      $('logins-modal-confirm').addEventListener('click', confirmLoginsAction);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !loginsModal.hidden) closeLoginsModal();
      });
    }

    if ($('logins-invite-btn')) {
      $('logins-invite-btn').addEventListener('click', openInviteLoginModal);
    }
    var inviteLoginModal = $('logins-invite-modal');
    if (inviteLoginModal) {
      inviteLoginModal.querySelectorAll('[data-invite-login-close]').forEach(function (el) {
        el.addEventListener('click', closeInviteLoginModal);
      });
      $('logins-invite-form').addEventListener('submit', submitInviteLoginForm);
      $('logins-invite-role').addEventListener('change', onInviteRoleChange);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !inviteLoginModal.hidden) closeInviteLoginModal();
      });
    }

    await loadMembers();
    if (params.get('new') === '1') openNew();
    else if (params.get('id')) await openMember(params.get('id'));
  }

  /* ---------- ADMINS PAGE ---------- */
  var usersCache = [];
  var userFilters = { search: '', role: '' };
  var pendingConfirm = null;
  var pendingRenameUser = null;

  function isSuperUser(u) {
    return !!(u && u.is_super_admin);
  }

  function isAdminUser(u) {
    return !!(u && (u.is_admin || u.role === 'admin'));
  }

  function hasCompanyLink(u) {
    return !!(u && (u.member_id != null || u.company_name));
  }

  function roleBadge(u) {
    var span = document.createElement('span');
    if (isSuperUser(u)) {
      span.className = 'admin-badge is-super';
      span.textContent = 'Super admin';
    } else if (isAdminUser(u)) {
      span.className = 'admin-badge is-active';
      span.textContent = 'Admin';
    } else {
      span.className = 'admin-badge is-member';
      span.textContent = 'Member';
    }
    return span;
  }

  function fillCompanyCell(el, u) {
    el.textContent = '';
    var name = u && u.company_name;
    if (!name) {
      el.textContent = '—';
      return;
    }
    var strong = document.createElement('span');
    strong.className = 'company';
    strong.textContent = name;
    el.appendChild(strong);
    if (u.member_role) {
      var sub = document.createElement('span');
      sub.className = 'admin-company-role';
      sub.textContent = u.member_role;
      el.appendChild(sub);
    }
  }

  function smallBtn(label, className, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className + ' admin-btn-sm';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function userActions(u) {
    var wrap = document.createElement('div');
    wrap.className = 'admin-row-actions';
    wrap.appendChild(smallBtn('Rename', 'btn btn-outline', function () { openRenameModal(u); }));
    if (isSuperUser(u)) return wrap;
    if (isAdminUser(u)) {
      wrap.appendChild(smallBtn('Remove', 'btn admin-btn-danger', function () { openRemoveModal(u); }));
    } else {
      wrap.appendChild(smallBtn('Grant admin', 'btn btn-outline', function () { openGrantModal(u); }));
    }
    return wrap;
  }

  function hideUserStates() {
    ['admins-loading', 'admins-error', 'admins-empty', 'admins-table-wrap', 'admins-cards'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
  }

  function userRoleKey(u) {
    if (isAdminUser(u) || isSuperUser(u)) return 'admin';
    return 'member';
  }

  function anyUserFilter() {
    return !!(userFilters.search || userFilters.role);
  }

  function filteredUsers() {
    var q = (userFilters.search || '').trim().toLowerCase();
    var role = userFilters.role || '';
    return usersCache.filter(function (u) {
      if (role && userRoleKey(u) !== role) return false;
      if (!q) return true;
      var hay = [u.email, u.full_name, u.company_name, u.member_role]
        .map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
      return hay.indexOf(q) !== -1;
    });
  }

  function syncUserFilterUrl() {
    if (!history.replaceState) return;
    var p = new URLSearchParams();
    if (userFilters.search) p.set('q', userFilters.search);
    if (userFilters.role) p.set('role', userFilters.role);
    var qs = p.toString();
    history.replaceState(null, '', 'admins.html' + (qs ? '?' + qs : ''));
  }

  function resetUserFilters() {
    userFilters.search = '';
    userFilters.role = '';
    if ($('u-search')) $('u-search').value = '';
    if ($('u-role')) $('u-role').value = '';
    syncUserFilterUrl();
    renderUsers();
  }

  function readUserFiltersFromUrl() {
    var params = new URLSearchParams(location.search);
    if (params.get('q')) {
      userFilters.search = params.get('q');
      if ($('u-search')) $('u-search').value = userFilters.search;
    }
    var role = params.get('role');
    if (role === 'admin' || role === 'member') {
      userFilters.role = role;
      if ($('u-role')) $('u-role').value = role;
    }
  }

  async function loadUsers() {
    hideUserStates();
    var loading = $('admins-loading');
    if (loading) loading.hidden = false;
    var res = await client.rpc(RPC.adminListUsers);
    if (loading) loading.hidden = true;
    if (res.error) {
      var errEl = $('admins-error');
      if (errEl) {
        errEl.hidden = false;
        $('admins-error-msg').textContent = friendlyError(res.error, 'Could not load users.');
      }
      return;
    }
    usersCache = Array.isArray(res.data) ? res.data : [];
    renderUsers();
  }

  function renderUsers() {
    var tbody = $('admins-table-body');
    var cards = $('admins-cards');
    var wrap = $('admins-table-wrap');
    var empty = $('admins-empty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (cards) cards.innerHTML = '';

    var rows = filteredUsers();
    var filtered = anyUserFilter();
    if ($('u-reset')) $('u-reset').disabled = !filtered;

    if ($('admins-count')) {
      $('admins-count').textContent = usersCache.length
        ? ('Showing ' + rows.length + ' of ' + usersCache.length + ' user' + (usersCache.length === 1 ? '' : 's'))
        : '0 users';
    }

    if (!usersCache.length || !rows.length) {
      if (empty) empty.hidden = false;
      if (wrap) wrap.hidden = true;
      if (cards) cards.hidden = true;
      if ($('admins-empty-title')) {
        $('admins-empty-title').textContent = usersCache.length ? 'No users match' : 'No users found';
      }
      if ($('admins-empty-msg')) {
        $('admins-empty-msg').textContent = usersCache.length
          ? 'Try clearing the search or role filter.'
          : 'Users appear here after they have signed up / been created in Auth.';
      }
      if ($('admins-empty-reset')) $('admins-empty-reset').hidden = !usersCache.length;
      return;
    }
    if (empty) empty.hidden = true;

    var isNarrow = window.matchMedia('(max-width: 900px)').matches;
    if (isNarrow && cards) {
      if (wrap) wrap.hidden = true;
      cards.hidden = false;
    } else {
      if (wrap) wrap.hidden = false;
      if (cards) cards.hidden = true;
    }

    rows.forEach(function (u) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="em"></td><td class="nm"></td><td class="rl"></td><td class="co"></td><td class="cr"></td><td class="ac"></td>';
      tr.querySelector('.em').textContent = u.email || '—';
      tr.querySelector('.nm').textContent = u.full_name || '—';
      tr.querySelector('.rl').appendChild(roleBadge(u));
      fillCompanyCell(tr.querySelector('.co'), u);
      tr.querySelector('.cr').textContent = fmtDate(u.created_at);
      tr.querySelector('.ac').appendChild(userActions(u));
      tbody.appendChild(tr);

      if (cards) {
        var li = document.createElement('li');
        li.className = 'admin-card admin-card-static';
        var top = document.createElement('div');
        top.className = 'admin-card-top';
        var h3 = document.createElement('h3');
        h3.textContent = u.email || '—';
        top.appendChild(h3);
        top.appendChild(roleBadge(u));
        li.appendChild(top);
        var meta = document.createElement('div');
        meta.className = 'admin-card-meta';
        var nameLine = document.createElement('div');
        nameLine.textContent = 'Name: ' + (u.full_name || '—');
        meta.appendChild(nameLine);
        var coLine = document.createElement('div');
        if (u.company_name) {
          coLine.textContent = 'Company: ' + u.company_name + (u.member_role ? ' (' + u.member_role + ')' : '');
        } else {
          coLine.textContent = 'Company: —';
        }
        meta.appendChild(coLine);
        var crLine = document.createElement('div');
        crLine.textContent = 'Created: ' + fmtDate(u.created_at);
        meta.appendChild(crLine);
        li.appendChild(meta);
        var actions = userActions(u);
        actions.className += ' admin-card-actions';
        li.appendChild(actions);
        cards.appendChild(li);
      }
    });

  }

  function closeInviteModal() {
    var modal = $('admins-invite-modal');
    if (modal) modal.hidden = true;
    setBusy($('admins-invite-submit'), false, 'Send invite');
  }

  function closeRenameModal() {
    pendingRenameUser = null;
    var modal = $('admins-rename-modal');
    if (modal) modal.hidden = true;
    setBusy($('admins-rename-submit'), false, 'Save name');
  }

  function closeConfirmModal() {
    pendingConfirm = null;
    var modal = $('admins-modal');
    if (modal) modal.hidden = true;
    var btn = $('admins-modal-confirm');
    if (btn) {
      btn.className = 'btn btn-primary';
      btn.textContent = 'Confirm';
      setBusy(btn, false);
    }
  }

  function closeAllAdminsModals() {
    closeInviteModal();
    closeRenameModal();
    closeConfirmModal();
  }

  function anyAdminsModalOpen() {
    return ($('admins-invite-modal') && !$('admins-invite-modal').hidden) ||
      ($('admins-rename-modal') && !$('admins-rename-modal').hidden) ||
      ($('admins-modal') && !$('admins-modal').hidden);
  }

  function openInviteModal() {
    showAlert($('admins-invite-alert'), '', null);
    $('invite-email').value = '';
    $('invite-name').value = '';
    $('admins-invite-modal').hidden = false;
    $('invite-email').focus();
  }

  function inviteSuccessMessage(data) {
    data = data || {};
    if (data.already_admin) return 'This person is already an admin.';
    if (data.invite_sent) return 'Invite email sent.';
    if (data.already_had_login) return 'Admin access granted. No extra email was sent because they already have a login.';
    return 'Admin access granted.';
  }

  async function submitInvite(e) {
    e.preventDefault();
    var email = ($('invite-email').value || '').trim();
    var name = ($('invite-name').value || '').trim();
    if (!email) {
      showAlert($('admins-invite-alert'), 'Enter a valid email address.', 'error');
      return;
    }
    if (name.length > 200) {
      showAlert($('admins-invite-alert'), 'Name must be at most 200 characters.', 'error');
      return;
    }
    var btn = $('admins-invite-submit');
    setBusy(btn, true, 'Sending…');
    showAlert($('admins-invite-alert'), '', null);
    var body = { email: email };
    if (name) body.full_name = name;
    var res = await PUAuth.invokeFunction(client, PUAuth.CONFIG.functions.inviteAdmin, body);
    setBusy(btn, false, 'Send invite');
    if (res.error) {
      showAlert($('admins-invite-alert'), friendlyError(res.error, 'Could not invite this admin.'), 'error');
      return;
    }
    closeInviteModal();
    showAlert($('admins-alert'), inviteSuccessMessage(res.data), 'ok');
    await loadUsers();
  }

  function openRenameModal(u) {
    pendingRenameUser = u;
    showAlert($('admins-rename-alert'), '', null);
    $('rename-name').value = u.full_name || '';
    $('admins-rename-modal').hidden = false;
    $('rename-name').focus();
    $('rename-name').select();
  }

  async function submitRename(e) {
    e.preventDefault();
    if (!pendingRenameUser) return;
    var name = ($('rename-name').value || '').trim();
    if (name.length > 200) {
      showAlert($('admins-rename-alert'), 'Name must be at most 200 characters.', 'error');
      return;
    }
    var btn = $('admins-rename-submit');
    setBusy(btn, true, 'Saving…');
    var res = await client.rpc(RPC.adminSetUserName, {
      p_user_id: pendingRenameUser.id,
      p_full_name: name
    });
    setBusy(btn, false, 'Save name');
    if (res.error) {
      showAlert($('admins-rename-alert'), friendlyError(res.error, 'Could not update the name.'), 'error');
      return;
    }
    closeRenameModal();
    showAlert($('admins-alert'), 'Name updated.', 'ok');
    await loadUsers();
  }

  function openGrantModal(u) {
    pendingConfirm = { type: 'grant', user: u };
    $('admins-modal-title').textContent = 'Grant admin?';
    $('admins-modal-body').textContent = 'Grant admin access to this person? They already have a login, so no invite email will be sent and a second account will not be created.';
    var btn = $('admins-modal-confirm');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Grant admin';
    $('admins-modal').hidden = false;
  }

  function openRemoveModal(u) {
    pendingConfirm = { type: 'remove', user: u };
    $('admins-modal-title').textContent = 'Remove admin?';
    $('admins-modal-body').textContent = hasCompanyLink(u)
      ? 'Remove admin access for this person? They are linked to a company, so they will keep their member login and can still sign in as a member.'
      : 'Remove admin access for this person? They have no company link, so their login will be disabled (not permanently deleted). This can be turned back on later if needed.';
    var btn = $('admins-modal-confirm');
    btn.className = 'btn admin-btn-danger';
    btn.textContent = 'Remove admin';
    $('admins-modal').hidden = false;
  }

  function removeSuccessMessage(data) {
    data = data || {};
    if (data.auth_disabled) {
      return 'Admin access removed. Their login has been disabled.';
    }
    if (data.had_company_link) {
      return 'Admin access removed. They can still sign in as a member.';
    }
    return 'Admin access removed.';
  }

  async function confirmAdminsAction() {
    if (!pendingConfirm) return;
    var action = pendingConfirm;
    var u = action.user;
    var btn = $('admins-modal-confirm');
    setBusy(btn, true, 'Working…');
    showAlert($('admins-alert'), '', null);
    var res;
    if (action.type === 'grant') {
      if (!u || !u.email) {
        closeConfirmModal();
        showAlert($('admins-alert'), 'This user has no email, so admin access cannot be granted this way.', 'error');
        return;
      }
      res = await PUAuth.invokeFunction(client, PUAuth.CONFIG.functions.inviteAdmin, { email: u.email });
      closeConfirmModal();
      if (res.error) {
        showAlert($('admins-alert'), friendlyError(res.error, 'Could not grant admin access.'), 'error');
        return;
      }
      showAlert($('admins-alert'), inviteSuccessMessage(res.data), 'ok');
    } else if (action.type === 'remove') {
      res = await PUAuth.invokeFunction(client, PUAuth.CONFIG.functions.removeAdmin, { user_id: u.id });
      closeConfirmModal();
      if (res.error) {
        showAlert($('admins-alert'), friendlyError(res.error, 'Could not remove this admin.'), 'error');
        return;
      }
      showAlert($('admins-alert'), removeSuccessMessage(res.data), 'ok');
    } else {
      closeConfirmModal();
      return;
    }
    await loadUsers();
  }

  async function initAdmins() {
    var gate = $('admin-gate');
    if (gate) gate.hidden = false;
    var auth = await requireAdmin();
    if (gate) gate.hidden = true;
    if (!auth) return;

    $('admin-signout-btn').addEventListener('click', signOut);

    if (!auth.isSuperAdmin) {
      if ($('admins-forbidden')) $('admins-forbidden').hidden = false;
      if ($('admins-manage')) $('admins-manage').hidden = true;
      return;
    }

    $('admins-manage').hidden = false;
    $('admins-invite-btn').addEventListener('click', openInviteModal);
    $('admins-invite-form').addEventListener('submit', submitInvite);
    $('admins-invite-modal').querySelectorAll('[data-invite-close]').forEach(function (el) {
      el.addEventListener('click', closeInviteModal);
    });
    $('admins-rename-form').addEventListener('submit', submitRename);
    $('admins-rename-modal').querySelectorAll('[data-rename-close]').forEach(function (el) {
      el.addEventListener('click', closeRenameModal);
    });
    $('admins-retry').addEventListener('click', loadUsers);
    if ($('u-search')) {
      $('u-search').addEventListener('input', function () {
        userFilters.search = $('u-search').value;
        syncUserFilterUrl();
        renderUsers();
      });
    }
    if ($('u-role')) {
      $('u-role').addEventListener('change', function () {
        userFilters.role = $('u-role').value;
        syncUserFilterUrl();
        renderUsers();
      });
    }
    if ($('u-reset')) $('u-reset').addEventListener('click', resetUserFilters);
    if ($('admins-empty-reset')) $('admins-empty-reset').addEventListener('click', resetUserFilters);
    readUserFiltersFromUrl();
    $('admins-modal').querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeConfirmModal);
    });
    $('admins-modal-confirm').addEventListener('click', confirmAdminsAction);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && anyAdminsModalOpen()) closeAllAdminsModals();
    });
    window.addEventListener('resize', function () {
      if (usersCache.length) renderUsers();
    });

    await loadUsers();
  }


  /* ---------- member logins (admin) ---------- */
  var pendingLoginAction = null;

  async function loadMemberLogins(memberId) {
    var wrap = $('logins-table-wrap');
    var empty = $('logins-empty');
    var tbody = $('logins-table-body');
    if (!tbody) return;
    showAlert($('logins-alert'), '', null);
    var res = await client.rpc(RPC.adminListMemberUsers, { p_member_id: Number(memberId) });
    if (res.error) {
      showAlert($('logins-alert'), friendlyError(res.error, 'Could not load logins.'), 'error');
      if (wrap) wrap.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }
    var rows = Array.isArray(res.data) ? res.data : [];
    tbody.innerHTML = '';
    if (!rows.length) {
      if (empty) empty.hidden = false;
      if (wrap) wrap.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (wrap) wrap.hidden = false;
    rows.forEach(function (u) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="nm"></td><td class="rl"></td><td class="lk"></td><td class="inv"></td><td class="ac"></td>';
      tr.querySelector('.nm').textContent = u.full_name || '—';
      var badge = document.createElement('span');
      badge.className = 'admin-badge ' + (u.role === 'owner' ? 'is-active' : 'is-pending');
      badge.textContent = u.role || 'staff';
      tr.querySelector('.rl').appendChild(badge);
      tr.querySelector('.lk').textContent = fmtDate(u.linked_at);
      tr.querySelector('.inv').textContent = u.invite_accepted ? 'Accepted' : 'Pending';
      var act = tr.querySelector('.ac');
      var setOwner = document.createElement('button');
      setOwner.type = 'button';
      setOwner.className = 'btn btn-outline';
      setOwner.style.padding = '.4rem .9rem';
      setOwner.style.fontSize = '.82rem';
      setOwner.style.marginRight = '.4rem';
      setOwner.textContent = 'Set owner';
      setOwner.disabled = u.role === 'owner';
      setOwner.addEventListener('click', function () {
        pendingLoginAction = { type: 'owner', memberId: memberId, user: u };
        $('logins-modal-title').textContent = 'Set as owner?';
        $('logins-modal-body').textContent = 'This login will become the company owner. The current owner will be unlinked (not kept as staff).';
        $('logins-modal').hidden = false;
      });
      var unlink = document.createElement('button');
      unlink.type = 'button';
      unlink.className = 'btn admin-btn-danger';
      unlink.style.padding = '.4rem .9rem';
      unlink.style.fontSize = '.82rem';
      unlink.textContent = 'Unlink';
      unlink.addEventListener('click', function () {
        pendingLoginAction = { type: 'unlink', memberId: memberId, user: u };
        $('logins-modal-title').textContent = 'Unlink this login?';
        $('logins-modal-body').textContent = 'They will no longer have access to this company. The login is kept as history.';
        $('logins-modal').hidden = false;
      });
      act.appendChild(setOwner);
      act.appendChild(unlink);
      tbody.appendChild(tr);
    });
  }

  function closeLoginsModal() {
    pendingLoginAction = null;
    var m = $('logins-modal');
    if (m) m.hidden = true;
  }

  async function confirmLoginsAction() {
    var action = pendingLoginAction;
    closeLoginsModal();
    if (!action) return;
    if (action.type === 'invite') {
      await sendLoginInvite(action);
      return;
    }
    var res;
    if (action.type === 'unlink') {
      res = await client.rpc(RPC.adminUnlinkUser, {
        p_member_id: Number(action.memberId),
        p_user_id: action.user.user_id
      });
    } else {
      res = await client.rpc(RPC.adminSetOwner, {
        p_member_id: Number(action.memberId),
        p_user_id: action.user.user_id,
        p_keep_old_owner_as_staff: false
      });
    }
    if (res.error) {
      showAlert($('logins-alert'), friendlyError(res.error, 'Could not update this login.'), 'error');
      return;
    }
    showAlert($('logins-alert'), action.type === 'unlink' ? 'Login unlinked.' : 'Owner updated.', 'ok');
    await loadMemberLogins(action.memberId);
  }

  function companyMainEmail() {
    if (currentMember && currentMember.email) return String(currentMember.email).trim();
    return '';
  }

  function inviteCompanyName() {
    if (currentMember && currentMember.company_name) return String(currentMember.company_name).trim();
    var el = $('m-company');
    return (el && (el.value || '').trim()) || 'this company';
  }

  function currentOpenMemberId() {
    if (currentMember && currentMember.id != null) return currentMember.id;
    var el = $('m-id');
    var v = el && (el.value || '').trim();
    return v || null;
  }

  function isValidInviteEmail(email) {
    return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function updateInviteEmailHint() {
    var hint = $('logins-invite-email-hint');
    if (!hint) return;
    var role = ($('logins-invite-role') && $('logins-invite-role').value) || 'owner';
    hint.textContent = role === 'owner'
      ? "You can use the company's main email, or enter a different address."
      : 'Enter the email address to invite as staff.';
  }

  function onInviteRoleChange() {
    updateInviteEmailHint();
    var input = $('logins-invite-email');
    if (!input) return;
    if (($('logins-invite-role').value || '') === 'owner' && !(input.value || '').trim()) {
      input.value = companyMainEmail();
    }
  }

  function closeInviteLoginModal() {
    var m = $('logins-invite-modal');
    if (m) m.hidden = true;
    setBusy($('logins-invite-continue'), false, 'Continue');
  }

  function openInviteLoginModal() {
    var id = currentOpenMemberId();
    if (!id) return;
    showAlert($('logins-invite-form-alert'), '', null);
    $('logins-invite-role').value = 'owner';
    $('logins-invite-email').value = companyMainEmail();
    updateInviteEmailHint();
    $('logins-invite-modal').hidden = false;
    $('logins-invite-email').focus();
  }

  function submitInviteLoginForm(e) {
    e.preventDefault();
    var role = ($('logins-invite-role').value || '').trim();
    var email = ($('logins-invite-email').value || '').trim();
    var memberId = currentOpenMemberId();
    if (role !== 'owner' && role !== 'staff') {
      showAlert($('logins-invite-form-alert'), 'Choose owner or staff.', 'error');
      return;
    }
    if (!isValidInviteEmail(email)) {
      showAlert($('logins-invite-form-alert'), 'Enter a valid email address.', 'error');
      return;
    }
    if (!memberId) {
      showAlert($('logins-invite-form-alert'), 'Open a company first.', 'error');
      return;
    }
    var company = inviteCompanyName();
    closeInviteLoginModal();
    pendingLoginAction = {
      type: 'invite',
      memberId: memberId,
      role: role,
      email: email,
      company: company
    };
    $('logins-modal-title').textContent = 'Send invite?';
    var article = role === 'owner' ? 'an' : 'a';
    $('logins-modal-body').textContent = 'Send ' + article + ' ' + role + ' invite to ' + email + ' for ' + company + '?';
    $('logins-modal').hidden = false;
  }

  async function sendLoginInvite(action) {
    showAlert($('logins-alert'), '', null);
    var res = await PUAuth.invokeFunction(client, PUAuth.CONFIG.functions.inviteMember, {
      role: action.role,
      email: action.email,
      member_id: Number(action.memberId)
    });
    if (res.error) {
      showAlert($('logins-alert'), friendlyError(res.error, 'Could not send this invite.'), 'error');
      return;
    }
    var data = res.data || {};
    if (data.ok === false) {
      showAlert($('logins-alert'), friendlyError({
        code: data.code,
        message: data.message
      }, 'Could not send this invite.'), 'error');
      return;
    }
    var sentTo = data.email || action.email;
    var sentRole = data.role || action.role;
    showAlert($('logins-alert'), 'Invite sent to ' + sentTo + ' as ' + sentRole + '.', 'ok');
    await loadMemberLogins(action.memberId);
  }

  /* ---------- pending edits ---------- */
  var pendingRejectId = null;

  function formatChangeVal(v) {
    if (window.MemberEmails && typeof MemberEmails.formatChangeVal === 'function') {
      return MemberEmails.formatChangeVal(v);
    }
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.join(', ') || '—';
    return String(v);
  }

  function renderEditDiff(currentVals, proposed) {
    var wrap = document.createElement('div');
    wrap.className = 'edit-diff';
    var headField = document.createElement('div');
    headField.className = 'edit-diff-head';
    headField.textContent = 'Field';
    var headOld = document.createElement('div');
    headOld.className = 'edit-diff-head';
    headOld.textContent = 'Current';
    var headNew = document.createElement('div');
    headNew.className = 'edit-diff-head';
    headNew.textContent = 'Proposed';
    wrap.appendChild(headField);
    wrap.appendChild(headOld);
    wrap.appendChild(headNew);
    var keys = Object.keys(proposed || {});
    keys.forEach(function (k) {
      var oldV = currentVals ? currentVals[k] : undefined;
      var newV = proposed[k];
      var f = document.createElement('div');
      f.textContent = fieldLabel(k);
      var o = document.createElement('div');
      o.className = 'edit-diff-old';
      o.textContent = formatChangeVal(oldV);
      var n = document.createElement('div');
      n.className = 'edit-diff-new';
      n.textContent = formatChangeVal(newV);
      if (formatChangeVal(oldV) !== formatChangeVal(newV)) n.parentNode; // mark below
      wrap.appendChild(f);
      wrap.appendChild(o);
      wrap.appendChild(n);
      if (formatChangeVal(oldV) !== formatChangeVal(newV)) {
        f.classList.add('edit-diff-changed');
        n.classList.add('edit-diff-changed');
      }
    });
    return wrap;
  }

  function renderEditRequests(rows) {
    var list = $('edits-list');
    list.innerHTML = '';
    $('edits-count').textContent = rows.length
      ? (rows.length + ' request' + (rows.length === 1 ? '' : 's'))
      : 'No requests';
    if (!rows.length) {
      $('edits-empty').hidden = false;
      return;
    }
    $('edits-empty').hidden = true;
    rows.forEach(function (r) {
      var card = document.createElement('article');
      card.className = 'member-card';
      card.style.marginBottom = '1rem';
      var head = document.createElement('div');
      head.className = 'edit-request-head';
      var title = document.createElement('h2');
      title.style.margin = '0';
      title.style.fontSize = '1.1rem';
      title.textContent = r.company_name || ('Request #' + r.id);
      var badge = document.createElement('span');
      badge.className = 'admin-badge ' + (r.status === 'pending' ? 'is-pending' : r.status === 'approved' ? 'is-active' : 'is-removed');
      badge.textContent = r.status || '—';
      head.appendChild(title);
      head.appendChild(badge);
      card.appendChild(head);
      var meta = document.createElement('p');
      meta.className = 'muted';
      meta.style.fontSize = '.9rem';
      meta.textContent = 'Submitted ' + fmtDate(r.created_at);
      card.appendChild(meta);
      card.appendChild(renderEditDiff(r.current_values || {}, r.proposed || {}));
      if (r.reject_reason) {
        var reason = document.createElement('p');
        reason.className = 'muted';
        reason.textContent = 'Reason: ' + r.reject_reason;
        card.appendChild(reason);
      }
      if (r.status === 'pending') {
        var actions = document.createElement('div');
        actions.className = 'admin-form-actions-primary';
        actions.style.marginTop = '.75rem';
        var approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'btn btn-primary';
        approve.textContent = 'Approve';
        approve.addEventListener('click', function () { approveEdit(r.id, approve); });
        var reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'btn admin-btn-danger';
        reject.textContent = 'Reject';
        reject.addEventListener('click', function () { openRejectModal(r.id); });
        actions.appendChild(approve);
        actions.appendChild(reject);
        card.appendChild(actions);
      }
      list.appendChild(card);
    });
  }

  async function loadEditRequests() {
    $('edits-loading').hidden = false;
    $('edits-empty').hidden = true;
    $('edits-error').hidden = true;
    $('edits-list').innerHTML = '';
    var status = $('edits-status') ? $('edits-status').value : 'pending';
    var args = {};
    if (status === 'all') args.p_status = null;
    else args.p_status = status;
    var res = await client.rpc(RPC.adminListEditRequests, args);
    $('edits-loading').hidden = true;
    if (res.error) {
      $('edits-error').hidden = false;
      $('edits-error-msg').textContent = friendlyError(res.error, 'Could not load edit requests.');
      return;
    }
    renderEditRequests(Array.isArray(res.data) ? res.data : []);
  }

  async function approveEdit(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
    showAlert($('edits-alert'), '', null);
    var res = await client.rpc(RPC.adminApproveEdit, { p_request_id: Number(id) });
    if (btn) { btn.disabled = false; btn.textContent = 'Approve'; }
    if (res.error) {
      showAlert($('edits-alert'), friendlyError(res.error, 'Could not approve this request.'), 'error');
      return;
    }
    showAlert($('edits-alert'), 'Edit approved and applied.', 'ok');
    await loadEditRequests();
  }

  function openRejectModal(id) {
    pendingRejectId = id;
    $('edits-reject-reason').value = '';
    $('edits-reject-modal').hidden = false;
    $('edits-reject-reason').focus();
  }
  function closeRejectModal() {
    pendingRejectId = null;
    $('edits-reject-modal').hidden = true;
  }

  async function confirmReject() {
    var id = pendingRejectId;
    var reason = ($('edits-reject-reason').value || '').trim();
    closeRejectModal();
    if (!id) return;
    var res = await client.rpc(RPC.adminRejectEdit, {
      p_request_id: Number(id),
      p_reason: reason || null
    });
    if (res.error) {
      showAlert($('edits-alert'), friendlyError(res.error, 'Could not reject this request.'), 'error');
      return;
    }
    showAlert($('edits-alert'), 'Edit rejected.', 'ok');
    await loadEditRequests();
  }

  async function initPendingEdits() {
    var gate = $('admin-gate');
    if (gate) gate.hidden = false;
    var auth = await requireAdmin();
    if (gate) gate.hidden = true;
    if (!auth) return;

    $('admin-signout-btn').addEventListener('click', signOut);
    $('edits-retry').addEventListener('click', loadEditRequests);
    $('edits-status').addEventListener('change', loadEditRequests);
    $('edits-reject-modal').querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeRejectModal);
    });
    $('edits-reject-confirm').addEventListener('click', confirmReject);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('edits-reject-modal').hidden) closeRejectModal();
    });
    await loadEditRequests();
  }

  if (page === 'members') initMembers();
  else if (page === 'admins') initAdmins();
  else if (page === 'pending-edits') initPendingEdits();
})();
