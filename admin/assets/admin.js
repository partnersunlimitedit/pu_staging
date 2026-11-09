/* Partners Unlimited — Admin portal
   Auth + member CRUD against Supabase TEST. Database/RLS is the real gate.
   Do not log or print member personal data. */
(function () {
  'use strict';

  var page = document.body && document.body.getAttribute('data-admin-page');
  if (!page || page === 'signin') {
    // admin/index.html redirects to member-area; no local sign-in UI anymore
    return;
  }
  if (!window.PUAuth || typeof supabase === 'undefined') return;

  var client = PUAuth.createClient();
  var SIGN_IN = PUAuth.urlFor('signIn');
  var MEMBER_HOME = PUAuth.urlFor('memberHome');

  /* Columns for admin member reads.
     TODO(PU Data): contact_person is becoming private — public directory must not
     select it. Admin reads should eventually go through confirmed admin RPCs
     (see PUAuth.CONFIG.rpc). Until then, keep the direct select in fetchMembersForAdmin(). */
  var MEMBER_COLUMNS = [
    'id', 'continent', 'region', 'country', 'city', 'ports',
    'company_name', 'contact_person', 'website', 'description',
    'email', 'status', 'consent_at', 'membership_tier', 'renewal_date',
    'notes', 'created_at', 'updated_at'
  ].join(',');

  /* ---------- tiny helpers (no PII logging) ---------- */
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
  async function requireAdmin() {
    var session = await PUAuth.getSession(client);
    if (!session) {
      location.replace(SIGN_IN);
      return null;
    }
    var ok = await PUAuth.checkIsAdmin(client);
    if (!ok) {
      // Authenticated non-admin → member portal (single routing rule)
      location.replace(MEMBER_HOME);
      return null;
    }
    return { session: session, isAdmin: true };
  }

  function signOut() {
    return PUAuth.signOut(client);
  }

  /**
   * Single place for admin member reads (list).
   * TODO(PU Data): replace this direct .from('members').select(...) with the
   * confirmed admin RPC once available (wire the name in PUAuth.CONFIG.rpc).
   * contact_person is becoming private — do not reuse this select on public pages.
   */
  async function fetchMembersForAdmin() {
    // Future: var rpcName = PUAuth.CONFIG.rpc.adminListMembers; if (rpcName) ...
    return client
      .from(PUAuth.CONFIG.tables.members)
      .select(MEMBER_COLUMNS)
      .order('company_name', { ascending: true });
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

    var res = await fetchMembersForAdmin();

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
        res = await client.from(PUAuth.CONFIG.tables.members).update(payload).eq('id', id).select(MEMBER_COLUMNS).maybeSingle();
      } else {
        if (!payload.status) payload.status = 'pending';
        res = await client.from(PUAuth.CONFIG.tables.members).insert(payload).select(MEMBER_COLUMNS).maybeSingle();
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
  if (page === 'members') initMembers();
})();
