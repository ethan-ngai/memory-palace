import type { ReactNode } from "react";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  ScrollRestoration,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { AppProviders } from "@/app/providers";
import { clientEnv } from "@/lib/env/client";
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
    links: [{ href: appCss, rel: "stylesheet" }],
    meta: [
      {
        title: clientEnv.appName,
      },
    ],
  }),
  notFoundComponent: () => (
    <Document>
      <main className="page">
        <div className="panel card">
          <h1>Not Found</h1>
          <p className="muted">This memory chamber does not exist.</p>
        </div>
      </main>
    </Document>
  ),
});

function RootComponent() {
  const auth = Route.useRouteContext({
    select: (context) => context.auth,
  });

  return (
    <Document>
      <AppProviders>
        <div className="app-shell">
          <header className="site-header">
            <div className="nav-links">
              <Link activeOptions={{ exact: true }} className="brand" to="/">
                {clientEnv.appName}
              </Link>
              <Link className="nav-link" to="/">
                Home
              </Link>
              <Link className="nav-link" to="/play">
                Play
              </Link>
              <Link className="nav-link" to="/viewer">
                Viewer
              </Link>
              <Link className="nav-link" to="/profile">
                Profile
              </Link>
            </div>
            <div className="nav-actions">
              {auth.isAuthenticated && auth.user ? (
                <UserMenu user={auth.user} />
              ) : (
                <Link className="button button-secondary" to="/login">
                  Login
                </Link>
              )}
            </div>
          </header>
          <Outlet />
        </div>
      </AppProviders>
    </Document>
  );
}

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
