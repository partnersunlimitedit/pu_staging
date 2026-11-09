/* Member Area sign-in — password + magic link. Routes by role after Auth. */
(function () {
  'use strict';
  if (!document.body || document.body.getAttribute('data-pu-page') !== 'signin') return;
  if (!window.PUAuth) return;

  var client = PUAuth.createClient();

  function $(id) { return document.getElementById(id); }

  function showAlert(message, kind) {
    var el = $('pu-signin-alert');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.className = 'portal-alert' + (kind ? ' is-' + kind : '');
  }

  function setBusy(busy, passwordLabel, otpLabel) {
    var pw = $('pu-password-btn');
    var otp = $('pu-otp-btn');
    if (pw) {
      pw.disabled = !!busy;
      if (passwordLabel) pw.textContent = passwordLabel;
    }
    if (otp) {
      otp.disabled = !!busy;
      if (otpLabel) otp.textContent = otpLabel;
    }
  }

  async function boot() {
    // Magic-link / OAuth return lands here with tokens in the URL hash
    try {
      var session = await PUAuth.getSession(client);
      if (session) {
        showAlert('Signed in — redirecting…', 'ok');
        await PUAuth.routeAfterSignIn(client);
        return;
      }
    } catch (e) {
      showAlert(PUAuth.friendlyAuthError(e, 'Could not restore your session.'), 'error');
    }

    var form = $('pu-signin-form');
    if (!form) return;

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      showAlert('', null);
      var email = ($('email').value || '').trim();
      var password = $('password').value || '';
      if (!email) {
        showAlert('Enter your email address.', 'error');
        return;
      }
      if (!password) {
        showAlert('Enter your password, or use “Email me a sign-in link”.', 'error');
        return;
      }
      setBusy(true, 'Signing in…', null);
      try {
        var res = await client.auth.signInWithPassword({ email: email, password: password });
        if (res.error) {
          showAlert(PUAuth.friendlyAuthError(res.error), 'error');
          setBusy(false, 'Sign in', 'Email me a sign-in link');
          return;
        }
        showAlert('Signed in — redirecting…', 'ok');
        await PUAuth.routeAfterSignIn(client);
      } catch (err) {
        showAlert(PUAuth.friendlyAuthError(err), 'error');
        setBusy(false, 'Sign in', 'Email me a sign-in link');
      }
    });

    $('pu-otp-btn').addEventListener('click', async function () {
      showAlert('', null);
      var email = ($('email').value || '').trim();
      if (!email) {
        showAlert('Enter your email address to receive a sign-in link.', 'error');
        $('email').focus();
        return;
      }
      setBusy(true, null, 'Sending link…');
      try {
        var res = await client.auth.signInWithOtp({
          email: email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: PUAuth.magicLinkRedirectTo()
          }
        });
        if (res.error) {
          showAlert(PUAuth.friendlyAuthError(res.error, 'Could not send a sign-in link.'), 'error');
          setBusy(false, 'Sign in', 'Email me a sign-in link');
          return;
        }
        showAlert('If that email has an account, a sign-in link is on its way. Check your inbox.', 'ok');
        setBusy(false, 'Sign in', 'Email me a sign-in link');
      } catch (err) {
        showAlert(PUAuth.friendlyAuthError(err, 'Could not send a sign-in link.'), 'error');
        setBusy(false, 'Sign in', 'Email me a sign-in link');
      }
    });
  }

  boot();
})();
