import { type ReactNode, useState, useEffect } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Database,
  Settings,
  LogOut,
  ChevronsUpDown,
  Check,
  Plus,
  LifeBuoy,
  MessageSquarePlus,
  Menu,
  Sun,
  Moon,
  Shield,
  ScrollText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg, canManage, isContributor, type OrgRole } from "@/hooks/use-org";
import { useTheme } from "@/hooks/use-theme";
import { Wordmark } from "@/components/brand";
import { StorageUsageBar } from "@/components/storage-usage-bar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { PageNav } from "@/components/page-nav";
import { OwnerWelcomeOverlay } from "@/components/owner-welcome-overlay";
import { NotificationsBell } from "@/components/notifications-bell";
import { isWelcomeCompleted } from "@/lib/welcome-tour";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  contributorHidden?: boolean;
};

const nav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

const secondaryNav: NavItem[] = [
  { to: "/help", label: "Help & FAQ", icon: LifeBuoy },
  { to: "/app-feedback", label: "Feedback", icon: MessageSquarePlus },
  { to: "/settings", label: "Settings", icon: Settings },
];

function isVisible(item: NavItem, role: OrgRole | null) {
  if (item.adminOnly && !canManage(role)) return false;
  if (item.contributorHidden && isContributor(role)) return false;
  return true;
}


function NavLinks({
  role,
  pathname,
  onNavigate,
}: {
  role: OrgRole | null;
  pathname: string;
  onNavigate?: () => void;
}) {
  const items = [...nav.filter((i) => isVisible(i, role)), ...secondaryNav];
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function OrgSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { orgs, currentOrg, setCurrentOrgId, role } = useOrg();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{currentOrg?.name ?? "Select org"}</div>
            <div className="text-xs capitalize text-muted-foreground">{role ?? "—"}</div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>
          Workspaces {orgs.length > 0 ? `(${orgs.length})` : ""}
        </DropdownMenuLabel>
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onClick={() => {
              setCurrentOrgId(o.id);
              onNavigate?.();
            }}
          >
            <span className="truncate">{o.name}</span>
            {o.id === currentOrg?.id && <Check className="ml-auto h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            navigate({ to: "/onboarding", search: { new: true } });
            onNavigate?.();
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2">
          <Settings className="h-4 w-4" /> Account
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
          <Settings className="mr-2 h-4 w-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate({ to: "/help" })}>
          <LifeBuoy className="mr-2 h-4 w-4" /> Help & FAQ
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate({ to: "/app-feedback" })}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> Feedback
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleTheme}>
          {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role, currentOrg } = useOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  useEffect(() => {
    if (!currentOrg || role !== "owner") {
      setWelcomeOpen(false);
      return;
    }
    if (!isWelcomeCompleted(currentOrg.id)) {
      setWelcomeOpen(true);
    }
  }, [currentOrg?.id, role]);

  async function signOut() {
    setMobileOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const brandName =
    currentOrg?.portal_platform_name?.trim() || currentOrg?.name || "Gridwire";
  const brandLogo = currentOrg?.portal_logo_url ?? null;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <OwnerWelcomeOverlay open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar p-4 md:flex">
        <Link to="/dashboard" className="mb-6 px-1">
          <Wordmark platformName={brandName} logoUrl={brandLogo} />
        </Link>
        <OrgSwitcher />
        <div className="mt-4">
          <StorageUsageBar compact />
        </div>
        <div className="mt-4 flex flex-1 flex-col">
          <NavLinks role={role} pathname={pathname} />
        </div>
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <NotificationsBell />
          <ThemeToggle />
        </div>
        <AccountMenu onSignOut={signOut} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar with burger menu */}
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-4">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="mb-6 px-1">
                  <Wordmark />
                </div>
                <OrgSwitcher onNavigate={() => setMobileOpen(false)} />
                <div className="mt-4">
                  <StorageUsageBar compact />
                </div>
                <div className="mt-4 flex flex-1 flex-col overflow-y-auto">
                  <NavLinks
                    role={role}
                    pathname={pathname}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </div>
                <Button variant="ghost" className="mt-2 w-full justify-start gap-2" onClick={signOut}>
                  <LogOut className="h-4 w-4" /> Sign out
                </Button>
              </SheetContent>
            </Sheet>
            <Wordmark platformName={brandName} logoUrl={brandLogo} />
          </div>
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  backTo,
  backLabel,
  crumbs,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  backTo?: string;
  backLabel?: string;
  crumbs?: { label: string; to?: string }[];
}) {
  return (
    <div className="mb-6">
      {(backTo || crumbs) && (
        <PageNav backTo={backTo} backLabel={backLabel} crumbs={crumbs} className="mb-3" />
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
