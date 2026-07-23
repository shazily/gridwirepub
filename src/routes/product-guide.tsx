import { createFileRoute } from "@tanstack/react-router";
import { ProductGuidePage } from "@/components/product-guide-page";
import { showMarketingLanding } from "@/lib/deployment";
import { gaMeasurementId, googleAnalyticsHeadScripts } from "@/lib/analytics";

export const Route = createFileRoute("/product-guide")({
  head: () => ({
    meta: [
      {
        title: "Gridwire — Product & Security Guide",
      },
      {
        name: "description",
        content:
          "Architecture, feature tour with screenshots, deployment, admin control, and InfoSec answers grounded in the implemented Gridwire platform.",
      },
    ],
    scripts:
      showMarketingLanding && gaMeasurementId
        ? googleAnalyticsHeadScripts(gaMeasurementId)
        : undefined,
  }),
  component: ProductGuidePage,
});
