import Link from "next/link";
export default function NotFound() {
  return (
    <div className="card p-8 max-w-md mx-auto text-center">
      <h1 className="text-xl font-bold">We couldn&apos;t find that</h1>
      <p className="muted mt-2">Check the Sleeper username and try again.</p>
      <Link href="/" className="btn inline-block mt-5">Back</Link>
    </div>
  );
}
