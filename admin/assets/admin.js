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

  function portsToText(ports) {
    if (Array.isArray(ports)) return ports.filter(Boolean).join(', ');
    if (typeof ports === 'string') return ports;
    return '';
  }

  function textToPorts(text) {
    return String(text || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
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
    membersCache.sort(function (a, b) {
      return String(a.company_name || '').localeCompare(String(b.company_name || ''));
    });
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
    return { session: session, isAdmin: true };
  }

  function signOut() { return PUAuth.signOut(client); }

  /* ---------- member RPCs (single place for admin data access) ---------- */
  async function fetchMembersForAdmin() {
    // TODO was: direct from('members') — private cols need RPCs. Do not use from() here.
    return client.rpc(RPC.adminListMembers);
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
      p_notes: form.notes == null ? '' : form.notes,
      p_set_consent_now: !!opts.setConsentNow
    };
    if (form.renewal_date) args.p_renewal_date = form.renewal_date;
    else if (opts.includeNullRenewal) args.p_renewal_date = null;
    return args;
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
      email: ($('m-email').value || '').trim(),
      membership_tier: ($('m-tier').value || '').trim(),
      renewal_date: $('m-renewal').value || '',
      status: $('m-status').value || 'pending',
      notes: ($('m-notes').value || '').trim(),
      consentChecked: !!($('m-consent') && $('m-consent').checked)
    };
  }

  /* ---------- MEMBERS PAGE ---------- */
  var membersCache = [];
  var currentMember = null;
  var listFilters = { search: '', status: '' };

  function syncApproveButton() {
    var approve = $('admin-approve-btn');
    var consent = $('m-consent');
    if (!approve) return;
    var hasConsent = !!(consent && consent.checked);
    // Approve uses admin_set_consent(..., true) which can stamp consent — allow when checked OR already has consent_at
    approve.disabled = !hasConsent;
    approve.title = hasConsent
      ? 'Record consent (if needed) and set status to active'
      : 'Tick “Member has agreed to be listed” before approving';
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
    showAlert($('admin-detail-alert'), '', null);
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
      var hay = [
        m.company_name, m.contact_person, m.country, m.city, m.region, m.continent,
        m.email, m.membership_tier
      ].map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
      return hay.indexOf(q) !== -1;
    });
  }

  async function openMember(id) {
    showView('detail');
    showAlert($('admin-detail-alert'), 'Loading…', 'info');
    var res = await fetchMemberById(id);
    if (res.error) {
      showAlert($('admin-detail-alert'), friendlyError(res.error, 'Could not load member.'), 'error');
      var cached = membersCache.find(function (row) { return String(row.id) === String(id); });
      if (cached) fillForm(cached, false);
      return;
    }
    var row = res.data;
    if (Array.isArray(row)) row = row[0];
    if (!row) {
      showAlert($('admin-detail-alert'), 'Member not found.', 'error');
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
    fillForm({ status: 'pending', consent_at: null, ports: [] }, true);
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
      tr.querySelector('.ren').textContent = fmtDate(m.renewal_date);
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
    showAlert(alertEl, '', null);
    var form = readForm();
    if (extra && extra.status) form.status = extra.status;

    if (!form.company_name || !form.continent || !form.country) {
      showAlert(alertEl, 'Company name, continent and country are required.', 'error');
      return false;
    }

    var id = ($('m-id').value || '').trim();
    var hadConsent = !!(currentMember && currentMember.consent_at);
    var setConsentNow = !!(form.consentChecked && !hadConsent) || !!(extra && extra.setConsentNow);
    // If unchecking consent on update: leave consent_at as-is (RPC can't clear via null); UI note only
    var args = buildMemberArgs(form, { setConsentNow: setConsentNow });
    var saveBtn = $('admin-save-btn');
    setBusy(saveBtn, true, 'Saving…');

    try {
      var res;
      if (id) {
        args.p_member_id = Number(id);
        res = await client.rpc(RPC.adminUpdateMember, args);
      } else {
        res = await client.rpc(RPC.adminInsertMember, args);
      }
      if (res.error) {
        showAlert(alertEl, friendlyError(res.error, 'Could not save member.'), 'error');
        setBusy(saveBtn, false, 'Save');
        return false;
      }
      var saved = res.data;
      if (Array.isArray(saved)) saved = saved[0];
      if (saved) {
        upsertCache(saved);
        fillForm(saved, false);
        showAlert(alertEl, 'Saved.', 'ok');
        if (history.replaceState) {
          history.replaceState(null, '', 'members.html?id=' + encodeURIComponent(saved.id));
        }
      } else {
        showAlert(alertEl, 'Saved.', 'ok');
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

  function openModal() { $('admin-modal').hidden = false; $('admin-modal-confirm').focus(); }
  function closeModal() { $('admin-modal').hidden = true; }

  async function initMembers() {
    var gate = $('admin-gate');
    gate.hidden = false;
    var auth = await requireAdmin();
    gate.hidden = true;
    if (!auth) return;

    $('admin-denied').hidden = true;
    showView('list');

    $('admin-signout-btn').addEventListener('click', signOut);
    $('admin-add-btn').addEventListener('click', openNew);
    $('admin-back-btn').addEventListener('click', function () { backToList(true); renderList(); });
    $('admin-list-retry').addEventListener('click', loadMembers);
    $('admin-empty-reset').addEventListener('click', function () {
      listFilters.search = ''; listFilters.status = '';
      $('f-search').value = ''; $('f-status').value = '';
      renderList();
    });
    $('f-search').addEventListener('input', function () { listFilters.search = $('f-search').value; renderList(); });
    $('f-status').addEventListener('change', function () { listFilters.status = $('f-status').value; renderList(); });
    $('f-reset').addEventListener('click', function () {
      listFilters.search = ''; listFilters.status = '';
      $('f-search').value = ''; $('f-status').value = '';
      renderList();
    });
    $('m-consent').addEventListener('change', syncApproveButton);

    $('admin-member-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      await saveMember();
    });

    $('admin-approve-btn').addEventListener('click', async function () {
      var alertEl = $('admin-detail-alert');
      if (!$('m-consent').checked) {
        showAlert(alertEl, 'Tick “Member has agreed to be listed” before approving.', 'error');
        return;
      }
      var id = ($('m-id').value || '').trim();
      if (!id) {
        // New row: save as active with consent
        var ok = await saveMember({ status: 'active', setConsentNow: true });
        if (ok) showAlert(alertEl, 'Member approved (status = active).', 'ok');
        return;
      }
      setBusy($('admin-approve-btn'), true, 'Approving…');
      var res = await client.rpc(RPC.adminSetConsent, {
        p_member_id: Number(id),
        p_activate: true
      });
      setBusy($('admin-approve-btn'), false, 'Approve');
      if (res.error) {
        showAlert(alertEl, friendlyError(res.error, 'Could not approve member.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showAlert(alertEl, 'Member approved (consent recorded, status = active).', 'ok');
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
        showAlert(alertEl, friendlyError(res.error, 'Could not hide member.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showAlert(alertEl, 'Hidden from directory (status = pending).', 'ok');
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
        showAlert(alertEl, friendlyError(res.error, 'Could not remove member.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showAlert(alertEl, 'Member removed (soft delete; status = removed).', 'ok');
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

    await loadMembers();
    if (params.get('new') === '1') openNew();
    else if (params.get('id')) await openMember(params.get('id'));
  }

  /* ---------- ADMINS PAGE ---------- */
  var usersCache = [];
  var pendingRoleChange = null;

  async function loadUsers() {
    var loading = $('admins-loading');
    var errEl = $('admins-error');
    var empty = $('admins-empty');
    var wrap = $('admins-table-wrap');
    if (loading) loading.hidden = false;
    if (errEl) errEl.hidden = true;
    if (empty) empty.hidden = true;
    if (wrap) wrap.hidden = true;

    var res = await client.rpc(RPC.adminListUsers);
    if (loading) loading.hidden = true;
    if (res.error) {
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

    if (!usersCache.length) {
      if (empty) empty.hidden = false;
      if (wrap) wrap.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (wrap) wrap.hidden = false;

    var isNarrow = window.matchMedia('(max-width: 900px)').matches;
    if (isNarrow && cards) {
      wrap.hidden = true;
      cards.hidden = false;
    } else if (cards) {
      cards.hidden = true;
    }

    usersCache.forEach(function (u) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="em"></td><td class="nm"></td><td class="rl"></td><td class="cr"></td><td class="ac"></td>';
      tr.querySelector('.em').textContent = u.email || '—';
      tr.querySelector('.nm').textContent = u.full_name || '—';
      var badge = document.createElement('span');
      badge.className = 'admin-badge ' + (u.role === 'admin' ? 'is-active' : 'is-pending');
      badge.textContent = u.role || 'member';
      tr.querySelector('.rl').appendChild(badge);
      tr.querySelector('.cr').textContent = fmtDate(u.created_at);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = u.role === 'admin' ? 'btn admin-btn-danger' : 'btn btn-outline';
      btn.style.padding = '.45rem 1rem';
      btn.style.fontSize = '.85rem';
      btn.textContent = u.role === 'admin' ? 'Revoke admin' : 'Grant admin';
      btn.addEventListener('click', function () {
        openRoleModal(u, u.role !== 'admin');
      });
      tr.querySelector('.ac').appendChild(btn);
      tbody.appendChild(tr);
    });

    $('admins-count').textContent = usersCache.length + ' user' + (usersCache.length === 1 ? '' : 's');
  }

  function openRoleModal(user, makeAdmin) {
    pendingRoleChange = { user: user, makeAdmin: makeAdmin };
    $('admins-modal-title').textContent = makeAdmin ? 'Grant admin?' : 'Revoke admin?';
    // Avoid dumping email into long-lived strings in logs; show in UI only
    $('admins-modal-body').textContent = makeAdmin
      ? 'Grant admin access to this user? They must already have a login.'
      : 'Revoke admin access for this user? The last remaining admin cannot be demoted.';
    $('admins-modal').hidden = false;
  }

  function closeRoleModal() {
    pendingRoleChange = null;
    $('admins-modal').hidden = true;
  }

  async function confirmRoleChange() {
    if (!pendingRoleChange) return;
    var u = pendingRoleChange.user;
    var makeAdmin = pendingRoleChange.makeAdmin;
    closeRoleModal();
    showAlert($('admins-alert'), '', null);
    var res = await client.rpc(RPC.adminSetAdmin, {
      p_user_id: u.id,
      p_is_admin: makeAdmin
    });
    if (res.error) {
      showAlert($('admins-alert'), friendlyError(res.error, 'Could not update admin role.'), 'error');
      return;
    }
    showAlert($('admins-alert'), makeAdmin ? 'Admin access granted.' : 'Admin access revoked.', 'ok');
    await loadUsers();
  }

  async function initAdmins() {
    var gate = $('admin-gate');
    if (gate) gate.hidden = false;
    var auth = await requireAdmin();
    if (gate) gate.hidden = true;
    if (!auth) return;

    $('admin-signout-btn').addEventListener('click', signOut);
    $('admins-retry').addEventListener('click', loadUsers);
    $('admins-modal').querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeRoleModal);
    });
    $('admins-modal-confirm').addEventListener('click', confirmRoleChange);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('admins-modal').hidden) closeRoleModal();
    });
    window.addEventListener('resize', function () {
      if (usersCache.length) renderUsers();
    });

    await loadUsers();
  }

  if (page === 'members') initMembers();
  else if (page === 'admins') initAdmins();
})();
