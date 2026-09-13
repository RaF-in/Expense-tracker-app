import { useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";

// The single token-handling implementation issue #4 inherits (ARCH A9).
// pages/ must never call getAccessTokenSilently directly — that rule is what
// keeps the inheritance clean, and it is why this hook is the only file in
// the tree that mentions it.
//
// Refresh is PROACTIVE (ARCH A14): the token is acquired before every call,
// not reacted to after a 401. The SDK returns a cached token or exchanges the
// refresh token if expired, so the axios-interceptor retry machinery is
// already inside getAccessTokenSilently. This amends AC-11's wording to "a
// token request precedes the call, which then succeeds."
export function useApi(): (path: string, init?: RequestInit) => Promise<Response> {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();

  return useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      let token: string;
      try {
        token = await getAccessTokenSilently();
      } catch (error) {
        // The refresh token is revoked or expired (R8): send the user to
        // login rather than leave them on a broken page. Only *refresh*
        // failure redirects — HTTP 4xx/5xx responses are returned to the
        // caller unmodified, never retried, never redirected.
        console.error("Token acquisition failed; restarting login", error);
        void loginWithRedirect({
          appState: { returnTo: window.location.pathname },
        });
        // The page is navigating to Auth0; this promise intentionally never
        // settles so no caller renders an error state mid-redirect.
        return new Promise<Response>(() => {});
      }

      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(path, { ...init, headers });
    },
    [getAccessTokenSilently, loginWithRedirect],
  );
}
