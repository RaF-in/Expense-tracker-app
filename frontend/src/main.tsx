import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { App } from "./App";
import "./styles/theme.css";

// Provider order is load-bearing (ARCH A17): BrowserRouter wraps AuthProvider
// so onRedirectCallback's useNavigate works. The reverse order compiles fine
// and throws only at the end of every login.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
