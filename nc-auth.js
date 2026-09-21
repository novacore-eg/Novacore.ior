/**
 * NovaCore — shared auth helpers for the public site's login/register/portal pages.
 * Include this file BEFORE any page-specific script:
 *   <script src="nc-auth.js"></script>
 */
(function (global) {
  // Same Apps Script Web App URL already used by the rest of the site.
  const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzm9FyZ2ct_4NbNummvyVge5N8kNHuiS1190DSQ8NPY553Pfp9Crnvt1EwtHUgcxEdpmA/exec';

  function ncUuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Fire-and-forget POST — mirrors the pattern already used by the candidate/feedback forms.
  function ncPostFireAndForget(payload) {
    return fetch(WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
  }

  // JSONP GET — mirrors the pattern already used for ?action=list.
  function ncJsonp(params) {
    return new Promise(function (resolve, reject) {
      const cbName = 'ncjsonp_' + ncUuid().replace(/-/g, '');
      const script = document.createElement('script');
      const timeout = setTimeout(function () {
        cleanup();
        reject(new Error('Request timed out.'));
      }, 8000);

      function cleanup() {
        clearTimeout(timeout);
        delete global[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      global[cbName] = function (data) {
        cleanup();
        resolve(data);
      };

      const query = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');

      script.src = WEB_APP_URL + '?' + query + '&callback=' + cbName;
      script.onerror = function () { cleanup(); reject(new Error('Network error.')); };
      document.body.appendChild(script);
    });
  }

  // POST an auth action (login / registerCandidate / createClient), then poll
  // for the real result via JSONP. Returns the final { ok, ... } payload.
  async function ncSubmitAuthAction(payload, maxAttempts) {
    maxAttempts = maxAttempts || 8;
    const requestId = ncUuid();
    payload.requestId = requestId;

    await ncPostFireAndForget(payload);

    let delay = 500;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(function (r) { setTimeout(r, delay); });
      const result = await ncJsonp({ action: 'poll', requestId: requestId });
      if (!result.pending) return result;
      delay = Math.min(delay * 1.4, 2000);
    }
    return { ok: false, error: 'Request took too long. Please try again.' };
  }

  // ---- Session storage (per-browser only; not shared, not sensitive beyond a 24h token) ----

  function ncSaveSession(session) {
    localStorage.setItem('nc_session', JSON.stringify(session));
  }

  function ncGetSession() {
    try {
      return JSON.parse(localStorage.getItem('nc_session') || 'null');
    } catch (e) {
      return null;
    }
  }

  function ncClearSession() {
    localStorage.removeItem('nc_session');
  }

  // Redirects to login.html if there's no session, or if the session's role
  // doesn't match. Returns the session object if valid — call this at the
  // top of every protected page. Also re-validates against the server so a
  // stale/forged localStorage entry can't be used after logout or expiry.
  async function ncRequireRole(requiredRole, loginPage) {
    loginPage = loginPage || 'login.html';
    const session = ncGetSession();
    if (!session || !session.token || session.role !== requiredRole) {
      window.location.href = loginPage;
      return null;
    }
    try {
      const who = await ncJsonp({ action: 'whoami', token: session.token });
      if (!who.ok || who.role !== requiredRole) {
        ncClearSession();
        window.location.href = loginPage;
        return null;
      }
      return session;
    } catch (e) {
      // network hiccup — don't boot the user out for that; proceed with cached session
      return session;
    }
  }

  async function ncLogout(redirectTo) {
    const session = ncGetSession();
    if (session && session.token) {
      try { await ncPostFireAndForget({ formType: 'logout', token: session.token }); } catch (e) {}
    }
    ncClearSession();
    window.location.href = redirectTo || 'login.html';
  }

  global.NovaAuth = {
    WEB_APP_URL: WEB_APP_URL,
    uuid: ncUuid,
    postFireAndForget: ncPostFireAndForget,
    jsonp: ncJsonp,
    submitAuthAction: ncSubmitAuthAction,
    saveSession: ncSaveSession,
    getSession: ncGetSession,
    clearSession: ncClearSession,
    requireRole: ncRequireRole,
    logout: ncLogout
  };
})(window);
