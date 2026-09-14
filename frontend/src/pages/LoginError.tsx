import { useAuth0 } from "@auth0/auth0-react";
import { useNavigate } from "react-router-dom";

// Public route (the only one — REQ: no public page other than this screen and
// Auth0's own hosted login). It must NOT sit inside ProtectedRoute: a gated
// error screen is a redirect loop.
//
// This screen never displays raw Auth0 error text — it was already
// console.error'd by ProtectedRoute. Users get a plain message and an action.
export function LoginError() {
  const { loginWithRedirect } = useAuth0();
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "1rem",
        padding: "1.5rem",
        textAlign: "center",
      }}
    >
      <h1>Sign-in failed</h1>
      <p>Something went wrong while signing you in. This is usually temporary.</p>
      {/* Deliberately a manual retry, never automatic — auto-retry traps a
          user who deliberately backed out of the login screen (REQ decision 9). */}
      <button
        onClick={() =>
          loginWithRedirect({
            appState: { returnTo: "/dashboard" },
          })
            // If login cannot even be restarted, going home re-enters the
            // gate, which retries login anyway — same outcome, one code path.
            .catch(() => navigate("/"))
        }
        style={{ padding: "0.5rem 1.25rem" }}
      >
        Try again
      </button>
    </div>
  );
}
