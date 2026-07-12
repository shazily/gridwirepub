import { createFileRoute } from "@tanstack/react-router";
import { MarketingLandingPage } from "@/components/marketing-landing";
import { SetupLandingPage } from "@/components/setup-landing";
import { showMarketingLanding } from "@/lib/deployment";
import { gaMeasurementId, googleAnalyticsHeadScripts } from "@/lib/analytics";

function HomePage() {
  return showMarketingLanding ? <MarketingLandingPage /> : <SetupLandingPage />;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: showMarketingLanding
          ? "Gridwire — Spreadsheets & PDFs to production APIs"
          : "Gridwire — Set up your instance",
      },
      {
        name: "description",
        content: showMarketingLanding
          ? "Open-source, self-hostable portal that turns Excel, CSV, and PDFs into secure, documented REST APIs — with AI PDF table parsing, versioning, masking, API keys, and team access."
          : "Configure your self-hosted Gridwire portal — create an organization, upload data, and publish secured REST APIs.",
      },
    ],
    scripts:
      showMarketingLanding && gaMeasurementId
        ? googleAnalyticsHeadScripts(gaMeasurementId)
        : undefined,
  }),
  component: HomePage,
});
