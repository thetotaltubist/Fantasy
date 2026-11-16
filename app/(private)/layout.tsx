import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AUTH_COOKIE, tokenFor, same } from "@/lib/auth";

// Every page in this folder requires the site password.
export const dynamic = "force-dynamic";

export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const password = process.env.SITE_PASSWORD;
  if (password) {
    const cookie = (await cookies()).get(AUTH_COOKIE)?.value ?? "";
    if (!same(cookie, await tokenFor(password))) redirect("/login");
  } else if (process.env.NODE_ENV === "production") {
    redirect("/login"); // No password set on the server: stay locked.
  }
  return <>{children}</>;
}
