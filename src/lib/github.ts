/** Public Gridwire source repository — https://github.com/shazily/gridwirepub */
export const GRIDWIRE_GITHUB_REPO_URL =
  import.meta.env.VITE_GITHUB_REPO_URL?.trim() || "https://github.com/shazily/gridwirepub";

/** Clone-ready URL for docs and CTAs */
export const GRIDWIRE_GITHUB_CLONE_URL = `${GRIDWIRE_GITHUB_REPO_URL.replace(/\/$/, "")}.git`;
