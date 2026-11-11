/* Owner staff list — remove with confirmation; add-staff invite disabled. */
(function () {
  'use strict';
  if (!document.body || document.body.getAttribute('data-pu-page') !== 'member-staff') return;
  if (!window.PUAuth) return;

  var client = PUAuth.createClient();
  var RPC = PUAuth.CONFIG.rpc;
  var pendingRemove = null;
  var STAFF_LIMIT = 5;

  function $(id) { return document.getElementById(id); }

  function showAlert(message, kind) {
    var el = $('staff-alert');
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

  function render(rows) {
    var list = $('staff-list');
    var empty = $('staff-empty');
    list.innerHTML = '';
    rows = rows || [];
    var staffCount = rows.filter(function (u) { return u.role === 'staff'; }).length;
    $('staff-count').textContent = staffCount + ' of ' + STAFF_LIMIT + ' staff slots used.';

    if (!rows.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    var table = document.createElement('table');
    table.className = 'portal-table';
    table.innerHTML = '<thead><tr><th>Name</th><th>Role</th><th>Linked</th><th>Invite</th><th></th></tr></thead>';
    var tb = document.createElement('tbody');
    rows.forEach(function (u) {
      var tr = document.createElement('tr');
      var name = document.createElement('td');
      name.textContent = u.full_name || '—';
      var role = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'member-badge ' + (u.role === 'owner' ? 'is-active' : 'is-pending');
      badge.textContent = u.role || 'staff';
      role.appendChild(badge);
      var linked = document.createElement('td');
      linked.textContent = fmtDate(u.linked_at);
      var inv = document.createElement('td');
      inv.textContent = u.invite_accepted ? 'Accepted' : 'Pending';
      var act = document.createElement('td');
      if (u.role === 'staff') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn admin-btn-danger';
        btn.style.padding = '.45rem 1rem';
        btn.style.fontSize = '.85rem';
        btn.textContent = 'Remove';
        btn.addEventListener('click', function () { openModal(u); });
        act.appendChild(btn);
      }
      tr.appendChild(name);
      tr.appendChild(role);
      tr.appendChild(linked);
      tr.appendChild(inv);
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    list.appendChild(table);
  }

  function openModal(user) {
    pendingRemove = user;
    $('staff-modal').hidden = false;
    $('staff-modal-confirm').focus();
  }
  function closeModal() {
    pendingRemove = null;
    $('staff-modal').hidden = true;
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    var user = pendingRemove;
    closeModal();
    var res = await client.rpc(RPC.ownerRemoveStaff, { p_user_id: user.user_id });
    if (res.error) {
      showAlert(PUAuth.friendlyAuthError(res.error, 'Could not remove this staff login.'), 'error');
      return;
    }
    showAlert('Staff login removed.', 'ok');
    await loadStaff();
  }

  async function loadStaff() {
    var res = await client.rpc(RPC.ownerListStaff);
    if (res.error) {
      showAlert(PUAuth.friendlyAuthError(res.error, 'Could not load staff.'), 'error');
      return;
    }
    render(Array.isArray(res.data) ? res.data : []);
  }

  async function boot() {
    $('member-signout-btn').addEventListener('click', function () { PUAuth.signOut(client); });
    var session = await PUAuth.getSession(client);
    if (!session) {
      location.replace(PUAuth.urlFor('signIn'));
      return;
    }
    $('staff-gate').hidden = true;
    $('staff-content').hidden = false;
    if (PUAuth.applyMemberChrome) await PUAuth.applyMemberChrome(client);

    $('staff-modal').querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    $('staff-modal-confirm').addEventListener('click', confirmRemove);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('staff-modal').hidden) closeModal();
    });

    await loadStaff();
  }

  boot();
})();
