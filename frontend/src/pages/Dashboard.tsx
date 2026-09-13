import { useEffect, useState } from "react";

// NOTE: this health check is deliberately UNAUTHENTICATED and stays outside
// useApi() (ARCH A3) — routing it through auth would make a dead API and an
// auth failure produce the same on-screen symptom, destroying the diagnostic
// value of the app's only diagnostic. Also, since T4's route gate, this
// component mounts only AFTER login: a call that used to fire on page load
// now fires post-authentication. Both facts are intentional — don't "fix"
// either.

type Status = "loading" | "connected" | "failed";

export function Dashboard() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json();
      })
      .then(() => {
        if (!cancelled) setStatus("connected");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {status === "loading" && <p>Checking API connection…</p>}
      {status === "connected" && <p>Connected to API ✓</p>}
      {status === "failed" && <p>Connection failed</p>}
    </div>
  );
}
