import { redirect } from "next/navigation";

export default async function Go({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const { u } = await searchParams;
  redirect(u?.trim() ? `/sleeper/${encodeURIComponent(u.trim())}` : "/");
}
