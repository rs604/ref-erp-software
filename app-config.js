/* ============================================================
   REF ERP — shared connection and session helper
   Loaded by every screen. Nothing else should hold the project
   address or the key.

   The security rule this file exists to enforce:
   every call to the server carries the SIGNED TOKEN of the person
   who is logged in. Nothing ever sends an employee id and asks the
   server to believe it. That was the hole in the old system.
   ============================================================ */

window.REF = (function () {
  'use strict';

  // --- Mumbai project -------------------------------------------------
  var SUPABASE_URL = 'https://deevokrufinihutrvnqw.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_YlH0hMd7PoKLUkk3GMZTOg_6nbRmVvS';

  // Drivers and shop-floor staff sign in with their employee number
  // rather than an email address they may not have. EMP-0014 becomes
  // emp-0014@refconveyors.net behind the scenes -- no lookup needed.
  var LOGIN_DOMAIN = 'refconveyors.net';

  var client = null;
  var cachedUser = null;

  function supabase() {
    if (!client) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('The Supabase library did not load. Check the connection and reload.');
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: 'ref-erp-session'
        }
      });
    }
    return client;
  }

  /* Turn whatever the person typed into the email Auth expects.
     "EMP-0014" -> "emp-0014@refconveyors.net"
     "rs@refconveyors.com" -> unchanged                              */
  function toLoginEmail(typed) {
    var v = String(typed || '').trim();
    if (v.indexOf('@') !== -1) return v.toLowerCase();
    return v.toLowerCase().replace(/\s+/g, '') + '@' + LOGIN_DOMAIN;
  }

  function signIn(typed, password) {
    return supabase().auth.signInWithPassword({
      email: toLoginEmail(typed),
      password: password
    });
  }

  function signOut() {
    cachedUser = null;
    return supabase().auth.signOut();
  }

  function sendPasswordReset(typed) {
    return supabase().auth.resetPasswordForEmail(toLoginEmail(typed), {
      redirectTo: window.location.origin + '/reset.html'
    });
  }

  function changePassword(newPassword) {
    cachedUser = null;
    return supabase().auth.updateUser({ password: newPassword });
  }

  function getSession() {
    return supabase().auth.getSession().then(function (r) {
      return r.data ? r.data.session : null;
    });
  }

  /* Every server call goes through here. The token is attached by this
     function and nowhere else, so no screen can forget it.            */
  function call(functionName, payload) {
    return getSession().then(function (session) {
      if (!session) {
        goToLogin();
        throw new Error('Not signed in');
      }
      return fetch(SUPABASE_URL + '/functions/v1/' + functionName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify(payload || {})
      }).then(function (res) {
        if (res.status === 401) {
          goToLogin();
          throw new Error('Your session has ended. Please sign in again.');
        }
        return res.json();
      });
    });
  }

  /* Who is signed in, and what may they do. Asked once, then reused. */
  function me(forceRefresh) {
    if (cachedUser && !forceRefresh) return Promise.resolve(cachedUser);
    return call('me', {}).then(function (data) {
      if (!data || !data.success) {
        throw new Error((data && data.error) || 'Could not load your account.');
      }
      cachedUser = data.user;
      return cachedUser;
    });
  }

  function can(user, permissionKey) {
    if (!user) return false;
    if (user.is_owner) return true;
    return (user.permissions || []).indexOf(permissionKey) !== -1;
  }

  function goToLogin() {
    if (window.location.pathname.indexOf('index.html') === -1 &&
        window.location.pathname !== '/' ) {
      window.location.href = 'index.html';
    }
  }

  /* Screens call this first. Sends anyone without a session back to the
     login page, and anyone who still has a starter password to the
     change-password screen before they can do anything else.          */
  function requireSession(options) {
    options = options || {};
    return getSession().then(function (session) {
      if (!session) {
        goToLogin();
        return null;
      }
      return me().then(function (user) {
        if (user.must_change_password && !options.allowStarterPassword) {
          window.location.href = 'reset.html?first=1';
          return null;
        }
        return user;
      });
    });
  }

  return {
    URL: SUPABASE_URL,
    KEY: SUPABASE_KEY,
    supabase: supabase,
    toLoginEmail: toLoginEmail,
    signIn: signIn,
    signOut: signOut,
    sendPasswordReset: sendPasswordReset,
    changePassword: changePassword,
    getSession: getSession,
    call: call,
    me: me,
    can: can,
    requireSession: requireSession,
    goToLogin: goToLogin
  };
})();
