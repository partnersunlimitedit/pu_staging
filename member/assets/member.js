/* Member portal home — read-only profile + membership. */
(function () {
  'use strict';
  if (!document.body || document.body.getAttribute('data-pu-page') !== 'member-home') return;
  if (!window.PUAuth) return;

  var client = PUAuth.createClient();
  var CFG = PUAuth.CONFIG;

  function $(id) { return document.getElementById(id); }

  function showAlert(message, kind) {
    var el = $('member-alert');
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

  /**
   * Load the signed-in member's row.
   * Prefers a future RPC (name in PUAuth.CONFIG.rpc.getMyMember when confirmed).
   * Falls back to selecting members by auth email — may fail until RLS allows it.
   */
  async function fetchMyMember(user) {
    var rpcName = CFG.rpc.getMyMember;
    if (rpcName) {
      try {
        var rpc = await client.rpc(rpcName);
        if (!rpc.error) return { data: rpc.data, error: null, via: 'rpc' };
        if (!PUAuth.isMissingDbObject(rpc.error)) {
          return { data: null, error: rpc.error, via: 'rpc' };
        }
      } catch (e) { /* fall through */ }
    }

    // Fallback: match members.email to the auth user email (no PII logged)
    var email = user && user.email;
    if (!email) return { data: null, error: { message: 'No email on account' }, via: 'none' };

    var cols = [
      'id', 'company_name', 'contact_person', 'email', 'continent', 'region',
      'country', 'city', 'website', 'status', 'membership_tier', 'renewal_date',
      'consent_at'
    ].join(',');

    var q = await client
      .from(CFG.tables.members)
      .select(cols)
      .eq('email', email)
      .maybeSingle();

    return { data: q.data, error: q.error, via: 'email' };
  }

  function renderMember(row, user) {
    setText('mp-company', row && row.company_name);
    setText('mp-contact', row && row.contact_person);
    setText('mp-email', (row && row.email) || (user && user.email) || '—');
    var loc = row
      ? [row.city, row.country, row.continent].filter(Boolean).join(', ')
      : '';
    setText('mp-location', loc);
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

    var st = $('mp-status');
    if (st) {
      st.textContent = '';
      if (row && row.status) {
        var badge = document.createElement('span');
        badge.className = 'member-badge is-' + row.status;
        badge.textContent = row.status;
        st.appendChild(badge);
      } else {
        st.textContent = '—';
      }
    }
    setText('mp-tier', row && row.membership_tier);
    setText('mp-renewal', row && row.renewal_date ? fmtDate(row.renewal_date) : '—');
    setText('mp-consent', row && row.consent_at ? ('Recorded ' + fmtDate(row.consent_at)) : 'Not recorded');
  }

  async function boot() {
    var gate = $('member-gate');
    $('member-signout-btn').addEventListener('click', function () {
      PUAuth.signOut(client);
    });

    var session = await PUAuth.getSession(client);
    if (!session) {
      location.replace(PUAuth.urlFor('signIn'));
      return;
    }

    // Admins who open /member/ still allowed, but offer no special admin UI here
    var user = await PUAuth.getUser(client);
    gate.hidden = true;
    $('member-content').hidden = false;

    var welcome = 'Signed in';
    // Do not put the email into the welcome line in screenshots/DOM if avoidable —
    // show company when we have it; otherwise a generic label.
    $('member-welcome').textContent = welcome;

    var result = await fetchMyMember(user);
    if (result.error) {
      if (PUAuth.isRlsError(result.error) || PUAuth.isMissingDbObject(result.error)) {
        showAlert(
          'Your account is signed in, but membership details are not available yet. The database may still be missing member self-read access.',
          'info'
        );
      } else {
        showAlert(PUAuth.friendlyAuthError(result.error, 'Could not load your membership details.'), 'error');
      }
      renderMember(null, user);
      return;
    }

    if (!result.data) {
      showAlert(
        'Signed in, but no membership record is linked to this account yet. An admin can connect your profile.',
        'info'
      );
      renderMember(null, user);
      return;
    }

    if (result.data.company_name) {
      $('member-welcome').textContent = result.data.company_name;
    }
    renderMember(result.data, user);
  }

  boot();
})();
