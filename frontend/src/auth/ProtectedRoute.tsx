import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";

// The three-state gate (ARCH A17). Auth state has THREE values, not two —
// authenticated, unauthenticated, and *not yet known*. Treating "not yet
// known" as unauthenticated produces a spurious redirect on every page load;
// treating it as authenticated flashes protected content to logged-out
// visitors. Only isLoading === false may be judged.
//
// This component does NOT render Layout itself: App.tsx nests it AROUND the
// chrome, which puts NavBar structurally inside the gate — there is no code
// path that renders nav links before auth resolves (R3 by shape, not memory).
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoading, error, isAuthenticated, loginWithRedirect } = useAuth0();
  const location = useLocation();
  const [redirectFailed, setRedirectFailed] = useState(false);

  useEffect(() => {
    if (isLoading || error || isAuthenticated) return;
    // The redirect MUST live in an effect, never in render: under React
    // StrictMode a render-time loginWithRedirect double-fires and loops.
    loginWithRedirect({
      appState: { returnTo: location.pathname },
    }).catch((redirectError) => {
      // If Auth0 itself can't be reached to start the redirect, don't leave
      // the visitor on a blank page forever — route them to the same
      // recoverable error screen a failed/cancelled login uses.
      console.error("Login redirect could not be started", redirectError);
      setRedirectFailed(true);
    });
  }, [isLoading, error, isAuthenticated, loginWithRedirect, location.pathname]);

  if (redirectFailed) {
    return <Navigate to="/login-error" replace />;
  }

  if (error) {
    // Raw Auth0 error text goes to the console for developers and is NEVER
    // rendered — users cannot act on "invalid_request" (REQ decision 9).
    console.error("Auth0 error", error);
    return <Navigate to="/login-error" replace />;
  }

  if (isLoading) {
    // Full-page loader: no dashboard content and no NavBar while resolving.
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <p>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect is in flight from the effect above; rendering children here
    // would flash protected chrome to a logged-out visitor.
    return null;
  }

  return children;
}
