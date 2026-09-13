// Sole reader of window.__APP_CONFIG__ — no other module touches the global.
// The object is delivered at runtime, never built into the bundle: Vite bakes
// VITE_* values at build time, but the pod runs nginx while this code runs in
// the user's browser, so a Secret can never reach it through the bundle.
//
// In the cluster, docker-entrypoint.d/40-app-config.sh renders /config.js from
// the pod's AUTH0_* environment (secretKeyRef from k8s/secrets.yaml) at
// container start. For `npm run dev`, frontend/public/config.js is copied from
// frontend/config.js.template and filled in by hand.

export interface AppConfig {
  domain: string;
  clientId: string;
  audience: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

const requiredKeys: (keyof AppConfig)[] = ["domain", "clientId", "audience"];

function isBlank(value: string | undefined): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function isValidConfig(
  candidate: Partial<AppConfig> | undefined
): candidate is AppConfig {
  return !!candidate && requiredKeys.every((key) => !isBlank(candidate[key]));
}

const missing = requiredKeys.filter((key) => isBlank(window.__APP_CONFIG__?.[key]));

if (!isValidConfig(window.__APP_CONFIG__)) {
  // A blank value would otherwise fail much later, at Auth0, as an opaque
  // "invalid token" error. Fail here instead — as a plain message on the page,
  // never a white screen (main.tsx never runs when this module throws).
  showConfigurationError(missing);
  throw new Error(
    `Configuration error: window.__APP_CONFIG__ is missing or blank for: ${missing.join(", ")}. ` +
      "config.js was not rendered (cluster) or not copied from frontend/config.js.template (dev)."
  );
}

export const config: AppConfig = window.__APP_CONFIG__;

function showConfigurationError(missingKeys: string[]): void {
  const heading = document.createElement("h1");
  heading.textContent = "Configuration error";
  const detail = document.createElement("p");
  detail.textContent = `Missing or blank config.js value(s): ${missingKeys.join(", ")}.`;
  const hint = document.createElement("p");
  hint.textContent =
    "The frontend container or frontend/public/config.js must define domain, clientId and audience.";
  document.body.replaceChildren(heading, detail, hint);
  document.body.style.fontFamily = "system-ui, sans-serif";
}
