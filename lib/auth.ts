// Simple single-password login. The password lives in the SITE_PASSWORD
// environment variable (set on Netlify, never in the code).
export const AUTH_COOKIE = "fhq_auth";

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`fantasy-hq:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string comparison.
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
