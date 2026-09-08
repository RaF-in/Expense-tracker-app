import { useEffect, useState } from "react";

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
