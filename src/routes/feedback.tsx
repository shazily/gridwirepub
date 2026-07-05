import { createFileRoute } from "@tanstack/react-router";
import { PublicFeedbackPage } from "@/components/public-feedback-page";
import { showMarketingLanding } from "@/lib/deployment";
import { gaMeasurementId, googleAnalyticsHeadScripts } from "@/lib/analytics";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "Gridwire — Feedback" },
      {
        name: "description",
        content: "Send feedback, bug reports, or feature requests about Gridwire.",
      },
    ],
    scripts:
      showMarketingLanding && gaMeasurementId
        ? googleAnalyticsHeadScripts(gaMeasurementId)
        : undefined,
  }),
  component: PublicFeedbackPage,
});
