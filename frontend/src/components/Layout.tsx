import type { ReactNode } from "react";
import { NavBar } from "./NavBar";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div>
      <NavBar />
      <main style={{ padding: "1.5rem" }}>{children}</main>
    </div>
  );
}
