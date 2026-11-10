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
      p_notes: form.notes == null ? '' : form.notes
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
      membership_tier: ($('m-tier').value || '').trim(),
      renewal_date: $('m-renewal').value || '',
      status: $('m-status').value || 'pending',
      notes: ($('m-notes').value || '').trim()
    };
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
  var listFilters = { search: '', status: '' };

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
    $('m-renewal').value = toDateInput(m && m.renewal_date);
    $('m-status').value = (m && m.status) || 'pending';
    $('m-notes').value = (m && m.notes) || '';
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
    showAlert($('admin-detail-alert'), '', null);
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
        m.email, emailList, m.membership_tier
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

    var emailsCheck = readValidatedEmails();
    if (!emailsCheck.ok) {
      showAlert(alertEl, emailsCheck.error, 'error');
      return false;
    }
    form.email = window.MemberEmails ? MemberEmails.firstMainEmail(emailsCheck.emails) : (form.email || '');

    var id = ($('m-id').value || '').trim();
    var args = buildMemberArgs(form);
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
        showAlert(alertEl, emailErr ? ('Member saved, but the email list could not be updated. ' + emailErr) : 'Saved.', emailErr ? 'error' : 'ok');
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
    if (window.MemberEmails) MemberEmails.bind($('m-emails'));
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
    $('admin-member-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      await saveMember();
    });

    $('admin-approve-btn').addEventListener('click', async function () {
      var alertEl = $('admin-detail-alert');
      var id = ($('m-id').value || '').trim();
      if (!id) {
        var ok = await saveMember({ status: 'active' });
        if (ok) showAlert(alertEl, 'Member approved (status = active).', 'ok');
        return;
      }
      setBusy($('admin-approve-btn'), true, 'Approving…');
      var args = { p_member_id: Number(id), p_status: 'active' };
      var res = await client.rpc(RPC.adminUpdateMember, args);
      setBusy($('admin-approve-btn'), false, 'Approve');
      if (res.error) {
        showAlert(alertEl, friendlyError(res.error, 'Could not approve member.'), 'error');
        return;
      }
      var row = res.data;
      if (Array.isArray(row)) row = row[0];
      if (row) { upsertCache(row); fillForm(row, false); }
      showAlert(alertEl, 'Member approved (status = active).', 'ok');
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
      f.textContent = k.replace(/_/g, ' ');
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
