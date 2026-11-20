import Link from "next/link";

export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link className="text-primary hover:underline" href="/dashboard">Go to dashboard</Link>
    </main>
  );
}
