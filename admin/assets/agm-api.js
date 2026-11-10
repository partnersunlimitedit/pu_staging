/* Partners Unlimited — AGM data access (admin).
   All agm_meetings reads/writes go through this module so a later
   PU Data contract change is a one-file swap.
   Never send created_at or updated_at (updated_at is set by a trigger).
   Branch on error.code, not HTTP status. Never log secrets. */
(function (global) {
  'use strict';

  var TABLE = 'agm_meetings';
  var COLUMNS = [
    'id',
    'year',
    'title',
    'location',
    'start_date',
    'end_date',
    'status',
    'short_description',
    'published',
    'sort_order',
    'created_at',
    'updated_at'
  ].join(',');
  var WRITE_FIELDS = [
    'year',
    'title',
    'location',
    'start_date',
    'end_date',
    'status',
    'short_description',
    'published',
    'sort_order'
  ];
  var STATUSES = { next: true, tba: true, past: true };

  function errorCode(err) {
    if (global.PUAuth && typeof PUAuth.errorCode === 'function') {
      return PUAuth.errorCode(err);
    }
    return String((err && (err.code || err.error_code)) || '');
  }

  function isMissingTable(err) {
    if (!err) return false;
    var code = errorCode(err);
    var msg = String(err.message || '').toLowerCase();
    if (code === '42P01' || code === 'PGRST205') return true;
    return (/agm_meetings/.test(msg) || /could not find the table/.test(msg)) &&
      (/does not exist/.test(msg) || /could not find the table/.test(msg) || /schema cache/.test(msg));
  }

  function zeroRowError() {
    return { code: '42501', message: 'not authorized or meeting not found' };
  }

  function firstRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  function friendlyError(err, fallback) {
    if (!err) return fallback || 'Something went wrong. Please try again.';
    if (isMissingTable(err) || errorCode(err) === '42P01') {
      return 'AGM table not set up on TEST yet';
    }
    var code = errorCode(err);
    if (code === '23505') {
      return 'Another AGM is already marked Next. Set it to Past or TBA first.';
    }
    if (code === '23514') {
      var msg = String(err.message || '');
      if (/end date must be on or after/i.test(msg) || /agm_dates_order/i.test(msg)) {
        return 'The end date must be on or after the start date.';
      }
      if (/title is required/i.test(msg) || /btrim\(title\)/i.test(msg) || /title/i.test(msg) && /blank|length/i.test(msg)) {
        return 'Title is required and cannot be blank.';
      }
      if (/year must be between/i.test(msg) || /year between/i.test(msg)) {
        return 'Year must be between 2000 and 2100.';
      }
      return 'That value is not valid. Year must be between 2000 and 2100, the title cannot be blank, and the end date must be on or after the start date.';
    }
    if (code === '42501' || (global.PUAuth && PUAuth.isRlsError && PUAuth.isRlsError(err))) {
      return 'You are not authorized to do that, or this meeting was not found.';
    }
    if (global.PUAuth && typeof PUAuth.friendlyAuthError === 'function') {
      return PUAuth.friendlyAuthError(err, fallback || 'Something went wrong. Please try again.');
    }
    return fallback || 'Something went wrong. Please try again.';
  }

  function emptyToNull(value) {
    if (value == null) return null;
    var s = String(value).trim();
    return s ? s : null;
  }

  function writePayload(input) {
    var src = input || {};
    var out = {};
    WRITE_FIELDS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) return;
      var value = src[key];
      if (key === 'year') {
        var year = parseInt(value, 10);
        out.year = isNaN(year) ? value : year;
        return;
      }
      if (key === 'sort_order') {
        var order = parseInt(value, 10);
        out.sort_order = isNaN(order) ? 0 : order;
        return;
      }
      if (key === 'published') {
        out.published = !!value;
        return;
      }
      if (key === 'status') {
        var status = String(value || 'tba').toLowerCase();
        out.status = STATUSES[status] ? status : 'tba';
        return;
      }
      if (key === 'title') {
        out.title = value == null ? '' : String(value).trim();
        return;
      }
      if (key === 'start_date' || key === 'end_date') {
        out[key] = emptyToNull(value);
        return;
      }
      out[key] = emptyToNull(value);
    });
    return out;
  }

  function validate(input, opts) {
    var payload = writePayload(input);
    var requireAll = !opts || opts.partial !== true;
    if (requireAll || Object.prototype.hasOwnProperty.call(payload, 'year')) {
      var year = payload.year;
      if (year == null || year === '' || isNaN(Number(year))) {
        return { error: { code: '22023', message: 'Year is required.' }, payload: payload };
      }
      if (year < 2000 || year > 2100) {
        return { error: { code: '23514', message: 'Year must be between 2000 and 2100.' }, payload: payload };
      }
    }
    if (requireAll || Object.prototype.hasOwnProperty.call(payload, 'title')) {
      if (!payload.title) {
        return { error: { code: '23514', message: 'Title is required and cannot be blank.' }, payload: payload };
      }
    }
    var start = payload.start_date;
    var end = payload.end_date;
    if (start && end && end < start) {
      return { error: { code: '23514', message: 'The end date must be on or after the start date.' }, payload: payload };
    }
    return { error: null, payload: payload };
  }

  async function listMeetings(client) {
    return client
      .from(TABLE)
      .select(COLUMNS)
      .order('sort_order', { ascending: true })
      .order('year', { ascending: false });
  }

  async function getMeeting(client, id) {
    return client
      .from(TABLE)
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
  }

  async function insertMeeting(client, input) {
    var checked = validate(input);
    if (checked.error) return { data: null, error: checked.error };
    var res = await client
      .from(TABLE)
      .insert(checked.payload)
      .select(COLUMNS);
    if (res.error) return { data: null, error: res.error };
    var row = firstRow(res.data);
    if (!row) return { data: null, error: zeroRowError() };
    return { data: row, error: null };
  }

  async function updateMeeting(client, id, input) {
    var checked = validate(input, { partial: true });
    if (checked.error) return { data: null, error: checked.error };
    if (!Object.keys(checked.payload).length) {
      return { data: null, error: { code: '22023', message: 'Nothing to update.' } };
    }
    var res = await client
      .from(TABLE)
      .update(checked.payload)
      .eq('id', id)
      .select(COLUMNS);
    if (res.error) return { data: null, error: res.error };
    var row = firstRow(res.data);
    if (!row) return { data: null, error: zeroRowError() };
    return { data: row, error: null };
  }

  async function setPublished(client, id, published) {
    return updateMeeting(client, id, { published: !!published });
  }

  global.AgmApi = {
    TABLE: TABLE,
    WRITE_FIELDS: WRITE_FIELDS,
    friendlyError: friendlyError,
    isMissingTable: isMissingTable,
    writePayload: writePayload,
    validate: validate,
    listMeetings: listMeetings,
    getMeeting: getMeeting,
    insertMeeting: insertMeeting,
    updateMeeting: updateMeeting,
    setPublished: setPublished
  };
})(typeof window !== 'undefined' ? window : this);
