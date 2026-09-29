import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-neutral-600">
        This URL is not part of the WordPress automation dashboard.
      </p>
      <Link href="/" className="text-blue-600 underline hover:no-underline">
        Back to dashboard
      </Link>
    </main>
  );
}
