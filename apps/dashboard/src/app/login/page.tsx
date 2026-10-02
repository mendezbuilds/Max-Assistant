import { IconBrain, IconLock } from "@tabler/icons-react";
import { Starfield } from "@/components/hq/Starfield";

/**
 * The front door, in the same visual language as the rest of MAX_OS: the deep-space
 * starfield with its two corner washes, the MAX core sphere (same gradient and
 * continuous morph as the orbit view, just small), the teal letter-spaced
 * MAX_OS // MENDEZ_EMPIRE_HQ wordmark, and amber (not red) for problems.
 *
 * A plain server component with a plain HTML form: no client JS needed to sign in,
 * so it loads as fast as anything in the app. (Starfield fills itself in after mount.)
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; left?: string; mins?: string }>;
}) {
  const { error, left, mins } = await searchParams;

  const locked = error === "locked";
  const wrong = error === "wrong" || error === "1"; // "1" = links from the old page
  const attemptsLeft = Number(left);

  return (
    <main className="starfield-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 text-slate-200">
      <Starfield />

      <div className="relative w-full max-w-sm rounded-2xl border border-jarvis-border bg-slate-950/70 p-7 shadow-[0_0_60px_rgba(20,184,166,0.07)] backdrop-blur-md">
        <p className="text-center font-mono text-xs font-semibold tracking-[0.18em] text-jarvis-cyan sm:text-sm">
          MAX_OS <span className="text-jarvis-dim">//</span> MENDEZ_EMPIRE_HQ
        </p>

        {/* The MAX core, small: same gradient + continuous liquid-metal morph as the orbit view. Purely decorative. */}
        <div className="my-7 flex justify-center" aria-hidden="true">
          <div
            className="max-core flex items-center justify-center"
            style={{ width: 84, height: 84, background: "radial-gradient(circle at 35% 30%, #4a7a80, #1a2a2c 75%)" }}
          >
            <IconBrain size={29} stroke={1.5} className="text-white/90" />
          </div>
        </div>

        <form action="/api/login" method="POST">
          <label htmlFor="password" className="mb-2 block font-mono text-[10px] tracking-[0.3em] text-jarvis-dim">
            ACCESS KEY
          </label>
          <div className="relative">
            <IconLock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-jarvis-dim" aria-hidden="true" />
            <input
              id="password"
              type="password"
              name="password"
              placeholder="••••••••"
              autoFocus
              autoComplete="current-password"
              disabled={locked}
              className="w-full rounded-lg border border-jarvis-border bg-slate-950/80 py-2.5 pl-9 pr-3 font-mono text-sm tracking-widest text-slate-100 outline-none transition placeholder:text-slate-700 focus:border-jarvis-cyan/70 focus:shadow-[0_0_0_3px_rgba(127,217,216,0.12)] disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          {/* Problems use the app's amber, not an alarming red */}
          {locked && (
            <p role="alert" className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-300">
              Too many attempts. Login is locked for {mins ? `${Number(mins)} minute${Number(mins) === 1 ? "" : "s"}` : "a while"}. Try again after that.
            </p>
          )}
          {wrong && (
            <p role="alert" className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-300">
              Wrong password.
              {Number.isFinite(attemptsLeft) && left !== undefined
                ? ` ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left before login locks for 15 minutes.`
                : " Try again."}
            </p>
          )}

          <button
            type="submit"
            disabled={locked}
            className="mt-4 w-full rounded-lg border border-jarvis-cyan/50 bg-jarvis-cyan/10 py-2.5 font-mono text-xs font-semibold tracking-[0.3em] text-jarvis-cyan transition hover:bg-jarvis-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            AUTHENTICATE
          </button>
        </form>
      </div>
    </main>
  );
}
