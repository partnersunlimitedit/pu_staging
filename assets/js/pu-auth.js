/* Partners Unlimited — shared portal auth (TEST project).
   Function/table names live here so PU Data renames are one-line edits.
   Never log emails, passwords, or member personal data. */
(function (global) {
  'use strict';

  var CONFIG = {
    supabaseUrl: 'https://vcugotjdsurpbntuxgcf.supabase.co',
    // Publishable (anon) key only — never a service-role key
    supabaseKey: 'sb_publishable_uG8N8yNJLHLz3PhzbGNJQg_HT_It5r8',
    storageKey: 'pu-portal-auth',
    // RPC / table names — change here if PU Data renames them
    rpc: {
      isAdmin: 'is_admin',
      // Admin members (SECURITY DEFINER — use these for private cols + all writes)
      adminListMembers: 'admin_list_members',
      adminGetMember: 'admin_get_member',
      adminInsertMember: 'admin_insert_member',
      adminUpdateMember: 'admin_update_member',
      adminSetConsent: 'admin_set_consent',
      adminHideMember: 'admin_hide_member',
      adminRemoveMember: 'admin_remove_member',
      // Admin users
      adminListUsers: 'admin_list_users',
      adminSetAdmin: 'admin_set_admin'
      // Member self-read (not confirmed yet)
      // getMyMember: 'get_my_member'
    },
    tables: {
      profiles: 'profiles',
      members: 'members'
    },
    // Paths from site root (no leading slash — works on GitHub Pages subpath)
    paths: {
      signIn: 'member-area.html',
      adminMembers: 'admin/members.html',
      memberHome: 'member/index.html',
      admins: 'admin/admins.html'
    }
  };

  function siteRootPrefix() {
    var body = document.body;
    if (body && body.getAttribute('data-pu-root') != null) {
      return body.getAttribute('data-pu-root') || '';
    }
    // Fallback: infer from pathname depth under known folders
    var path = location.pathname || '';
    if (/\/admin(?:\/|$)/.test(path) || /\/member(?:\/|$)/.test(path)) return '../';
    return '';
  }

  function urlFor(pathKey) {
    var rel = CONFIG.paths[pathKey];
    if (!rel) return siteRootPrefix();
    return siteRootPrefix() + rel;
  }

  function createClient() {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      throw new Error('Supabase JS not loaded');
    }
    return supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: CONFIG.storageKey
      }
    });
  }

  function isMissingDbObject(err) {
    if (!err) return false;
    var code = String(err.code || '');
    var msg = String(err.message || '').toLowerCase();
    return code === 'PGRST202' || code === '42883' || code === '42P01' ||
      msg.indexOf('could not find the function') !== -1 ||
      msg.indexOf('does not exist') !== -1 ||
      msg.indexOf('schema cache') !== -1;
  }

  function isRlsError(err) {
    if (!err) return false;
    var code = String(err.code || '');
    var msg = String(err.message || err.error_description || '').toLowerCase();
    return code === '42501' || code === 'PGRST301' ||
      msg.indexOf('row-level security') !== -1 ||
      msg.indexOf('permission denied') !== -1 ||
      msg.indexOf('not authorized') !== -1 ||
      (msg.indexOf('jwt') !== -1 && msg.indexOf('denied') !== -1) ||
      msg.indexOf('policy') !== -1;
  }

  function errorCode(err) {
    return String((err && (err.code || err.error_code)) || '');
  }

  function friendlyAuthError(err, fallback) {
    if (!err) return fallback || 'Something went wrong. Please try again.';
    var code = errorCode(err);
    // Branch on PostgREST/Postgres error.code (not HTTP status)
    if (code === '42501') {
      return 'You are not authorized to do that. Admin access is required.';
    }
    if (code === '23514') {
      return 'Consent is required before a member can be active. Tick “Member has agreed to be listed”, or use Approve (which records consent).';
    }
    if (code === '22023') {
      return 'That status is not valid. Use pending, active, or removed.';
    }
    if (code === 'P0002') {
      return 'Record not found. It may have been removed, or the user has no login yet.';
    }
    if (code === '55000') {
      return 'That change is not allowed: you cannot remove or demote the last remaining admin.';
    }
    if (isMissingDbObject(err)) {
      return 'A required database function is not available yet. Please try again later.';
    }
    if (isRlsError(err)) {
      return 'You are not authorized to do that. Admin access is required.';
    }
    var msg = String(err.message || err.error_description || '');
    if (/invalid login|invalid credentials|email not confirmed/i.test(msg)) {
      return 'Sign-in failed. Check your email and password, or ask an admin to enable your account.';
    }
    if (/signups not allowed|user not found|unable to validate/i.test(msg)) {
      return 'No account found for that email. Ask an admin to invite you first.';
    }
    if (/otp|magic|rate limit|email rate/i.test(msg)) {
      return 'Could not send a sign-in link. Wait a moment and try again.';
    }
    return fallback || 'Something went wrong. Please try again.';
  }

  async function getSession(client) {
    var res = await client.auth.getSession();
    return res && res.data ? res.data.session : null;
  }

  async function getUser(client) {
    var res = await client.auth.getUser();
    return res && res.data ? res.data.user : null;
  }

  /**
   * Returns true if the signed-in user is an admin.
   * Tries CONFIG.rpc.isAdmin first; falls back to profiles.role === 'admin'.
   * Missing RPCs/tables are treated as "not admin" (not a hard failure).
   */
  async function checkIsAdmin(client) {
    var rpcName = CONFIG.rpc.isAdmin;
    if (rpcName) {
      try {
        var rpc = await client.rpc(rpcName);
        if (!rpc.error) {
          if (typeof rpc.data === 'boolean') return rpc.data;
          if (rpc.data != null) return !!rpc.data;
        } else if (!isMissingDbObject(rpc.error) && !isRlsError(rpc.error)) {
          // Unexpected error — still try profiles fallback
        }
      } catch (e) { /* fall through */ }
    }

    try {
      var user = await getUser(client);
      if (!user) return false;
      var q = await client
        .from(CONFIG.tables.profiles)
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (q.error) return false;
      return !!(q.data && String(q.data.role).toLowerCase() === 'admin');
    } catch (e) {
      return false;
    }
  }

  async function routeAfterSignIn(client) {
    var admin = await checkIsAdmin(client);
    location.replace(admin ? urlFor('adminMembers') : urlFor('memberHome'));
  }

  async function signOut(client) {
    try { await client.auth.signOut(); } catch (e) { /* ignore */ }
    location.replace(urlFor('signIn'));
  }

  function magicLinkRedirectTo() {
    // Prefer current origin + site path to member-area (works locally and on Pages)
    try {
      var u = new URL(location.href);
      // Climb out of /admin or /member if needed
      var path = u.pathname.replace(/\/admin\/.*$/, '/').replace(/\/member\/.*$/, '/');
      if (!/\/$/.test(path) && path.indexOf('.html') !== -1) {
        path = path.replace(/[^/]+$/, '');
      }
      return u.origin + path + CONFIG.paths.signIn;
    } catch (e) {
      return location.origin + '/' + CONFIG.paths.signIn;
    }
  }

  global.PUAuth = {
    CONFIG: CONFIG,
    siteRootPrefix: siteRootPrefix,
    urlFor: urlFor,
    createClient: createClient,
    isMissingDbObject: isMissingDbObject,
    isRlsError: isRlsError,
    errorCode: errorCode,
    friendlyAuthError: friendlyAuthError,
    getSession: getSession,
    getUser: getUser,
    checkIsAdmin: checkIsAdmin,
    routeAfterSignIn: routeAfterSignIn,
    signOut: signOut,
    magicLinkRedirectTo: magicLinkRedirectTo
  };
})(typeof window !== 'undefined' ? window : this);
