import { useState, type ReactNode } from "react";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  ScrollRestoration,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { AppProviders } from "@/app/providers";
import { getAuthState } from "@/features/auth/functions";
import { UserMenu } from "@/features/auth/components/user-menu";
import appCss from "@/styles/app.css?url";

export const Route = createRootRouteWithContext<Record<string, never>>()({
  beforeLoad: async () => {
    const auth = await getAuthState();
    return { auth };
  },
  component: RootComponent,
  head: () => ({
    links: [
      { href: appCss, rel: "stylesheet" },
      { href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
    ],
    meta: [
      {
        title: "Loci",
      },
    ],
  }),
  notFoundComponent: () => (
    <Document>
      <main className="page">
        <div className="surface-spotlight rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <h1 className="text-gradient m-0 text-4xl font-semibold tracking-tight">Not Found</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--foreground-muted)]">
            That page could not be found.
          </p>
        </div>
      </main>
    </Document>
  ),
});

/**
 * Renders the global application frame and responsive route navigation.
 * @returns The authenticated-aware site shell used by every route.
 * @remarks Keeping navigation in the root route ensures the redesign stays consistent while route components remain focused on feature content.
 */
function RootComponent() {
  const auth = Route.useRouteContext({
    select: (context) => context.auth,
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinkClassName =
    "rounded-full border border-transparent px-4 py-2 text-sm text-[var(--foreground-muted)] transition duration-200 ease-out hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-[var(--foreground)]";

  return (
    <Document>
      <AppProviders>
        <div className="app-shell">
          <header className="sticky top-0 z-30 px-4 pt-4 md:px-6">
            <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 rounded-[24px] border border-white/[0.08] bg-[rgba(5,5,6,0.72)] px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl md:px-6">
              <div className="flex items-center gap-3">
                <Link
                  activeOptions={{ exact: true }}
                  className="group flex items-center gap-3"
                  to="/"
                >
                  <img alt="Loci logo" className="h-11 w-11 object-contain" src="/favicon.svg" />
                  <div>
                    <div className="text-xl font-black uppercase tracking-[0.24em] text-[var(--foreground)] md:text-2xl">
                      Loci
                    </div>
                  </div>
                </Link>
              </div>

              <nav className="hidden items-center gap-2 md:flex">
                <Link className={navLinkClassName} to="/">
                  Home
                </Link>
                <Link className={navLinkClassName} to="/play">
                  Play
                </Link>
                <Link className={navLinkClassName} to="/profile">
                  Profile
                </Link>
              </nav>

              <div className="hidden items-center gap-3 md:flex">
                {auth.isAuthenticated && auth.user ? (
                  <UserMenu user={auth.user} />
                ) : (
                  <Link
                    className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.05] px-4 py-2 text-sm text-[var(--foreground)] transition duration-200 ease-out hover:border-white/[0.14] hover:bg-white/[0.08]"
                    to="/login"
                  >
                    Login
                  </Link>
                )}
              </div>

              <button
                aria-expanded={isMobileMenuOpen}
                aria-label="Toggle navigation menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-lg text-[var(--foreground)] transition duration-200 ease-out hover:border-white/[0.14] hover:bg-white/[0.08] md:hidden"
                onClick={() => setIsMobileMenuOpen((value) => !value)}
                type="button"
              >
                {isMobileMenuOpen ? "×" : "≡"}
              </button>

              {isMobileMenuOpen ? (
                <div className="grid w-full gap-3 border-t border-white/[0.08] pt-4 md:hidden">
                  <nav className="grid gap-2">
                    <Link
                      className={navLinkClassName}
                      onClick={() => setIsMobileMenuOpen(false)}
                      to="/"
                    >
                      Home
                    </Link>
                    <Link
                      className={navLinkClassName}
                      onClick={() => setIsMobileMenuOpen(false)}
                      to="/play"
                    >
                      Play
                    </Link>
                    <Link
                      className={navLinkClassName}
                      onClick={() => setIsMobileMenuOpen(false)}
                      to="/profile"
                    >
                      Profile
                    </Link>
                  </nav>
                  <div>
                    {auth.isAuthenticated && auth.user ? (
                      <UserMenu user={auth.user} />
                    ) : (
                      <Link
                        className="inline-flex w-full items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.05] px-4 py-2.5 text-sm text-[var(--foreground)] transition duration-200 ease-out hover:border-white/[0.14] hover:bg-white/[0.08]"
                        onClick={() => setIsMobileMenuOpen(false)}
                        to="/login"
                      >
                        Login
                      </Link>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </header>
          <Outlet />
        </div>
      </AppProviders>
    </Document>
  );
}

/**
 * Wraps the React application in the shared HTML document tags required by TanStack Start.
 * @param props - Child nodes rendered inside the document body.
 * @returns Full document structure including route head content and hydration scripts.
 */
function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
