// Small private key-value store for connection tokens.
// On Netlify this uses Netlify Blobs (server-side, never sent to the browser).
// Running locally without Netlify, it falls back to memory.
import { getStore } from "@netlify/blobs";

const memory = new Map<string, string>();

function store() {
  try { return getStore("connections"); } catch { return null; }
}

export async function getSecret(key: string): Promise<string | null> {
  const s = store();
  if (!s) return memory.get(key) ?? null;
  try { return (await s.get(key, { type: "text" })) ?? null; } catch { return memory.get(key) ?? null; }
}

export async function setSecret(key: string, value: string): Promise<void> {
  const s = store();
  if (s) { try { await s.set(key, value); return; } catch { /* fall through */ } }
  memory.set(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  const s = store();
  if (s) { try { await s.delete(key); } catch { /* ignore */ } }
  memory.delete(key);
}
