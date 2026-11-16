import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, tokenFor, same } from "@/lib/auth";

async function signIn(formData: FormData) {
  "use server";
  const password = process.env.SITE_PASSWORD ?? "";
  const given = String(formData.get("password") ?? "");
  let next = String(formData.get("next") ?? "/");
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";
  if (!password || !same(await tokenFor(given), await tokenFor(password))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(AUTH_COOKIE, await tokenFor(password), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", maxAge: 60 * 60 * 24 * 90,
  });
  redirect(next);
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <div className="max-w-sm mx-auto pt-12">
      <form action={signIn} className="card p-6">
        <h1 className="text-xl font-bold">Sign in</h1>
        <p className="muted text-sm mt-1">This site is private.</p>
        <input type="hidden" name="next" value={next ?? "/"} />
        <label htmlFor="pw" className="block font-semibold mt-5">Password</label>
        <input id="pw" name="password" type="password" required autoFocus
          className="mt-2 w-full rounded-[10px] border line px-3 py-2 bg-transparent" />
        {error && <p className="text-sm text-red-500 mt-2">That password didn&apos;t match. Try again.</p>}
        <button className="btn mt-4 w-full">Sign in</button>
      </form>
    </div>
  );
}
