/* Partners Unlimited — Contact form
   Saves enquiries to Supabase (insert-only table, public key).
   Does not send e-mail; the team reads messages from the database. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://vcugotjdsurpbntuxgcf.supabase.co'; // TEST project (staging)
  var SUPABASE_KEY = 'sb_publishable_uG8N8yNJLHLz3PhzbGNJQg_HT_It5r8'; // publishable key, safe in the browser
  var TIMEOUT_MS = 15000;

  var form = document.getElementById('contact-form');
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var f = {
    name: $('input-name'), company: $('input-company'), email: $('input-email'),
    phone: $('input-phone'), country: $('input-country'), subject: $('input-subject'),
    message: $('input-enquiry'), honeypot: $('input-website')
  };
  var submitBtn = $('cf-submit'), statusBox = $('cf-status'), success = $('cf-success');
  var memberId = null;

  /* ---- Pre-fill from the Member Directory: ?member=<id>&company=<name> ---- */
  var params = new URLSearchParams(location.search);
  var mid = params.get('member'), mcompany = (params.get('company') || '').trim().slice(0, 200);
  if (mid && /^\d{1,12}$/.test(mid)) {
    memberId = parseInt(mid, 10);
    if (mcompany) {
      if (!f.subject.value) f.subject.value = 'Enquiry about ' + mcompany;
      $('cf-member-name').textContent = mcompany;
      $('cf-member').hidden = false;
    }
  }

  /* ---- Validation ---- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function setError(input, errId, bad) {
    input.setAttribute('aria-invalid', bad ? 'true' : 'false');
    $(errId).hidden = !bad;
    return !bad;
  }
  function validate() {
    var ok = true, first = null;
    [[f.name, 'err-name', !f.name.value.trim()],
     [f.email, 'err-email', !EMAIL_RE.test(f.email.value.trim())],
     [f.message, 'err-enquiry', !f.message.value.trim()]].forEach(function (c) {
      if (!setError(c[0], c[1], c[2])) { ok = false; if (!first) first = c[0]; }
    });
    if (first) first.focus();
    return ok;
  }
  [f.name, f.email, f.message].forEach(function (i) {
    i.addEventListener('input', function () {
      if (i.getAttribute('aria-invalid') === 'true') i.setAttribute('aria-invalid', 'false');
      var err = i === f.name ? 'err-name' : i === f.email ? 'err-email' : 'err-enquiry';
      $(err).hidden = true;
    });
  });

  function showStatus(msg) { statusBox.textContent = msg; statusBox.hidden = !msg; }
  function busy(on) {
    submitBtn.disabled = on;
    submitBtn.innerHTML = on ? '<span class="cf-spin" aria-hidden="true"></span> Sending\u2026' : 'Submit';
  }
  function done() {
    form.hidden = true;
    success.hidden = false;
    success.focus();
  }
  function clean(v, max) { v = (v || '').trim(); return v ? v.slice(0, max) : null; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    showStatus('');
    if (!validate()) return;

    // Honeypot filled in: almost certainly a bot. Pretend success, send nothing.
    if (f.honeypot.value) { done(); return; }

    var body = {
      name: clean(f.name.value, 200),
      company: clean(f.company.value, 200),
      email: clean(f.email.value, 254),
      phone: clean(f.phone.value, 50),
      country: clean(f.country.value, 100),
      subject: clean(f.subject.value, 300),
      message: clean(f.message.value, 5000),
      member_id: memberId,
      source_page: (location.pathname + location.search).slice(0, 300)
    };

    busy(true);
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    fetch(SUPABASE_URL + '/rest/v1/contact_messages', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (res.ok) { form.reset(); done(); return; }
      if (res.status === 400 || res.status === 403 || res.status === 409) {
        showStatus('Sorry, we couldn\u2019t accept that message. Please check your details (a valid e-mail address and a message under 5,000 characters) and try again.');
      } else {
        showStatus('Sorry, our message service is temporarily unavailable. It may be waking up after a quiet period \u2014 please try again in a minute.');
      }
      busy(false);
    }).catch(function () {
      clearTimeout(timer);
      showStatus('Sorry, we couldn\u2019t reach our message service. Please check your connection and try again in a minute.');
      busy(false);
    });
  });

  $('cf-again').addEventListener('click', function () {
    success.hidden = true;
    form.hidden = false;
    busy(false);
    if (memberId && mcompany && !f.subject.value) f.subject.value = 'Enquiry about ' + mcompany;
    f.name.focus();
  });
})();
