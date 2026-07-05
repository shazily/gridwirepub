import { type ReactNode } from "react";
import { Link, useRouterState, Navigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Users,
  Shield,
  HardDrive,
  KeyRound,
  Cable,
  ScrollText,
  BarChart3,
  BookOpen,
  Mail,
  Bell,
  Layers,
} from "lucide-react";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageNav } from "@/components/page-nav";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

const adminNav = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/admin/workspaces", label: "Workspaces", icon: Layers },
  { to: "/admin/organization", label: "Organization", icon: Building2 },
  { to: "/admin/team", label: "Team & access", icon: Users },
  { to: "/admin/security", label: "Security", icon: Shield },
  { to: "/admin/storage", label: "Storage", icon: HardDrive },
  { to: "/admin/authentication", label: "Authentication", icon: KeyRound },
  { to: "/admin/email-ingest", label: "Email ingest", icon: Mail },
  { to: "/admin/alerts", label: "Alerts", icon: Bell },
  { to: "/admin/api-keys", label: "API keys", icon: KeyRound },
  { to: "/admin/api-docs", label: "API docs", icon: BookOpen },
  { to: "/admin/connectors", label: "Connectors", icon: Cable },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
  { to: "/admin/usage", label: "Usage", icon: BarChart3 },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const { role } = useOrg();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!canManage(role)) {
    return (
      <div>
        <PageNav backTo="/dashboard" backLabel="Dashboard" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You need owner or admin access to view the admin console.
            </p>
            <Link to="/dashboard" className="text-sm text-primary hover:underline">
              Return to dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-52">
        <PageNav backTo="/dashboard" backLabel="Dashboard" crumbs={[{ label: "Admin" }]} />
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {adminNav.map((item) => {
            const active = item.exact
              ? pathname === item.to || pathname === `${item.to}/`
              : pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Redirect legacy admin-only paths to /admin/* equivalents. */
export function AdminRouteRedirect({ to }: { to: string }) {
  return <Navigate to={to} replace />;
}
