const STORAGE_PREFIX = "gridwire.welcomeCompleted";

/** Whether the org owner has finished the first-run welcome tour. */
export function isWelcomeCompleted(orgId: string): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(`${STORAGE_PREFIX}.${orgId}`) === "1";
}

export function markWelcomeCompleted(orgId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_PREFIX}.${orgId}`, "1");
}

export function clearWelcomeCompleted(orgId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${STORAGE_PREFIX}.${orgId}`);
}
