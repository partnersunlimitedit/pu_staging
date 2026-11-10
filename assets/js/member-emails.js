/* Partners Unlimited — labeled directory emails (main | import | export).
   Shared by the admin member form, member edit requests, and pending-edit diffs.
   Admin writes use rpc admin_set_member_emails. Do not invent other RPC names. */
(function (global) {
  'use strict';

  var MAX = 8;
  var LABELS = [
    { value: 'main', text: 'Main' },
    { value: 'import', text: 'Import' },
    { value: 'export', text: 'Export' }
  ];
  var LABEL_OK = { main: true, import: true, export: true };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var rowSeq = 0;

  function displayLabel(label) {
    var v = String(label || '').trim().toLowerCase();
    if (v === 'main') return 'Main';
    if (v === 'import') return 'Import';
    if (v === 'export') return 'Export';
    return label ? String(label) : 'Main';
  }

  function normalizeLabel(label) {
    var v = String(label || '').trim().toLowerCase();
    return LABEL_OK[v] ? v : '';
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email) {
    var s = String(email || '').trim();
    return s.length > 0 && s.length <= 300 && EMAIL_RE.test(s);
  }

  function isEmailRow(item) {
    return !!(item && typeof item === 'object' && !Array.isArray(item) &&
      (Object.prototype.hasOwnProperty.call(item, 'email') ||
        Object.prototype.hasOwnProperty.call(item, 'label')));
  }

  function normalizeRow(row) {
    if (!row) return null;
    return {
      label: normalizeLabel(row.label) || 'main',
      email: String(row.email || '').trim()
    };
  }

  /* Rows to send to the API: drop blanks, keep entered addresses. */
  function payloadRows(rows) {
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var email = String(row && row.email || '').trim();
      if (!email) return;
      out.push({
        label: normalizeLabel(row.label) || 'main',
        email: normalizeEmail(email)
      });
    });
    return out;
  }

  function firstMainEmail(rows) {
    var list = payloadRows(rows);
    for (var i = 0; i < list.length; i++) {
      if (list[i].label === 'main') return list[i].email;
    }
    return '';
  }

  function listsEqual(a, b) {
    var left = payloadRows(a);
    var right = payloadRows(b);
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i++) {
      if (left[i].label !== right[i].label) return false;
      if (normalizeEmail(left[i].email) !== normalizeEmail(right[i].email)) return false;
    }
    return true;
  }

  function formatList(rows) {
    var list = payloadRows(rows);
    if (!list.length) return '—';
    return list.map(function (row) {
      return displayLabel(row.label) + ': ' + row.email;
    }).join('; ');
  }

  function formatChangeVal(v) {
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) {
      if (!v.length) return '—';
      if (v.every(isEmailRow)) {
        var list = payloadRows(v);
        return list.length
          ? list.map(function (row) { return displayLabel(row.label) + ': ' + row.email; }).join('\n')
          : '—';
      }
      return v.join(', ') || '—';
    }
    if (isEmailRow(v)) return formatList([v]);
    return String(v);
  }

  /*
   * Prefer emails jsonb when the member row already has it.
   * If that list is empty but members.email is set, show one Main row.
   * If emails was not returned at all, the caller may SELECT member_emails.
   */
  function rowsFromMember(member) {
    if (!member) return [];
    if (Array.isArray(member.emails)) {
      if (member.emails.length) {
        return member.emails.map(normalizeRow).filter(function (row) {
          return row && row.email;
        });
      }
      if (member.email) return [{ label: 'main', email: String(member.email).trim() }];
      return [];
    }
    if (member.email) return [{ label: 'main', email: String(member.email).trim() }];
    return [];
  }

  function hasEmailsJson(member) {
    return !!(member && Object.prototype.hasOwnProperty.call(member, 'emails'));
  }

  async function loadForAdmin(client, member) {
    if (!member) return [];
    if (hasEmailsJson(member)) return rowsFromMember(member);
    if (member.id != null && client && typeof client.from === 'function') {
      var res = await client
        .from('member_emails')
        .select('id,member_id,email,label,sort_order')
        .eq('member_id', member.id)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (!res.error && Array.isArray(res.data) && res.data.length) {
        return res.data.map(normalizeRow).filter(function (row) {
          return row && row.email;
        });
      }
    }
    return rowsFromMember(member);
  }

  function validate(rows) {
    var raw = Array.isArray(rows) ? rows : [];
    if (raw.length > MAX) {
      return { ok: false, error: 'You can add up to 8 directory emails.', emails: [] };
    }
    var pending = [];
    var blanks = 0;
    raw.forEach(function (row) {
      var email = String(row && row.email || '').trim();
      var label = normalizeLabel(row && row.label) || 'main';
      if (!email) { blanks += 1; return; }
      pending.push({ label: label, email: normalizeEmail(email) });
    });
    if (blanks && !pending.length && raw.length) {
      // Only empty rows: treat as a cleared list.
      return { ok: true, error: null, emails: [] };
    }
    if (blanks) {
      return { ok: false, error: 'Remove any blank email rows, or fill them in.', emails: [] };
    }
    if (pending.length > MAX) {
      return { ok: false, error: 'You can add up to 8 directory emails.', emails: [] };
    }
    var seen = {};
    for (var i = 0; i < pending.length; i++) {
      var row = pending[i];
      if (!LABEL_OK[row.label]) {
        return { ok: false, error: 'Each email must be labelled Main, Import or Export.', emails: [] };
      }
      if (!isValidEmail(row.email)) {
        return { ok: false, error: 'Enter a valid email address on every row.', emails: [] };
      }
      var key = normalizeEmail(row.email);
      if (seen[key]) {
        return { ok: false, error: 'The same email cannot be listed twice.', emails: [] };
      }
      seen[key] = true;
    }
    return { ok: true, error: null, emails: pending };
  }

  function collectFrom(container) {
    if (!container) return [];
    var nodes = container.querySelectorAll('[data-email-row]');
    var out = [];
    nodes.forEach(function (node) {
      var emailEl = node.querySelector('[data-email-input]');
      var labelEl = node.querySelector('[data-email-label]');
      out.push({
        label: labelEl ? labelEl.value : 'main',
        email: emailEl ? emailEl.value : ''
      });
    });
    return out;
  }

  function setAddEnabled(container) {
    if (!container) return;
    var add = container.querySelector('[data-email-add]');
    if (!add) return;
    var count = container.querySelectorAll('[data-email-row]').length;
    add.disabled = count >= MAX;
    add.title = count >= MAX ? 'You can add up to 8 directory emails.' : 'Add another email';
  }

  function makeRow(container, row) {
    row = row || { label: 'main', email: '' };
    var id = 'email-row-' + String(++rowSeq);
    var wrap = document.createElement('div');
    wrap.className = 'email-row';
    wrap.setAttribute('data-email-row', '');

    var labelField = document.createElement('div');
    labelField.className = 'field';
    var labelLab = document.createElement('label');
    labelLab.setAttribute('for', id + '-label');
    labelLab.textContent = 'Label';
    var sel = document.createElement('select');
    sel.id = id + '-label';
    sel.setAttribute('data-email-label', '');
    var current = normalizeLabel(row.label) || 'main';
    LABELS.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.text;
      if (opt.value === current) o.selected = true;
      sel.appendChild(o);
    });
    labelField.appendChild(labelLab);
    labelField.appendChild(sel);

    var emailField = document.createElement('div');
    emailField.className = 'field';
    var emailLab = document.createElement('label');
    emailLab.setAttribute('for', id + '-email');
    emailLab.textContent = 'Email';
    var input = document.createElement('input');
    input.id = id + '-email';
    input.type = 'email';
    input.setAttribute('data-email-input', '');
    input.maxLength = 300;
    input.autocomplete = 'off';
    input.placeholder = 'name@example.com';
    input.value = row.email || '';
    emailField.appendChild(emailLab);
    emailField.appendChild(input);

    var actions = document.createElement('div');
    actions.className = 'email-row-actions';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-outline email-row-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () {
      wrap.remove();
      setAddEnabled(container);
    });
    actions.appendChild(remove);

    wrap.appendChild(labelField);
    wrap.appendChild(emailField);
    wrap.appendChild(actions);
    return wrap;
  }

  function renderList(container, rows, opts) {
    if (!container) return;
    opts = opts || {};
    var list = container.querySelector('[data-email-list]');
    if (!list) return;
    list.innerHTML = '';
    var data = Array.isArray(rows) ? rows.slice() : [];
    if (!data.length && opts.blankIfEmpty) data = [{ label: 'main', email: '' }];
    data.forEach(function (row) {
      list.appendChild(makeRow(container, row));
    });
    setAddEnabled(container);
  }

  function bind(container) {
    if (!container || container.getAttribute('data-email-bound')) return;
    container.setAttribute('data-email-bound', '1');
    var add = container.querySelector('[data-email-add]');
    if (add) {
      add.addEventListener('click', function () {
        var list = container.querySelector('[data-email-list]');
        if (!list) return;
        if (list.querySelectorAll('[data-email-row]').length >= MAX) {
          setAddEnabled(container);
          return;
        }
        list.appendChild(makeRow(container, { label: 'main', email: '' }));
        setAddEnabled(container);
      });
    }
  }

  global.MemberEmails = {
    MAX: MAX,
    displayLabel: displayLabel,
    normalizeLabel: normalizeLabel,
    normalizeEmail: normalizeEmail,
    payloadRows: payloadRows,
    firstMainEmail: firstMainEmail,
    listsEqual: listsEqual,
    formatList: formatList,
    formatChangeVal: formatChangeVal,
    rowsFromMember: rowsFromMember,
    loadForAdmin: loadForAdmin,
    validate: validate,
    collectFrom: collectFrom,
    renderList: renderList,
    bind: bind
  };
})(typeof window !== 'undefined' ? window : this);
