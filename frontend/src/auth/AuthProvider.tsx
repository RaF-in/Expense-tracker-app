import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Auth0Provider } from "@auth0/auth0-react";
import { config } from "../config";

// Provider order is fixed by ARCH A17: BrowserRouter -> AuthProvider -> App.
// This component sits INSIDE the router, which is what makes useNavigate in
// onRedirectCallback work — an AuthProvider outside BrowserRouter throws at
// the end of every login instead of navigating.

// onRedirectCallback restores the deep link (R2): the user who deep-linked to
// /expenses while logged out lands back on /expenses after login, not on the
// /dashboard the happy path shows. The returnTo value is written by
// ProtectedRoute's loginWithRedirect({ appState: { returnTo } }).
export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        // The audience MUST be passed here: without it Auth0 returns an
        // opaque token instead of a JWT, and the .NET middleware fails with
        // a signature error that gives no hint of the cause.
        audience: config.audience,
        // Without offline_access Auth0 issues no refresh token and session
        // continuity across reloads/expiry (R3/R7) cannot work.
        scope: "openid profile email offline_access",
      }}
      // A memory cache holds no refresh token across a page reload; R3 tests
      // exactly that. Rotation with reuse detection is the accepted
      // localStorage mitigation (ARCH A7).
      cacheLocation="localstorage"
      useRefreshTokens
      onRedirectCallback={(appState) => {
        navigate(appState?.returnTo ?? "/dashboard");
      }}
    >
      {children}
    </Auth0Provider>
  );
}
