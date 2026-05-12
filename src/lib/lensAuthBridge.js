// src/lib/lensAuthBridge.js
// Last updated: 2026-05-12
//
// Cross-iframe Supabase session bridge with APP BUILDER (lens repo).
// When this app is loaded inside APP BUILDER's canvas pane, WKWebView
// partitions iframe storage by parent origin, so localStorage-based
// session persistence doesn't survive APP BUILDER restarts. This shim
// fixes that by relaying the session through the parent frame, which
// stores it in its own SQLite (stable across restarts).
//
// Protocol (matches src/authBridge.ts in the lens repo):
//   parent → iframe: { type: "lens-auth-session", session }
//   iframe → parent: { type: "lens-auth-request" }              (boot)
//   iframe → parent: { type: "lens-auth-session", session }     (on change)
//
// When the app is opened standalone in a browser (no parent frame),
// this module is a no-op and the normal localStorage flow is used.

import { supabase } from './supabase';

const inIframe = typeof window !== 'undefined' && window.parent !== window;

// Guard so this only ever wires up once per page load.
let installed = false;

export function installLensAuthBridge() {
  if (installed || !inIframe) return;
  installed = true;

  // 1. Listen for the parent's session push and hydrate Supabase with it
  //    before any UI tries to read auth state.
  window.addEventListener('message', async (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'lens-auth-session') return;
    const session = data.session;
    try {
      if (session && session.access_token && session.refresh_token) {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      }
      // If session is null, we intentionally do nothing — let the app's
      // own login flow run normally. (Wiping the local session on every
      // boot would be more aggressive than necessary.)
    } catch (err) {
      console.warn('[lens-auth] setSession failed:', err);
    }
  });

  // 2. On boot, ask the parent for the latest session it has on disk.
  try {
    window.parent.postMessage({ type: 'lens-auth-request' }, '*');
  } catch (err) {
    console.warn('[lens-auth] request to parent failed:', err);
  }

  // 3. Whenever this app's auth state changes (login, token refresh,
  //    logout), push the new session up to the parent so the next cold
  //    launch can replay it.
  supabase.auth.onAuthStateChange((_event, session) => {
    try {
      window.parent.postMessage(
        { type: 'lens-auth-session', session },
        '*',
      );
    } catch (err) {
      console.warn('[lens-auth] push to parent failed:', err);
    }
  });
}
