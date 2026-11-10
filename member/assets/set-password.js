/* Set / reset password after invite or recovery link. */
(function () {
  'use strict';
  if (!document.body || document.body.getAttribute('data-pu-page') !== 'set-password') return;
  if (!window.PUAuth) return;

  var client = PUAuth.createClient();
  var ready = false;

  function $(id) { return document.getElementById(id); }

  function showAlert(message, kind) {
    var el = $('sp-alert');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.className = 'portal-alert' + (kind ? ' is-' + kind : '');
  }

  function showForm() {
    ready = true;
    $('sp-waiting').hidden = true;
    $('sp-fields').hidden = false;
  }

  function showExpired() {
    ready = false;
    $('sp-waiting').hidden = true;
    $('sp-fields').hidden = true;
    showAlert('This link is invalid or has expired. Request a new one from the sign-in page.', 'error');
  }

  async function boot() {
    var form = $('set-password-form');

    client.auth.onAuthStateChange(function (event, session) {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
        if (event !== 'USER_UPDATED') showForm();
      }
    });

    try {
      var session = await PUAuth.getSession(client);
      if (session) showForm();
      else {
        // Give the client a moment to parse tokens from the URL hash
        setTimeout(async function () {
          var s = await PUAuth.getSession(client);
          if (s) showForm();
          else showExpired();
        }, 1500);
      }
    } catch (e) {
      showExpired();
    }

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      showAlert('', null);
      if (!ready) {
        showAlert('This link is invalid or has expired. Request a new one from the sign-in page.', 'error');
        return;
      }
      var pw = $('sp-password').value || '';
      var confirm = $('sp-confirm').value || '';
      if (pw.length < 8) {
        showAlert('Use at least 8 characters for your password.', 'error');
        return;
      }
      if (pw !== confirm) {
        showAlert('The two passwords do not match.', 'error');
        return;
      }
      var btn = $('sp-submit');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        var res = await client.auth.updateUser({ password: pw });
        if (res.error) {
          showAlert(PUAuth.friendlyAuthError(res.error, 'Could not save your password.'), 'error');
          btn.disabled = false;
          btn.textContent = 'Save password';
          return;
        }
        showAlert('Password saved — redirecting…', 'ok');
        await PUAuth.routeAfterSignIn(client);
      } catch (err) {
        showAlert(PUAuth.friendlyAuthError(err, 'Could not save your password.'), 'error');
        btn.disabled = false;
        btn.textContent = 'Save password';
      }
    });
  }

  boot();
})();
