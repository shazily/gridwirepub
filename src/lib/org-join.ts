/** Pending org join ref (UUID or portal slug) after auth — parallel to invite pending key. */
export const PENDING_JOIN_KEY = "gridwire.pendingJoinRef";

const CURRENT_ORG_KEY = "gridwire.currentOrgId";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Form input must be a bare organization UUID (links may use slug). */
export function isOrgUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function setPendingJoinRef(ref: string): void {
  if (typeof window === "undefined") return;
  const trimmed = ref.trim();
  if (!trimmed) return;
  window.localStorage.setItem(PENDING_JOIN_KEY, trimmed);
}

export function clearPendingJoinRef(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_JOIN_KEY);
}

export function getPendingJoinRef(): string | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(PENDING_JOIN_KEY);
  return v?.trim() || null;
}

export function setCurrentOrgIdLocal(orgId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CURRENT_ORG_KEY, orgId);
}

/** Build shareable join URL (prefer portal slug). */
export function buildJoinUrl(origin: string, portalSlug: string | null | undefined, orgId: string): string {
  const base = origin.replace(/\/$/, "");
  const ref = (portalSlug && portalSlug.trim()) || orgId;
  return `${base}/join/${encodeURIComponent(ref)}`;
}
