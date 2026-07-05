import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-chrome";
import { PublicMarketingNav } from "@/components/public-marketing-nav";
import { submitSiteFeedback } from "@/lib/feedback.functions";
import { toast } from "sonner";
import { MessageSquarePlus } from "lucide-react";

const categories = [
  { value: "general", label: "General feedback" },
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "support", label: "Support question" },
] as const;

export function PublicFeedbackPage() {
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]["value"]>("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (message.trim().length < 5) {
      toast.error("Please add a little more detail");
      return;
    }
    setSubmitting(true);
    try {
      await submitSiteFeedback({
        data: {
          email: email.trim() || undefined,
          category,
          message: message.trim(),
          pagePath: typeof window !== "undefined" ? window.location.pathname : undefined,
        },
      });
      setMessage("");
      setEmail("");
      setCategory("general");
      setSent(true);
      toast.success("Thanks! Your feedback has been sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PublicSiteHeader trailing={<PublicMarketingNav />} />

      <main className="relative flex-1">
        <div className="grid-bg absolute inset-0 opacity-20" aria-hidden />
        <div className="relative mx-auto max-w-xl px-6 py-10 sm:py-14">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
            <MessageSquarePlus className="h-5 w-5 text-primary" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Feedback</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Tell us what you think about Gridwire — bugs, ideas, or questions. No account required.
            Already in a workspace?{" "}
            <Link to="/app-feedback" className="text-primary underline-offset-4 hover:underline">
              Send workspace feedback
            </Link>
            .
          </p>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">Send a message</CardTitle>
              <CardDescription>We read every submission. Email is optional if you want a reply.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sent && (
                <p className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm text-muted-foreground">
                  Message received — thank you. You can send another note below anytime.
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="feedback-email">Email (optional)</Label>
                <Input
                  id="feedback-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="feedback-message">Message</Label>
                <Textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What should we improve?"
                  rows={5}
                />
              </div>
              <Button onClick={() => void submit()} disabled={submitting} className="w-full sm:w-auto">
                {submitting ? "Sending…" : "Send feedback"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
