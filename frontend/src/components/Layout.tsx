import { Outlet } from "react-router-dom";
import { NavBar } from "./NavBar";

// Layout no longer takes children: it is now a nested route element under
// ProtectedRoute (App.tsx), and the matched page renders through <Outlet />.
// The signature change is deliberate — a consumer still passing children
// renders nothing, and tsc -b catches it.
export function Layout() {
  return (
    <div>
      <NavBar />
      <main style={{ padding: "1.5rem" }}>
        <Outlet />
      </main>
    </div>
  );
}
