import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  portal_slug?: string;
  created_by: string;
  portal_platform_name?: string | null;
  portal_logo_url?: string | null;
  is_portal_default?: boolean;
};

export type OrgRole = "owner" | "admin" | "member" | "viewer" | "contributor";

type MembershipRow = { role: OrgRole; org: Organization };

type OrgContextValue = {
  orgs: Organization[];
  currentOrg: Organization | null;
  role: OrgRole | null;
  setCurrentOrgId: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  isReady: boolean;
  refetch: () => Promise<QueryObserverResult<MembershipRow[], Error>>;
};

const OrgContext = createContext<OrgContextValue | null>(null);
const STORAGE_KEY = "gridwire.currentOrgId";

export function OrgProvider({ children }: { children: ReactNode }) {
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setAuthUserId(data.user?.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const membershipsQuery = useQuery({
    queryKey: ["org-memberships", authUserId],
    enabled: !!authUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_members")
        .select(
          "role, organizations(id, name, slug, portal_slug, created_by, portal_platform_name, portal_logo_url, is_portal_default)",
        )
        .eq("user_id", authUserId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .filter((m) => m.organizations)
        .map((m) => ({
          role: m.role as OrgRole,
          org: m.organizations as unknown as Organization,
        }));
    },
  });

  const memberships = membershipsQuery.data ?? [];
  const orgs = memberships.map((m) => m.org);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setCurrentOrgIdState(stored);
  }, []);

  useEffect(() => {
    if (orgs.length === 0) return;
    if (!currentOrgId || !orgs.some((o) => o.id === currentOrgId)) {
      setCurrentOrgIdState(orgs[0].id);
    }
  }, [orgs, currentOrgId]);

  const setCurrentOrgId = (id: string) => {
    setCurrentOrgIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  };

  const isReady =
    !!authUserId &&
    !membershipsQuery.isLoading &&
    !membershipsQuery.isFetching &&
    (membershipsQuery.isSuccess || membershipsQuery.isError);

  const value = useMemo<OrgContextValue>(() => {
    const current = orgs.find((o) => o.id === currentOrgId) ?? null;
    const role = memberships.find((m) => m.org.id === currentOrgId)?.role ?? null;
    return {
      orgs,
      currentOrg: current,
      role,
      setCurrentOrgId,
      isLoading: !authUserId || membershipsQuery.isLoading || membershipsQuery.isFetching,
      isError: membershipsQuery.isError,
      isReady,
      refetch: membershipsQuery.refetch,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orgs,
    currentOrgId,
    memberships,
    authUserId,
    membershipsQuery.isLoading,
    membershipsQuery.isFetching,
    membershipsQuery.isError,
    isReady,
  ]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}

export function canManage(role: OrgRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canEdit(role: OrgRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member" || role === "contributor";
}

// Contributors can only drop data — not manage members, keys, connectors, etc.
export function isContributor(role: OrgRole | null): boolean {
  return role === "contributor";
}
