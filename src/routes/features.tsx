import { createFileRoute } from "@tanstack/react-router";
import { PlatformFeaturesPage } from "@/components/platform-features-page";
import { showMarketingLanding } from "@/lib/deployment";
import { gaMeasurementId, googleAnalyticsHeadScripts } from "@/lib/analytics";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      {
        title: "Gridwire — Platform features",
      },
      {
        name: "description",
        content:
          "Full feature list for Gridwire: governed email ingest, REST APIs, field masking, interactive data lineage, connectors, audit logs, and multi-tenant workspaces.",
      },
    ],
    scripts:
      showMarketingLanding && gaMeasurementId
        ? googleAnalyticsHeadScripts(gaMeasurementId)
        : undefined,
  }),
  component: PlatformFeaturesPage,
});
