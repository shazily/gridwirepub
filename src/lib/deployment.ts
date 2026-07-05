/** Client-safe deployment profile (baked at build time via VITE_*). */
export const isOnPremDeployment = import.meta.env.VITE_DEPLOYMENT_MODE === "onprem";

/**
 * Promotional marketing homepage — operator-only (your demo site).
 * Default off so clones of the public repo get the setup landing instead.
 */
export const showMarketingLanding = import.meta.env.VITE_SHOW_MARKETING === "true";
