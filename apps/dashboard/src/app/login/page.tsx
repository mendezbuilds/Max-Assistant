export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <form
        action="/api/login"
        method="POST"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl"
      >
        <h1 className="mb-1 text-xl font-semibold text-neutral-50">Max</h1>
        <p className="mb-6 text-sm text-neutral-400">Enter the dashboard password to continue.</p>

        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          className="mb-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
        />

        {error && (
          <p className="mb-3 text-sm text-red-400">Wrong password. Try again.</p>
        )}

        <button
          type="submit"
          className="w-full rounded-lg bg-neutral-50 px-3 py-2 font-medium text-neutral-950 transition hover:bg-neutral-200"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
