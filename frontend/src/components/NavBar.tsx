import { NavLink } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { getInitials } from "../auth/initials";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/expenses", label: "Expenses" },
  { to: "/settings", label: "Settings" },
];

export function NavBar() {
  const { user, logout } = useAuth0();
  const initials = getInitials(user);

  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
        padding: "0.75rem 1.5rem",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <strong>Expense Tracker</strong>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          style={({ isActive }) => ({
            color: isActive ? "var(--color-accent)" : "var(--color-text)",
            textDecoration: "none",
          })}
        >
          {link.label}
        </NavLink>
      ))}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        {initials ? (
          <div
            aria-label="user avatar"
            title={user?.email ?? user?.name ?? undefined}
            style={{
              width: "2rem",
              height: "2rem",
              borderRadius: "50%",
              background: "var(--color-accent)",
              color: "var(--color-surface)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            {initials}
          </div>
        ) : (
          // getInitials() returned null (no name, no email): a generic person
          // icon — the avatar is never blank (R5).
          <svg
            aria-label="user avatar"
            width="2rem"
            height="2rem"
            viewBox="0 0 24 24"
            fill="none"
            style={{ borderRadius: "50%", background: "var(--color-border)" }}
          >
            <circle cx="12" cy="8.5" r="3.5" fill="var(--color-text)" />
            <path
              d="M4.5 20c1.2-3.5 4.1-5.2 7.5-5.2s6.3 1.7 7.5 5.2"
              stroke="var(--color-text)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        )}
        {/* Ends the Auth0 session too, not just the local one — clearing
            local tokens alone leaves the Auth0 session cookie alive, and the
            next sign-in is silent, which reads as broken logout (R9). */}
        <button
          onClick={() =>
            logout({ logoutParams: { returnTo: window.location.origin } })
          }
          style={{ padding: "0.3rem 0.9rem", cursor: "pointer" }}
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
