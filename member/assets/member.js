/* Member portal home — profile, membership, owner edits, change password. */
(function () {
  'use strict';
  if (!document.body || document.body.getAttribute('data-pu-page') !== 'member-home') return;
  if (!window.PUAuth) return;

  var client = PUAuth.createClient();
  var RPC = PUAuth.CONFIG.rpc;
  var membership = null;
  var company = null;

  function $(id) { return document.getElementById(id); }

  function showAlert(elOrId, message, kind) {
    var el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.className = 'portal-alert' + (kind ? ' is-' + kind : '');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return '—'; }
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value == null || value === '' ? '—' : String(value);
  }

  function firstRow(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data[0] || null;
    return data;
  }

  function portsToText(ports) {
    if (Array.isArray(ports)) return ports.filter(Boolean).join(', ');
    return ports || '';
  }

  function textToPorts(text) {
    return String(text || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  }

  function val(id) { return ($(id) && $(id).value) || ''; }


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


  function fillProfile(row, mem) {
    var companyName = (row && row.company_name) || (mem && mem.company_name) || '';
    if (companyName) {
      $('member-title').textContent = companyName;
      $('member-welcome').textContent = (mem && mem.my_role)
        ? ('Signed in as ' + mem.my_role)
        : 'Your membership overview';
    }
    setText('mp-company', companyName);
    setText('mp-contact', row && row.contact_person);
    var emailEl = $('mp-email');
    if (emailEl) {
      var emailRows = window.MemberEmails
        ? MemberEmails.rowsFromMember(row || {})
        : ((row && row.email) ? [{ label: 'main', email: row.email }] : []);
      emailEl.textContent = emailRows.length
        ? (window.MemberEmails ? MemberEmails.formatList(emailRows) : emailRows[0].email)
        : '—';
    }
    setText('mp-location', row ? [row.city, row.country, row.continent].filter(Boolean).join(', ') : '');
    setText('mp-ports', row ? portsToText(row.ports) : '');
    var web = $('mp-website');
    if (web) {
      web.textContent = '';
      if (row && row.website) {
        var a = document.createElement('a');
        a.href = /^https?:\/\//i.test(row.website) ? row.website : ('https://' + row.website);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = row.website;
        web.appendChild(a);
      } else {
        web.textContent = '—';
      }
    }
    setText('mp-description', row && row.description);
    BOOKLET_FIELDS.forEach(function (key) {
      setText('mp-' + key.replace(/_/g, '-'), row && row[key]);
    });

    setText('mp-role', mem && mem.my_role);
    var st = $('mp-status');
    if (st) {
      st.textContent = '';
      var status = (mem && mem.member_status) || (row && row.status);
      if (status) {
        var badge = document.createElement('span');
        badge.className = 'member-badge is-' + status;
        badge.textContent = status;
        st.appendChild(badge);
      } else {
        st.textContent = '—';
      }
    }
    var listed = mem && typeof mem.listed_in_directory === 'boolean'
      ? (mem.listed_in_directory ? 'Yes, in the public directory' : 'Not listed')
      : '—';
    setText('mp-listed', listed);
    setText('mp-tier', (mem && mem.membership_tier) || (row && row.membership_tier));
    var renewal = (mem && mem.renewal_date) || (row && row.renewal_date);
    setText('mp-renewal', renewal ? fmtDate(renewal) : '—');
  }

  function fillEditForm(row) {
    if (!row) return;
    $('e-company').value = row.company_name || '';
    $('e-contact').value = row.contact_person || '';
    if (window.MemberEmails) {
      MemberEmails.bind($('e-emails'));
      MemberEmails.renderList($('e-emails'), MemberEmails.rowsFromMember(row), { blankIfEmpty: true });
    }
    $('e-website').value = row.website || '';
    $('e-continent').value = row.continent || '';
    $('e-region').value = row.region || '';
    $('e-country').value = row.country || '';
    $('e-city').value = row.city || '';
    $('e-ports').value = portsToText(row.ports);
    $('e-description').value = row.description || '';
    BOOKLET_FIELDS.forEach(function (key) {
      var el = $(bookletInputId(key, 'e-'));
      if (el) el.value = row[key] || '';
    });
  }

  function collectChanges() {
    if (!company) return {};
    var fields = {
      company_name: val('e-company').trim(),
      contact_person: val('e-contact').trim(),
      website: val('e-website').trim(),
      continent: val('e-continent'),
      region: val('e-region').trim(),
      country: val('e-country').trim(),
      city: val('e-city').trim(),
      description: val('e-description').trim()
    };
    var changes = {};
    Object.keys(fields).forEach(function (k) {
      var oldVal = company[k] == null ? '' : String(company[k]);
      if (fields[k] !== oldVal) changes[k] = fields[k];
    });
    var booklet = {};
    BOOKLET_FIELDS.forEach(function (key) {
      var el = $(bookletInputId(key, 'e-'));
      booklet[key] = el ? normalizeBookletValue(key, el.value) : '';
    });
    var bookletCheck = validateBookletFields(booklet);
    if (!bookletCheck.ok) {
      changes.__bookletError = bookletCheck.error;
      return changes;
    }
    BOOKLET_FIELDS.forEach(function (key) {
      var oldVal = normalizeBookletValue(key, company[key]);
      if (booklet[key] !== oldVal) changes[key] = booklet[key];
    });
    var newPorts = textToPorts(val('e-ports'));
    var oldPorts = Array.isArray(company.ports) ? company.ports.filter(Boolean) : [];
    if (newPorts.join('\u0001') !== oldPorts.join('\u0001')) changes.ports = newPorts;
    if (window.MemberEmails) {
      var collected = MemberEmails.validate(MemberEmails.collectFrom($('e-emails')));
      if (!collected.ok) {
        changes.__emailsError = collected.error;
        return changes;
      }
      var currentEmails = MemberEmails.rowsFromMember(company);
      if (!MemberEmails.listsEqual(currentEmails, collected.emails)) {
        changes.emails = collected.emails;
      }
    }
    return changes;
  }

  function requestStatusClass(status) {
    if (status === 'approved') return 'is-active';
    if (status === 'pending') return 'is-pending';
    return 'is-removed';
  }

  function formatChangeVal(v) {
    if (window.MemberEmails && typeof MemberEmails.formatChangeVal === 'function') {
      return MemberEmails.formatChangeVal(v);
    }
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.join(', ') || '—';
    return String(v);
  }

  function renderRequests(rows) {
    var list = $('requests-list');
    var empty = $('requests-empty');
    list.innerHTML = '';
    if (!rows || !rows.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    rows.forEach(function (r) {
      var card = document.createElement('article');
      card.className = 'edit-request';
      var head = document.createElement('div');
      head.className = 'edit-request-head';
      var badge = document.createElement('span');
      badge.className = 'member-badge ' + requestStatusClass(r.status);
      badge.textContent = r.status || '—';
      var when = document.createElement('span');
      when.className = 'muted';
      when.textContent = 'Submitted ' + fmtDate(r.created_at);
      head.appendChild(badge);
      head.appendChild(when);
      card.appendChild(head);

      var dl = document.createElement('dl');
      dl.className = 'member-dl';
      var proposed = r.proposed || {};
      Object.keys(proposed).forEach(function (k) {
        var row = document.createElement('div');
        var dt = document.createElement('dt');
        dt.textContent = fieldLabel(k);
        var dd = document.createElement('dd');
        dd.textContent = formatChangeVal(proposed[k]);
        row.appendChild(dt);
        row.appendChild(dd);
        dl.appendChild(row);
      });
      card.appendChild(dl);

      if (r.status === 'rejected' && r.reject_reason) {
        var reason = document.createElement('p');
        reason.className = 'member-note';
        reason.textContent = 'Reason: ' + r.reject_reason;
        card.appendChild(reason);
      }

      if (r.status === 'pending') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline';
        btn.textContent = 'Cancel request';
        btn.addEventListener('click', function () { cancelEdit(r.id, btn); });
        card.appendChild(btn);
      }
      list.appendChild(card);
    });
  }

  async function loadRequests() {
    var res = await client.rpc(RPC.myEditRequests);
    if (res.error) {
      showAlert('edit-alert', PUAuth.friendlyAuthError(res.error, 'Could not load edit requests.'), 'error');
      return;
    }
    renderRequests(Array.isArray(res.data) ? res.data : []);
  }

  async function cancelEdit(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
    var res = await client.rpc(RPC.ownerCancelEdit, { p_request_id: Number(id) });
    if (res.error) {
      showAlert('edit-alert', PUAuth.friendlyAuthError(res.error, 'Could not cancel this request.'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Cancel request'; }
      return;
    }
    showAlert('edit-alert', 'Request cancelled.', 'ok');
    await loadRequests();
  }

  async function submitEdit(ev) {
    ev.preventDefault();
    showAlert('edit-alert', '', null);
    var changes = collectChanges();
    if (changes.__bookletError) {
      showAlert('edit-alert', changes.__bookletError, 'error');
      return;
    }
    delete changes.__bookletError;
    if (changes.__emailsError) {
      showAlert('edit-alert', changes.__emailsError, 'error');
      return;
    }
    delete changes.__emailsError;
    if (!Object.keys(changes).length) {
      showAlert('edit-alert', 'No changes to submit.', 'info');
      return;
    }
    if (changes.email && changes.emails) {
      delete changes.email;
    }
    var btn = $('edit-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    var res = await client.rpc(RPC.ownerSubmitEdit, { p_changes: changes });
    btn.disabled = false;
    btn.textContent = 'Submit for approval';
    if (res.error) {
      showAlert('edit-alert', PUAuth.friendlyAuthError(res.error, 'Could not submit this request.'), 'error');
      return;
    }
    showAlert('edit-alert', 'Request submitted. An admin will review it.', 'ok');
    await loadRequests();
  }

  async function changePassword(ev) {
    ev.preventDefault();
    showAlert('pw-alert', '', null);
    var pw = $('pw-new').value || '';
    var confirm = $('pw-confirm').value || '';
    if (pw.length < 8) {
      showAlert('pw-alert', 'Use at least 8 characters for your password.', 'error');
      return;
    }
    if (pw !== confirm) {
      showAlert('pw-alert', 'The two passwords do not match.', 'error');
      return;
    }
    var btn = $('pw-submit');
    btn.disabled = true;
    btn.textContent = 'Updating…';
    var res = await client.auth.updateUser({ password: pw });
    btn.disabled = false;
    btn.textContent = 'Update password';
    $('pw-new').value = '';
    $('pw-confirm').value = '';
    if (res.error) {
      showAlert('pw-alert', PUAuth.friendlyAuthError(res.error, 'Could not update your password.'), 'error');
      return;
    }
    showAlert('pw-alert', 'Password updated.', 'ok');
  }

  async function boot() {
    $('member-signout-btn').addEventListener('click', function () { PUAuth.signOut(client); });

    var session = await PUAuth.getSession(client);
    if (!session) {
      location.replace(PUAuth.urlFor('signIn'));
      return;
    }

    $('member-gate').hidden = true;
    $('member-content').hidden = false;
    if (PUAuth.applyMemberChrome) await PUAuth.applyMemberChrome(client);

    var memRes = await client.rpc(RPC.myMembership);
    if (memRes.error) {
      showAlert('member-alert', PUAuth.friendlyAuthError(memRes.error, 'Could not load your membership.'), 'error');
      return;
    }
    membership = firstRow(memRes.data);
    if (!membership) {
      showAlert('member-alert', 'Signed in, but this login is not linked to a company yet. An admin can connect it.', 'info');
      $('member-welcome').textContent = 'No company linked';
      return;
    }

    if (membership.my_role === 'owner') {
      $('nav-staff').hidden = false;
      $('edit-card').hidden = false;
      $('requests-card').hidden = false;
    }

    var coRes = await client.rpc(RPC.myCompany);
    if (coRes.error) {
      showAlert('member-alert', PUAuth.friendlyAuthError(coRes.error, 'Could not load your company profile.'), 'error');
      fillProfile(null, membership);
      return;
    }
    company = firstRow(coRes.data);
    fillProfile(company, membership);
    if (membership.my_role === 'owner' && company) {
      if (window.MemberEmails) MemberEmails.bind($('e-emails'));
      fillEditForm(company);
      $('edit-form').addEventListener('submit', submitEdit);
      await loadRequests();
    }

    $('pw-form').addEventListener('submit', changePassword);
  }

  boot();
})();
