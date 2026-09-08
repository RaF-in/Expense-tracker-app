import { NavLink } from "react-router-dom";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/expenses", label: "Expenses" },
  { to: "/settings", label: "Settings" },
];

export function NavBar() {
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
        aria-label="avatar placeholder"
        style={{
          marginLeft: "auto",
          width: "2rem",
          height: "2rem",
          borderRadius: "50%",
          background: "var(--color-border)",
        }}
      />
    </nav>
  );
}
