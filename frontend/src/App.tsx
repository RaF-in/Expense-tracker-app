import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Expenses } from "./pages/Expenses";
import { LoginError } from "./pages/LoginError";
import { Settings } from "./pages/Settings";

export function App() {
  return (
    <Routes>
      {/* The ONLY public route. It sits outside ProtectedRoute on purpose:
          a gated error screen is a redirect loop. */}
      <Route path="/login-error" element={<LoginError />} />

      {/* The gate wraps the chrome (ARCH A17): NavBar renders structurally
          inside ProtectedRoute, so no nav link can appear before auth
          resolves. Layout hosts an <Outlet /> for the pages below. */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
