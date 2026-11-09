/* Partners Unlimited — Admin portal
   Auth + member CRUD against Supabase TEST. Database/RLS is the real gate.
   Do not log or print member personal data. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://vcugotjdsurpbntuxgcf.supabase.co'; // TEST project (staging)
  var SUPABASE_KEY = 'sb_publishable_uG8N8yNJLHLz3PhzbGNJQg_HT_It5r8'; // publishable key only
  var MEMBER_COLUMNS = [
    'id', 'continent', 'region', 'country', 'city', 'ports',
    'company_name', 'contact_person', 'website', 'description',
    'email', 'status', 'consent_at', 'membership_tier', 'renewal_date',
    'notes', 'created_at', 'updated_at'
  ].join(',');

  var page = document.body && document.body.getAttribute('data-admin-page');
  if (!page || typeof supabase === 'undefined' || !supabase.createClient) {
    return;
  }

  var client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'pu-admin-auth'
    }
  });

  /* ---------- tiny helpers (no PII logging) ---------- */
  function $(id) { return document.getElementById(id); }

  function showAlert(el, message, kind) {
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.className = 'admin-alert' + (kind ? ' is-' + kind : '');
  }

  function isRlsError(err) {
    if (!err) return false;
    var code = String(err.code || '');
    var msg = String(err.message || err.error_description || '').toLowerCase();
    return code === '42501' || code === 'PGRST301' || code === 'PGRST116' ||
      msg.indexOf('row-level security') !== -1 ||
      msg.indexOf('permission denied') !== -1 ||
      msg.indexOf('not authorized') !== -1 ||
      (msg.indexOf('jwt') !== -1 && msg.indexOf('denied') !== -1) ||
      msg.indexOf('policy') !== -1;
  }

  function friendlyError(err, fallback) {
    if (isRlsError(err)) {
      return 'You do not have permission to do that yet. Admin write policies may still be missing — ask the database owner to grant admin access.';
    }
    var msg = (err && (err.message || err.error_description)) || '';
    if (/invalid login|invalid credentials|email not confirmed/i.test(msg)) {
      return 'Sign-in failed. Check your email and password, or ask an admin to enable your account.';
    }
    return fallback || 'Something went wrong. Please try again.';
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

  function portsToText(ports) {
    if (Array.isArray(ports)) return ports.filter(Boolean).join(', ');
    if (typeof ports === 'string') return ports;
    return '';
  }

  function textToPorts(text) {
    return String(text || '')
      .split(',')
      .map(function (p) { return p.trim(); })
      .filter(Boolean);
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

  /* ---------- auth gate ---------- */
  async function getSession() {
    var res = await client.auth.getSession();
    return res && res.data ? res.data.session : null;
  }

  async function checkIsAdmin() {
    // Prefer SECURITY DEFINER helper if present
    try {
      var rpc = await client.rpc('is_admin');
      if (!rpc.error && typeof rpc.data === 'boolean') return rpc.data;
      if (!rpc.error && rpc.data != null) return !!rpc.data;
    } catch (e) { /* fall through */ }

    // Fallback: profiles.role = 'admin' for the signed-in user
    try {
      var userRes = await client.auth.getUser();
      var user = userRes && userRes.data && userRes.data.user;
      if (!user) return false;
      var q = await client.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (q.error) {
        // If profiles cannot be read, treat as not admin (DB still gates members)
        return false;
      }
      return q.data && String(q.data.role).toLowerCase() === 'admin';
    } catch (e) {
      return false;
    }
  }

  async function requireAdmin() {
    var session = await getSession();
    if (!session) {
      location.replace('index.html');
      return null;
    }
    var ok = await checkIsAdmin();
    if (!ok) {
      // Still allow the shell to show a denied state; DB will block data anyway
      return { session: session, isAdmin: false };
    }
    return { session: session, isAdmin: true };
  }

  async function signOut() {
    try { await client.auth.signOut(); } catch (e) { /* ignore */ }
    location.replace('index.html');
  }

  /* ---------- SIGN-IN PAGE ---------- */
  async function initSignIn() {
    var form = $('admin-signin-form');
    var alertEl = $('admin-alert');
    var btn = $('admin-signin-btn');
    if (!form) return;

    // Already signed in + admin → members
    try {
      var session = await getSession();
      if (session) {
        var ok = await checkIsAdmin();
        if (ok) {
          location.replace('members.html');
          return;
        }
        // Signed in but not admin: clear so they can try another account
        await client.auth.signOut();
        showAlert(alertEl, 'That account is not an admin. Sign in with an admin email.', 'error');
      }
    } catch (e) { /* stay on form */ }

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      showAlert(alertEl, '', null);
      var email = ($('admin-email').value || '').trim();
      var password = $('admin-password').value || '';
      if (!email || !password) {
        showAlert(alertEl, 'Enter your email and password.', 'error');
        return;
      }
      setBusy(btn, true, 'Signing in…');
      try {
        var res = await client.auth.signInWithPassword({ email: email, password: password });
        if (res.error) {
          showAlert(alertEl, friendlyError(res.error), 'error');
          setBusy(btn, false, 'Sign in');
          return;
        }
        var ok = await checkIsAdmin();
        if (!ok) {
          await client.auth.signOut();
          showAlert(alertEl, 'Signed in, but this account is not an admin.', 'error');
          setBusy(btn, false, 'Sign in');
          return;
        }
        location.replace('members.html');
      } catch (err) {
        showAlert(alertEl, friendlyError(err), 'error');
        setBusy(btn, false, 'Sign in');
      }
    });
  }

  /* ---------- MEMBERS PAGE ---------- */
  var membersCache = [];
  var currentMember = null; // in-memory edit buffer; never console.log it
  var listFilters = { search: '', status: '' };

  function syncApproveButton() {
    var approve = $('admin-approve-btn');
    var consent = $('m-consent');
    if (!approve) return;
    var hasConsent = !!(consent && consent.checked);
    approve.disabled = !hasConsent;
    approve.title = hasConsent
      ? 'Set status to active'
      : 'Tick “Member has agreed to be listed” before approving';
  }

  function readForm() {
    var consentChecked = $('m-consent').checked;
    var existingConsent = currentMember && currentMember.consent_at;
    var consentAt = null;
    if (consentChecked) {
      consentAt = existingConsent || new Date().toISOString();
    } else {
      consentAt = null;
    }
    return {
      company_name: ($('m-company').value || '').trim(),
      contact_person: ($('m-contact').value || '').trim() || null,
      continent: $('m-continent').value || null,
      region: ($('m-region').value || '').trim() || null,
      country: ($('m-country').value || '').trim(),
      city: ($('m-city').value || '').trim() || null,
      ports: textToPorts($('m-ports').value),
      website: ($('m-website').value || '').trim() || null,
      description: ($('m-description').value || '').trim() || null,
      email: ($('m-email').value || '').trim() || null,
      membership_tier: ($('m-tier').value || '').trim() || null,
      renewal_date: $('m-renewal').value || null,
      status: $('m-status').value || 'pending',
      consent_at: consentAt,
      notes: ($('m-notes').value || '').trim() || null
    };
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
    $('m-email').value = (m && m.email) || '';
    $('m-tier').value = (m && m.membership_tier) || '';
    $('m-renewal').value = toDateInput(m && m.renewal_date);
    $('m-status').value = (m && m.status) || 'pending';
    $('m-consent').checked = !!(m && m.consent_at);
    $('m-notes').value = (m && m.notes) || '';
    $('m-created').textContent = m && m.created_at ? fmtDate(m.created_at) : '—';
    $('m-updated').textContent = m && m.updated_at ? fmtDate(m.updated_at) : '—';

    var hideBtn = $('admin-hide-btn');
    var removeBtn = $('admin-remove-btn');
    if (isNew) {
      hideBtn.hidden = true;
      removeBtn.hidden = true;
      $('admin-approve-btn').hidden = false;
    } else {
      hideBtn.hidden = false;
      removeBtn.hidden = false;
      hideBtn.disabled = false;
      // Hide = status back to pending (product decision)
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
      $('admin-approve-btn').hidden = false;
    }
    syncApproveButton();
    showAlert($('admin-detail-alert'), '', null);
  }

  function showView(name) {
    var list = $('admin-list-view');
    var detail = $('admin-detail-view');
    if (list) list.hidden = name !== 'list';
    if (detail) detail.hidden = name !== 'detail';
  }

  function setListState(which) {
    $('admin-list-loading').hidden = which !== 'loading';
    $('admin-list-empty').hidden = which !== 'empty';
    $('admin-list-error').hidden = which !== 'error';
    var showRows = which === 'grid';
    var isNarrow = window.matchMedia('(max-width: 900px)').matches;
    $('admin-table-wrap').hidden = !(showRows && !isNarrow);
    $('admin-cards').hidden = !(showRows && isNarrow);
    // Keep both populated; CSS also toggles, but hidden attrs keep a11y clean
    if (showRows) {
      if (isNarrow) {
        $('admin-cards').hidden = false;
        $('admin-table-wrap').hidden = true;
      } else {
        $('admin-table-wrap').hidden = false;
        $('admin-cards').hidden = true;
      }
    }
  }

  function filteredMembers() {
    var q = (listFilters.search || '').trim().toLowerCase();
    var st = listFilters.status || '';
    return membersCache.filter(function (m) {
      if (st && m.status !== st) return false;
      if (!q) return true;
      var hay = [
        m.company_name, m.contact_person, m.country, m.city, m.region, m.continent,
        m.email, m.membership_tier
      ].map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
      return hay.indexOf(q) !== -1;
    });
  }

  function openMember(id) {
    var m = membersCache.find(function (row) { return String(row.id) === String(id); });
    if (!m) {
      showAlert($('admin-alert'), 'Member not found in the current list.', 'error');
      return;
    }
    fillForm(m, false);
    showView('detail');
    if (history.replaceState) {
      history.replaceState(null, '', 'members.html?id=' + encodeURIComponent(id));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openNew() {
    fillForm({
      status: 'pending',
      consent_at: null,
      ports: []
    }, true);
    showView('detail');
    if (history.replaceState) history.replaceState(null, '', 'members.html?new=1');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToList(preserveFilters) {
    showView('list');
    if (history.replaceState) {
      var p = new URLSearchParams();
      if (preserveFilters !== false) {
        if (listFilters.search) p.set('q', listFilters.search);
        if (listFilters.status) p.set('status', listFilters.status);
      }
      var qs = p.toString();
      history.replaceState(null, '', 'members.html' + (qs ? '?' + qs : ''));
    }
  }

  function renderList() {
    var rows = filteredMembers();
    var tbody = $('admin-table-body');
    var cards = $('admin-cards');
    tbody.innerHTML = '';
    cards.innerHTML = '';

    var anyFilter = !!(listFilters.search || listFilters.status);
    $('f-reset').disabled = !anyFilter;
    $('admin-count').textContent = membersCache.length
      ? ('Showing ' + rows.length + ' of ' + membersCache.length + ' member' + (membersCache.length === 1 ? '' : 's'))
      : 'No members loaded';

    if (!rows.length) {
      setListState(membersCache.length ? 'empty' : 'empty');
      return;
    }

    rows.forEach(function (m) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('data-id', m.id);
      tr.innerHTML =
        '<td class="company"></td>' +
        '<td class="loc"></td>' +
        '<td class="st"></td>' +
        '<td class="tier"></td>' +
        '<td class="ren"></td>' +
        '<td class="upd"></td>';
      tr.querySelector('.company').textContent = m.company_name || '—';
      tr.querySelector('.loc').textContent = [m.city, m.country].filter(Boolean).join(', ') || '—';
      tr.querySelector('.st').appendChild(statusBadge(m.status));
      tr.querySelector('.tier').textContent = m.membership_tier || '—';
      tr.querySelector('.ren').textContent = fmtDate(m.renewal_date);
      tr.querySelector('.upd').textContent = fmtDate(m.updated_at);
      tr.addEventListener('click', function () { openMember(m.id); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMember(m.id); }
      });
      tbody.appendChild(tr);

      var li = document.createElement('li');
      li.className = 'admin-card';
      li.setAttribute('data-id', m.id);
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
      if (m.membership_tier) {
        var tier = document.createElement('div');
        tier.textContent = 'Tier: ' + m.membership_tier;
        meta.appendChild(tier);
      }
      var upd = document.createElement('div');
      upd.textContent = 'Updated ' + fmtDate(m.updated_at);
      meta.appendChild(upd);
      li.appendChild(meta);
      li.addEventListener('click', function () { openMember(m.id); });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMember(m.id); }
      });
      cards.appendChild(li);
    });

    setListState('grid');
  }

  async function loadMembers() {
    setListState('loading');
    $('admin-count').textContent = 'Loading…';
    showAlert($('admin-alert'), '', null);

    var res = await client
      .from('members')
      .select(MEMBER_COLUMNS)
      .order('company_name', { ascending: true });

    if (res.error) {
      membersCache = [];
      $('admin-list-error-msg').textContent = friendlyError(
        res.error,
        'Could not read members. Private columns need admin SELECT policies.'
      );
      setListState('error');
      $('admin-count').textContent = '';
      return;
    }

    membersCache = Array.isArray(res.data) ? res.data : [];
    renderList();
  }

  async function saveMember(extra) {
    var alertEl = $('admin-detail-alert');
    showAlert(alertEl, '', null);
    var payload = readForm();
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
    }

    if (!payload.company_name || !payload.continent || !payload.country) {
      showAlert(alertEl, 'Company name, continent and country are required.', 'error');
      return false;
    }
    if (payload.status === 'active' && !payload.consent_at) {
      showAlert(alertEl, 'Cannot set status to active without consent. Tick the consent box first.', 'error');
      $('m-status').value = (currentMember && currentMember.status) || 'pending';
      return false;
    }

    var id = ($('m-id').value || '').trim();
    var saveBtn = $('admin-save-btn');
    setBusy(saveBtn, true, 'Saving…');

    try {
      var res;
      if (id) {
        res = await client.from('members').update(payload).eq('id', id).select(MEMBER_COLUMNS).maybeSingle();
      } else {
        if (!payload.status) payload.status = 'pending';
        res = await client.from('members').insert(payload).select(MEMBER_COLUMNS).maybeSingle();
      }

      if (res.error) {
        showAlert(alertEl, friendlyError(res.error, 'Could not save member.'), 'error');
        setBusy(saveBtn, false, 'Save');
        return false;
      }

      var saved = res.data;
      if (saved) {
        // Refresh cache entry without dumping fields to console
        var idx = membersCache.findIndex(function (r) { return String(r.id) === String(saved.id); });
        if (idx >= 0) membersCache[idx] = saved;
        else membersCache.push(saved);
        membersCache.sort(function (a, b) {
          return String(a.company_name || '').localeCompare(String(b.company_name || ''));
        });
        fillForm(saved, false);
        showAlert(alertEl, 'Saved.', 'ok');
        if (history.replaceState) {
          history.replaceState(null, '', 'members.html?id=' + encodeURIComponent(saved.id));
        }
      } else {
        // Update succeeded but select blocked — reload list
        showAlert(alertEl, 'Saved (reload list to refresh).', 'ok');
        await loadMembers();
      }
      setBusy(saveBtn, false, 'Save');
      return true;
    } catch (err) {
      showAlert(alertEl, friendlyError(err, 'Could not save member.'), 'error');
      setBusy(saveBtn, false, 'Save');
      return false;
    }
  }

  function openModal() {
    var modal = $('admin-modal');
    modal.hidden = false;
    $('admin-modal-confirm').focus();
  }
  function closeModal() {
    $('admin-modal').hidden = true;
  }

  async function initMembers() {
    var gate = $('admin-gate');
    var denied = $('admin-denied');
    gate.hidden = false;

    var auth = await requireAdmin();
    gate.hidden = true;
    if (!auth) return; // redirected

    if (!auth.isAdmin) {
      denied.hidden = false;
      $('admin-denied-signout').addEventListener('click', signOut);
      // Still wire sign-out in header if present
      var so = $('admin-signout-btn');
      if (so) so.addEventListener('click', signOut);
      return;
    }

    denied.hidden = true;
    showView('list');

    // Wire chrome
    $('admin-signout-btn').addEventListener('click', signOut);
    $('admin-add-btn').addEventListener('click', openNew);
    $('admin-back-btn').addEventListener('click', function () {
      backToList(true);
      renderList();
    });
    $('admin-list-retry').addEventListener('click', loadMembers);
    $('admin-empty-reset').addEventListener('click', function () {
      listFilters.search = '';
      listFilters.status = '';
      $('f-search').value = '';
      $('f-status').value = '';
      renderList();
    });

    $('f-search').addEventListener('input', function () {
      listFilters.search = $('f-search').value;
      renderList();
    });
    $('f-status').addEventListener('change', function () {
      listFilters.status = $('f-status').value;
      renderList();
    });
    $('f-reset').addEventListener('click', function () {
      listFilters.search = '';
      listFilters.status = '';
      $('f-search').value = '';
      $('f-status').value = '';
      renderList();
    });

    $('m-consent').addEventListener('change', function () {
      syncApproveButton();
      // If user picks active in status select without consent, keep approve disabled
    });
    $('m-status').addEventListener('change', function () {
      if ($('m-status').value === 'active' && !$('m-consent').checked) {
        showAlert($('admin-detail-alert'), 'Consent is required for Active. Tick the consent box, or use Approve.', 'info');
      }
    });

    $('admin-member-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      await saveMember();
    });

    $('admin-approve-btn').addEventListener('click', async function () {
      if (!$('m-consent').checked) {
        showAlert($('admin-detail-alert'), 'Tick “Member has agreed to be listed” before approving.', 'error');
        return;
      }
      // Ensure consent_at is set now if newly checked
      var ok = await saveMember({ status: 'active' });
      if (ok) {
        $('m-status').value = 'active';
        showAlert($('admin-detail-alert'), 'Member approved (status = active).', 'ok');
      }
    });

    $('admin-hide-btn').addEventListener('click', async function () {
      // Hide = set status back to pending (product decision)
      $('m-status').value = 'pending';
      var ok = await saveMember({ status: 'pending' });
      if (ok) showAlert($('admin-detail-alert'), 'Hidden from directory (status = pending).', 'ok');
    });

    $('admin-remove-btn').addEventListener('click', openModal);
    $('admin-modal').querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    $('admin-modal-confirm').addEventListener('click', async function () {
      closeModal();
      $('m-status').value = 'removed';
      var ok = await saveMember({ status: 'removed' });
      if (ok) showAlert($('admin-detail-alert'), 'Member removed (soft delete; status = removed).', 'ok');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('admin-modal').hidden) closeModal();
    });

    window.addEventListener('resize', function () {
      if (!$('admin-list-view').hidden && membersCache.length) renderList();
    });

    // Restore filters / deep link from URL
    var params = new URLSearchParams(location.search);
    if (params.get('q')) {
      listFilters.search = params.get('q');
      $('f-search').value = listFilters.search;
    }
    if (params.get('status')) {
      listFilters.status = params.get('status');
      $('f-status').value = listFilters.status;
    }

    await loadMembers();

    if (params.get('new') === '1') {
      openNew();
    } else if (params.get('id')) {
      openMember(params.get('id'));
    }
  }

  /* ---------- boot ---------- */
  if (page === 'signin') initSignIn();
  else if (page === 'members') initMembers();
})();
