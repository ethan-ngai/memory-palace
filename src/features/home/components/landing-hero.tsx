import { Link } from "@tanstack/react-router";
import { ButtonLink } from "@/components/ui/button";
import type { HomeState } from "@/features/home/types";

/**
 * Renders the marketing landing experience for the public home route.
 * @param props - Lightweight auth-aware state used to tailor the primary call to action.
 * @returns A responsive hero and feature grid introducing the product.
 */
export function LandingHero({ homeState }: { homeState: HomeState }) {
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
      <article className="surface-spotlight relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_28px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl md:p-10">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        <div className="mt-8 max-w-3xl">
          <h1 className="m-0 text-5xl font-semibold leading-none tracking-[-0.04em] text-transparent md:text-7xl">
            <span className="text-gradient">Humans were built to remember</span>{" "}
            <span className="accent-gradient">places, not flashcards.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--foreground-muted)] md:text-lg">
            <span className="font-semibold text-[var(--foreground)]">Loci</span> turns your study
            material into a{" "}
            <span className="font-semibold text-[var(--foreground)]">
              3D world you walk through
            </span>{" "}
            — because your brain was wired for places long before it was asked to memorize lists.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/play">
            {homeState.isAuthenticated ? "Open Your Palace" : "Build Your Palace"}
          </ButtonLink>
          <Link
            className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition duration-200 ease-out hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.08]"
            to="/login"
          >
            Sign In
          </Link>
        </div>

        {/* Stat cards — typographic anchors */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20 p-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-3 -right-1 select-none text-[5.5rem] font-bold leading-none tracking-tight text-white/[0.035]"
            >
              yr
            </div>
            <div className="relative">
              <div className="text-[1.75rem] font-bold leading-none tracking-tight text-[var(--foreground)]">
                2,000
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-[var(--foreground-subtle)]">
                years proven
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--foreground-muted)]">
                The method of loci has been trusted by memory champions since ancient Greece.
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20 p-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-3 -right-1 select-none text-[5.5rem] font-bold leading-none tracking-tight text-white/[0.035]"
            >
              mn
            </div>
            <div className="relative">
              <div className="text-[1.75rem] font-bold leading-none tracking-tight text-[var(--foreground)]">
                &lt;&nbsp;2min
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-[var(--foreground-subtle)]">
                to your palace
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--foreground-muted)]">
                Paste notes or upload a PDF. Your palace is ready to explore immediately.
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20 p-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-3 -right-1 select-none text-[5.5rem] font-bold leading-none tracking-tight text-[var(--accent)]/10"
            >
              ×
            </div>
            <div className="relative">
              <div className="accent-gradient text-[1.75rem] font-bold leading-none tracking-tight">
                3×
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-[var(--foreground-subtle)]">
                better recall
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--foreground-muted)]">
                Spatial memory outperforms rote repetition. Your brain already knows how to do this.
              </p>
            </div>
          </div>
        </div>
      </article>

      <aside className="grid gap-6 grid-rows-[auto_1fr]">
        {/* Manifesto */}
        <div className="surface-spotlight rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] px-8 py-7 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_24px_64px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--foreground-subtle)]">
            The idea
          </p>
          <h2 className="mt-4 text-[1.3rem] font-semibold leading-[1.4] tracking-tight text-[var(--foreground)]">
            Your brain never forgot how to navigate. It just never had anything worth exploring.
          </h2>
        </div>

        {/* Journey steps */}
        <div className="surface-spotlight rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] px-8 py-7 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--foreground-subtle)]">
            How it works
          </p>

          <div className="mt-6 space-y-7">
            <div className="flex items-start gap-5">
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-[2.25rem] font-bold leading-none tracking-tight text-white/[0.12]"
              >
                01
              </span>
              <div>
                <p className="text-sm font-semibold leading-snug text-[var(--foreground)]">
                  Drop in your material
                </p>
                <p className="mt-1.5 text-xs leading-5 text-[var(--foreground-muted)]">
                  Paste notes or upload a PDF. Any subject, any format — ready in seconds.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-5">
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-[2.25rem] font-bold leading-none tracking-tight text-white/[0.12]"
              >
                02
              </span>
              <div>
                <p className="text-sm font-semibold leading-snug text-[var(--foreground)]">
                  Your palace takes shape
                </p>
                <p className="mt-1.5 text-xs leading-5 text-[var(--foreground-muted)]">
                  Concepts are placed in a 3D space built around what you need to retain.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-5">
              <span
                aria-hidden="true"
                className="accent-gradient mt-0.5 shrink-0 text-[2.25rem] font-bold leading-none tracking-tight"
              >
                03
              </span>
              <div>
                <p className="text-sm font-semibold leading-snug text-[var(--foreground)]">
                  Walk through to remember
                </p>
                <p className="mt-1.5 text-xs leading-5 text-[var(--foreground-muted)]">
                  Navigate your palace. Each room anchors a concept you can recall on demand.
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </section>
  );
}
