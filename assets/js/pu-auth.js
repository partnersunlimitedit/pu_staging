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
      // Admin members
      adminListMembers: 'admin_list_members',
      adminGetMember: 'admin_get_member',
      adminInsertMember: 'admin_insert_member',
      adminUpdateMember: 'admin_update_member',
      adminRenewMember: 'admin_renew_member',
      adminSetMemberEmails: 'admin_set_member_emails',
      adminHideMember: 'admin_hide_member',
      adminRemoveMember: 'admin_remove_member',
      // Admin users / roles
      adminListUsers: 'admin_list_users',
      adminSetAdmin: 'admin_set_admin',
      isSuperAdmin: 'is_super_admin',
      adminSetUserName: 'admin_set_user_name',
      adminInviteAuthorize: 'admin_invite_authorize',
      adminRemoveAuthorize: 'admin_remove_authorize',
      // Member portal (owner + staff)
      myMembership: 'my_membership',
      myCompany: 'my_company',
      myEditRequests: 'my_edit_requests',
      ownerListStaff: 'owner_list_staff',
      ownerRemoveStaff: 'owner_remove_staff',
      ownerSubmitEdit: 'owner_submit_edit',
      ownerCancelEdit: 'owner_cancel_edit',
      // Admin edit review + member logins
      adminListEditRequests: 'admin_list_edit_requests',
      adminApproveEdit: 'admin_approve_edit',
      adminRejectEdit: 'admin_reject_edit',
      adminListMemberUsers: 'admin_list_member_users',
      adminLinkUser: 'admin_link_user',
      adminUnlinkUser: 'admin_unlink_user',
      adminSetOwner: 'admin_set_owner'
    },
    functions: {
      inviteAdmin: 'invite-admin',
      removeAdmin: 'remove-admin'
    },
    tables: {
      profiles: 'profiles',
      members: 'members'
    },
    // Paths from site root (no leading slash — works on GitHub Pages subpath)
    paths: {
      signIn: 'member-area.html',
      setPassword: 'member/set-password.html',
      memberHome: 'member/index.html',
      memberStaff: 'member/staff.html',
      adminMembers: 'admin/members.html',
      admins: 'admin/admins.html',
      pendingEdits: 'admin/pending-edits.html',
      adminAgm: 'admin/agm.html'
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
    var msg = String(err.message || err.error_description || '');
    // Branch on PostgREST/Postgres error.code (and edge-function body codes), not only HTTP status
    if (code === '42501') {
      return 'You are not authorized to do that.';
    }
    if (code === '23514') {
      return 'That value is not valid. Check the fields and try again.';
    }
    if (code === '22023') {
      if (/full_name must be at most 200/i.test(msg)) {
        return 'Name must be at most 200 characters.';
      }
      if (/valid email is required/i.test(msg)) {
        return 'Enter a valid email address.';
      }
      if (/p_user_id/i.test(msg) || /p_member_id/i.test(msg)) {
        return 'A required value is missing. Please try again.';
      }
      if (/term must be 1 to 5 years/i.test(msg)) {
        return 'Membership term must be 1 to 5 years.';
      }
      if (/cannot clear and set expiry/i.test(msg)) {
        return 'You cannot clear the expiry and set a new date or term in the same change.';
      }
      if (/choose expired or missing/i.test(msg)) {
        return 'Choose expired or missing expiry, not both.';
      }
      if (/p_order/i.test(msg)) {
        return 'That sort order is not valid.';
      }
      return 'That value is not valid. Check the fields (for example name, email, location, status, expiry or term) and try again.';
    }
    if (code === 'P0002') {
      if (/must sign up|have a login first/i.test(msg)) {
        return 'This person does not have a login yet. Invite them as an admin first.';
      }
      return 'Record not found. It may have been removed, or the person has no login yet.';
    }
    if (code === '55000') {
      if (/cannot demote the super admin/i.test(msg)) {
        return 'The super admin cannot be demoted.';
      }
      if (/cannot remove the super admin/i.test(msg)) {
        return 'The super admin cannot be removed.';
      }
      if (/cannot invite the super admin/i.test(msg)) {
        return 'The super admin account cannot be invited.';
      }
      if (/cannot remove the last remaining admin/i.test(msg)) {
        return 'You cannot remove the last remaining admin.';
      }
      if (/user is not an admin/i.test(msg)) {
        return 'That login is not an admin.';
      }
      return 'That change is not allowed in the current state. The company may be removed, already have an owner, or this would remove the company owner or the last admin.';
    }
    if (code === 'invite_failed') {
      return 'The invite could not be sent. Please try again.';
    }
    if (code === 'disable_failed') {
      return 'Admin access was revoked, but the login could not be disabled. Try removing this admin again.';
    }
    if (code === 'PU001') {
      return 'This company already has 5 staff logins. Remove one to add another.';
    }
    if (code === 'PU002') {
      return 'An edit is already waiting for review. Cancel it, or wait for an admin to decide, before submitting another.';
    }
    if (code === 'PU003') {
      return 'This edit request has already been approved, rejected or cancelled.';
    }
    if (code === 'PU004') {
      return 'This login already belongs to another company.';
    }
    if (isMissingDbObject(err)) {
      return 'A required database function is not available yet. Please try again later.';
    }
    if (isRlsError(err)) {
      return 'You are not authorized to do that.';
    }
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

  /**
   * Returns true if the signed-in user is the pinned super admin.
   * Returns false when not signed in, or if the RPC is missing / unauthorized.
   */
  async function checkIsSuperAdmin(client) {
    var rpcName = CONFIG.rpc.isSuperAdmin;
    if (!rpcName) return false;
    try {
      var rpc = await client.rpc(rpcName);
      if (!rpc.error) {
        if (typeof rpc.data === 'boolean') return rpc.data;
        if (rpc.data != null) return !!rpc.data;
      }
    } catch (e) { /* treat as not super admin */ }
    return false;
  }

  function firstRpcRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  /**
   * Invoke a Supabase Edge Function with the signed-in user's JWT.
   * Normalizes non-2xx JSON bodies ({ ok:false, code, message }) into err.code.
   */
  async function invokeFunction(client, name, body) {
    var res;
    try {
      res = await client.functions.invoke(name, { body: body || {} });
    } catch (e) {
      return { data: null, error: e };
    }
    if (!res.error) {
      return { data: res.data, error: null };
    }
    var err = res.error;
    var payload = null;
    try {
      if (res.data && typeof res.data === 'object') {
        payload = res.data;
      } else if (err.context && typeof err.context.json === 'function') {
        payload = await err.context.json();
      } else if (err.context && typeof err.context.clone === 'function') {
        payload = await err.context.clone().json();
      }
    } catch (e) { /* body may be empty */ }
    var status = 0;
    try {
      status = Number((err.context && err.context.status) || err.status || 0);
    } catch (e2) { status = 0; }
    var code = (payload && (payload.code || payload.error_code)) || err.code || '';
    var message = (payload && (payload.message || payload.error)) || err.message || 'Function failed';
    if (!code && (status === 401 || status === 403)) code = '42501';
    return {
      data: null,
      error: { code: String(code), message: String(message), status: status, raw: payload || null }
    };
  }

  async function applyAdminChrome(client, opts) {
    opts = opts || {};
    var isSuper = opts.isSuperAdmin;
    if (typeof isSuper !== 'boolean') {
      isSuper = await checkIsSuperAdmin(client);
    }
    document.querySelectorAll('[data-admin-nav="admins"]').forEach(function (el) {
      el.hidden = !isSuper;
    });
    document.querySelectorAll('[data-admin-dash="admins"]').forEach(function (el) {
      el.hidden = !isSuper;
    });
    var link = document.getElementById('admin-my-company');
    if (link) {
      try {
        var mem = await client.rpc(CONFIG.rpc.myMembership);
        var row = (!mem.error) ? firstRpcRow(mem.data) : null;
        link.hidden = !row;
      } catch (e) {
        link.hidden = true;
      }
    }
    return isSuper;
  }

  async function applyMemberChrome(client) {
    var link = document.getElementById('nav-admin');
    if (!link) return false;
    var ok = false;
    try { ok = await checkIsAdmin(client); } catch (e) { ok = false; }
    link.hidden = !ok;
    return ok;
  }

  async function routeAfterSignIn(client) {
    var admin = await checkIsAdmin(client);
    location.replace(admin ? urlFor('adminMembers') : urlFor('memberHome'));
  }

  async function signOut(client) {
    try { await client.auth.signOut(); } catch (e) { /* ignore */ }
    location.replace(urlFor('signIn'));
  }

  function siteBaseUrl() {
    try {
      var u = new URL(location.href);
      var path = u.pathname.replace(/\/admin\/.*$/, '/').replace(/\/member\/.*$/, '/');
      if (!/\/$/.test(path) && path.indexOf('.html') !== -1) {
        path = path.replace(/[^/]+$/, '');
      }
      return u.origin + path;
    } catch (e) {
      return location.origin + '/';
    }
  }

  function absoluteUrlFor(pathKey) {
    var rel = CONFIG.paths[pathKey] || '';
    return siteBaseUrl() + rel;
  }

  function omitUndefined(args) {
    var out = {};
    Object.keys(args || {}).forEach(function (k) {
      if (args[k] !== undefined) out[k] = args[k];
    });
    return out;
  }

  /**
   * admin_list_members with optional named filters.
   * A call with no opts (or all defaults) is a no-arg RPC, same as today.
   * Never sends expired_only and missing_renewal_only together.
   */
  async function adminListMembers(client, opts) {
    opts = opts || {};
    var args = {};
    if (opts.p_renewal_on_or_before) args.p_renewal_on_or_before = opts.p_renewal_on_or_before;
    if (opts.p_renewal_on_or_after) args.p_renewal_on_or_after = opts.p_renewal_on_or_after;
    if (opts.p_expired_only && opts.p_missing_renewal_only) {
      return {
        data: null,
        error: { code: '22023', message: 'choose expired or missing, not both' }
      };
    }
    if (opts.p_expired_only) args.p_expired_only = true;
    if (opts.p_missing_renewal_only) args.p_missing_renewal_only = true;
    if (opts.p_order && opts.p_order !== 'id') args.p_order = opts.p_order;
    if (!Object.keys(args).length) {
      return client.rpc(CONFIG.rpc.adminListMembers);
    }
    return client.rpc(CONFIG.rpc.adminListMembers, args);
  }

  async function adminInsertMember(client, args) {
    return client.rpc(CONFIG.rpc.adminInsertMember, omitUndefined(args));
  }

  async function adminUpdateMember(client, args) {
    return client.rpc(CONFIG.rpc.adminUpdateMember, omitUndefined(args));
  }

  async function adminRenewMember(client, memberId, termYears) {
    return client.rpc(CONFIG.rpc.adminRenewMember, {
      p_member_id: Number(memberId),
      p_term_years: Number(termYears)
    });
  }

  function magicLinkRedirectTo() {
    return absoluteUrlFor('signIn');
  }

  function setPasswordRedirectTo() {
    return absoluteUrlFor('setPassword');
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
    checkIsSuperAdmin: checkIsSuperAdmin,
    invokeFunction: invokeFunction,
    applyAdminChrome: applyAdminChrome,
    applyMemberChrome: applyMemberChrome,
    routeAfterSignIn: routeAfterSignIn,
    signOut: signOut,
    siteBaseUrl: siteBaseUrl,
    absoluteUrlFor: absoluteUrlFor,
    magicLinkRedirectTo: magicLinkRedirectTo,
    setPasswordRedirectTo: setPasswordRedirectTo,
    adminListMembers: adminListMembers,
    adminInsertMember: adminInsertMember,
    adminUpdateMember: adminUpdateMember,
    adminRenewMember: adminRenewMember
  };
})(typeof window !== 'undefined' ? window : this);
