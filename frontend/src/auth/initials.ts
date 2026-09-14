import type { User } from "@auth0/auth0-react";

// Pure user -> initials | null (R5). Never throws, never returns "" — a
// blank circle reads as broken UI, so the null return means "render the
// generic person icon" instead. The first thing that should get a unit test
// when the issue #6 harness lands.
//
// Chain: name -> email local-part -> null.
export function getInitials(user?: User): string | null {
  const name = user?.name?.trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    const first = words[0]?.[0] ?? "";
    const second = words[1]?.[0] ?? "";
    const initials = (first + second).toUpperCase();
    if (initials) return initials;
  }

  const email = user?.email?.trim();
  if (email) {
    const localPart = email.split("@")[0] ?? "";
    // Split the local part on the usual separators so "jane.doe" reads as
    // JD, and fall back to the first character for an opaque local part.
    const parts = localPart.split(/[._\-+]/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const second = parts[1]?.[0] ?? "";
    const initials = (first + second).toUpperCase();
    if (initials) return initials;
  }

  return null;
}
