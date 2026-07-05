/** Google Analytics measurement ID — marketing site only (VITE_SHOW_MARKETING=true). */
export const gaMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() || "";

export function googleAnalyticsHeadScripts(id: string) {
  return [
    {
      src: `https://www.googletagmanager.com/gtag/js?id=${id}`,
      async: true as const,
    },
    {
      children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');`,
    },
  ];
}
