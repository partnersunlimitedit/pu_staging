/* Partners Unlimited — Admin AGM editor UI.
   Data access lives in agm-api.js. Auth uses the same is_admin gate. */
(function () {
  'use strict';

  if (!document.body || document.body.getAttribute('data-admin-page') !== 'agm') return;
  if (!window.PUAuth || !window.AgmApi || typeof supabase === 'undefined') return;

  var client = PUAuth.createClient();
  var SIGN_IN = PUAuth.urlFor('signIn');
  var MEMBER_HOME = PUAuth.urlFor('memberHome');

  var cache = [];
  var currentId = null;
  var pendingPublish = null;

  function $(id) { return document.getElementById(id); }

  function showAlert(el, message, kind) {
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.className = 'admin-alert' + (kind ? ' is-' + kind : '');
  }

  function friendlyError(err, fallback) {
    return AgmApi.friendlyError(err, fallback || 'Something went wrong. Please try again.');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso + (String(iso).length <= 10 ? 'T00:00:00' : ''));
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }

  function formatDates(row) {
    var start = fmtDate(row && row.start_date);
    var end = fmtDate(row && row.end_date);
    if (start && end && start !== end) return start + ' – ' + end;
    return start || end || '—';
  }

  function toDateInput(iso) {
    if (!iso) return '';
    var s = String(iso);
    return s.length >= 10 ? s.slice(0, 10) : '';
  }

  function statusBadge(status) {
    var s = status || 'tba';
    var span = document.createElement('span');
    span.className = 'admin-badge is-' + s;
    span.textContent = s === 'tba' ? 'TBA' : s;
    return span;
  }

  function publishedBadge(published) {
    var span = document.createElement('span');
    span.className = 'admin-badge ' + (published ? 'is-published' : 'is-draft');
    span.textContent = published ? 'Published' : 'Draft';
    return span;
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (label) btn.textContent = label;
  }

  function escapeText(value) {
    return String(value == null ? '' : value);
  }

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

  function showView(name) {
    $('agm-list-view').hidden = name !== 'list';
    $('agm-form-view').hidden = name !== 'form';
  }

  function setListState(which) {
    $('agm-list-loading').hidden = which !== 'loading';
    $('agm-list-empty').hidden = which !== 'empty';
    $('agm-list-error').hidden = which !== 'error';
    var showTable = which === 'table';
    $('agm-table-wrap').hidden = !showTable;
    $('agm-cards').hidden = !showTable;
  }

  function readForm() {
    return {
      year: $('a-year').value,
      title: $('a-title').value,
      location: $('a-location').value,
      start_date: $('a-start').value,
      end_date: $('a-end').value,
      status: $('a-status').value,
      short_description: $('a-description').value,
      sort_order: $('a-sort').value
    };
  }

  function fillForm(row, isNew) {
    currentId = isNew || !row ? null : row.id;
    $('a-id').value = currentId || '';
    $('a-year').value = row && row.year != null ? row.year : '';
    $('a-title').value = row && row.title ? row.title : '';
    $('a-location').value = row && row.location ? row.location : '';
    $('a-start').value = toDateInput(row && row.start_date);
    $('a-end').value = toDateInput(row && row.end_date);
    $('a-status').value = (row && row.status) || 'tba';
    $('a-description').value = row && row.short_description ? row.short_description : '';
    $('a-sort').value = row && row.sort_order != null ? row.sort_order : 0;
    $('agm-detail-eyebrow').textContent = isNew ? 'Add AGM' : 'Edit AGM';
    $('agm-detail-title').textContent = isNew ? 'New meeting' : (row.title || 'AGM ' + (row.year || ''));
    var published = !!(row && row.published);
    $('agm-published-state').textContent = isNew ? 'New meetings start as drafts.' : (published ? 'This meeting is published.' : 'This meeting is a draft (unpublished).');
    $('agm-publish-btn').hidden = isNew || published;
    $('agm-unpublish-btn').hidden = isNew || !published;
    showAlert($('agm-detail-alert'), '', null);
  }

  function openNew() {
    fillForm({ status: 'tba', published: false, sort_order: 0 }, true);
    showView('form');
    $('a-year').focus();
  }

  function openEdit(id) {
    var row = cache.find(function (item) { return String(item.id) === String(id); });
    if (!row) return;
    fillForm(row, false);
    showView('form');
    $('a-title').focus();
  }

  async function refreshAndOpen(id) {
    await loadList({ silent: true });
    var row = cache.find(function (item) { return String(item.id) === String(id); });
    if (row) fillForm(row, false);
  }

  function backToList() {
    currentId = null;
    showView('list');
    showAlert($('agm-alert'), '', null);
  }

  function renderList() {
    var body = $('agm-table-body');
    var cards = $('agm-cards');
    body.textContent = '';
    cards.textContent = '';

    if (!cache.length) {
      $('agm-count').textContent = 'No meetings yet';
      setListState('empty');
      return;
    }

    $('agm-count').textContent = cache.length === 1 ? '1 meeting' : (cache.length + ' meetings');
    setListState('table');

    cache.forEach(function (row) {
      var tr = document.createElement('tr');
      var titleCell = document.createElement('td');
      titleCell.className = 'company';
      titleCell.textContent = escapeText(row.title || '—');

      var yearCell = document.createElement('td');
      yearCell.textContent = row.year != null ? String(row.year) : '—';

      var locCell = document.createElement('td');
      locCell.className = 'loc';
      locCell.textContent = escapeText(row.location || '—');

      var datesCell = document.createElement('td');
      datesCell.textContent = formatDates(row);

      var statusCell = document.createElement('td');
      statusCell.appendChild(statusBadge(row.status));

      var pubCell = document.createElement('td');
      pubCell.appendChild(publishedBadge(row.published));

      var actionCell = document.createElement('td');
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-outline admin-row-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openEdit(row.id);
      });
      actionCell.appendChild(editBtn);

      tr.addEventListener('click', function () { openEdit(row.id); });
      tr.style.cursor = 'pointer';

      tr.appendChild(yearCell);
      tr.appendChild(titleCell);
      tr.appendChild(locCell);
      tr.appendChild(datesCell);
      tr.appendChild(statusCell);
      tr.appendChild(pubCell);
      tr.appendChild(actionCell);
      body.appendChild(tr);

      var li = document.createElement('li');
      li.className = 'admin-card';
      var top = document.createElement('div');
      top.className = 'admin-card-top';
      var h3 = document.createElement('h3');
      h3.textContent = escapeText(row.title || 'AGM');
      top.appendChild(h3);
      top.appendChild(statusBadge(row.status));
      var meta = document.createElement('div');
      meta.className = 'admin-card-meta';
      meta.appendChild(document.createTextNode('Year: ' + (row.year != null ? row.year : '—')));
      meta.appendChild(document.createElement('br'));
      meta.appendChild(document.createTextNode(row.location || 'No location yet'));
      meta.appendChild(document.createElement('br'));
      meta.appendChild(document.createTextNode(formatDates(row)));
      var pubLine = document.createElement('div');
      pubLine.style.marginTop = '.55rem';
      pubLine.appendChild(publishedBadge(row.published));
      var cardBtn = document.createElement('button');
      cardBtn.type = 'button';
      cardBtn.className = 'btn btn-outline admin-row-btn';
      cardBtn.style.marginTop = '.85rem';
      cardBtn.textContent = 'Edit';
      cardBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openEdit(row.id);
      });
      li.appendChild(top);
      li.appendChild(meta);
      li.appendChild(pubLine);
      li.appendChild(cardBtn);
      cards.appendChild(li);
    });
  }

  async function loadList(opts) {
    var silent = opts && opts.silent;
    if (!silent) {
      setListState('loading');
      showAlert($('agm-alert'), '', null);
    }
    var res = await AgmApi.listMeetings(client);
    if (res.error) {
      $('agm-list-error-msg').textContent = friendlyError(res.error, 'Could not load AGM meetings.');
      $('agm-count').textContent = 'Unable to load';
      setListState('error');
      return;
    }
    cache = Array.isArray(res.data) ? res.data : [];
    renderList();
  }

  async function saveMeeting() {
    var alertEl = $('agm-detail-alert');
    var input = readForm();
    var checked = AgmApi.validate(input);
    if (checked.error) {
      showAlert(alertEl, friendlyError(checked.error, checked.error.message), 'error');
      return;
    }
    var btn = $('agm-save-btn');
    setBusy(btn, true, 'Saving…');
    var res;
    if (currentId) res = await AgmApi.updateMeeting(client, currentId, checked.payload);
    else res = await AgmApi.insertMeeting(client, checked.payload);
    setBusy(btn, false, 'Save');
    if (res.error) {
      showAlert(alertEl, friendlyError(res.error, 'Could not save this meeting.'), 'error');
      return;
    }
    var saved = res.data;
    var wasNew = !currentId;
    currentId = saved && saved.id;
    await loadList({ silent: true });
    fillForm(saved, false);
    showAlert(alertEl, wasNew ? 'Meeting added.' : 'Meeting updated.', 'ok');
  }

  function openPublishModal(publish) {
    if (!currentId) return;
    pendingPublish = !!publish;
    $('agm-modal-title').textContent = publish ? 'Publish this AGM?' : 'Unpublish this AGM?';
    $('agm-modal-body').textContent = publish
      ? 'Publishing makes this meeting visible to the public site once the Meetings page is connected to this table. You can unpublish it later.'
      : 'Unpublishing hides this meeting from the public site. The record is kept and you can publish it again later.';
    $('agm-modal-confirm').textContent = publish ? 'Publish' : 'Unpublish';
    $('agm-modal-confirm').className = publish ? 'btn btn-primary' : 'btn admin-btn-danger';
    $('agm-modal').hidden = false;
    $('agm-modal-confirm').focus();
  }

  function closePublishModal() {
    pendingPublish = null;
    $('agm-modal').hidden = true;
  }

  async function confirmPublish() {
    var publish = pendingPublish;
    var id = currentId;
    closePublishModal();
    if (id == null || publish == null) return;
    var alertEl = $('agm-detail-alert');
    var btn = publish ? $('agm-publish-btn') : $('agm-unpublish-btn');
    setBusy(btn, true, publish ? 'Publishing…' : 'Unpublishing…');
    var res = await AgmApi.setPublished(client, id, publish);
    setBusy(btn, false, publish ? 'Publish' : 'Unpublish');
    if (res.error) {
      showAlert(alertEl, friendlyError(res.error, 'Could not update the published state.'), 'error');
      return;
    }
    await loadList({ silent: true });
    fillForm(res.data, false);
    showAlert(alertEl, publish ? 'Meeting published.' : 'Meeting unpublished.', 'ok');
  }

  async function init() {
    var gate = $('admin-gate');
    if (gate) gate.hidden = false;
    var auth = await requireAdmin();
    if (gate) gate.hidden = true;
    if (!auth) return;

    $('admin-signout-btn').addEventListener('click', signOut);
    $('agm-add-btn').addEventListener('click', openNew);
    $('agm-empty-add').addEventListener('click', openNew);
    $('agm-back-btn').addEventListener('click', function () {
      backToList();
      renderList();
    });
    $('agm-list-retry').addEventListener('click', function () { loadList(); });
    $('agm-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveMeeting();
    });
    $('agm-publish-btn').addEventListener('click', function () { openPublishModal(true); });
    $('agm-unpublish-btn').addEventListener('click', function () { openPublishModal(false); });
    $('agm-modal').querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closePublishModal);
    });
    $('agm-modal-confirm').addEventListener('click', confirmPublish);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('agm-modal').hidden) closePublishModal();
    });

    showView('list');
    await loadList();
  }

  init();
})();
