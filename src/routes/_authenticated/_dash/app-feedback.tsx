import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MessageSquarePlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/app-feedback")({
  component: FeedbackPage,
});

const categories = [
  { value: "general", label: "General feedback" },
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "support", label: "Support question" },
];

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  bug: "Bug",
  feature: "Feature request",
  question: "Question",
  support: "Support",
};

function FeedbackPage() {
  const { user } = useAuth();
  const { currentOrg, role } = useOrg();
  const manage = canManage(role);
  const previousPath = useRouterState({ select: (s) => s.location.pathname });
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewFilter, setReviewFilter] = useState("all");

  const orgId = currentOrg?.id;

  const feedbackReview = useQuery({
    queryKey: ["feedback-review", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feedback")
        .select("id, category, message, page_path, created_at, user_id")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = Array.from(new Set((data ?? []).map((f) => f.user_id)));
      let names: Record<string, string> = {};
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", ids);
        names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name ?? p.id.slice(0, 8)]));
      }
      return (data ?? []).map((f) => ({
        ...f,
        author: names[f.user_id] ?? f.user_id.slice(0, 8),
      }));
    },
  });

  const reviewItems = useMemo(() => {
    const all = feedbackReview.data ?? [];
    if (reviewFilter === "all") return all;
    return all.filter((f) => f.category === reviewFilter);
  }, [feedbackReview.data, reviewFilter]);

  async function submit() {
    if (!user) return;
    if (message.trim().length < 5) return toast.error("Please add a little more detail");
    setSubmitting(true);
    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      org_id: currentOrg?.id ?? null,
      category,
      message: message.trim(),
      page_path: previousPath,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    setMessage("");
    setCategory("general");
    toast.success("Thanks! Your feedback has been sent.");
    if (manage) void feedbackReview.refetch();
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Feedback"
        description="Share ideas with the team or review messages from your workspace."
        backTo="/dashboard"
        backLabel="Dashboard"
        crumbs={[{ label: "Feedback" }]}
      />

      <Tabs defaultValue="submit">
        <TabsList className="mb-4">
          <TabsTrigger value="submit">Send feedback</TabsTrigger>
          {manage && <TabsTrigger value="review">Team feedback</TabsTrigger>}
        </TabsList>

        <TabsContent value="submit">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <MessageSquarePlus className="h-4 w-4 text-primary" />
              <div>
                <CardTitle className="text-base">Send feedback</CardTitle>
                <CardDescription>Your message goes to workspace owners and admins.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
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
                <Label>Message</Label>
                <Textarea
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Share as much detail as you like…"
                />
              </div>
              <Button onClick={submit} disabled={submitting || !message.trim()}>
                {submitting ? "Sending…" : "Send feedback"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {manage && (
          <TabsContent value="review">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Team feedback</CardTitle>
                  <CardDescription>Messages submitted by members of this workspace.</CardDescription>
                </div>
                <Select value={reviewFilter} onValueChange={setReviewFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="space-y-3">
                {reviewItems.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {feedbackReview.isLoading ? "Loading…" : "No feedback yet."}
                  </p>
                ) : (
                  reviewItems.map((f) => (
                    <div key={f.id} className="rounded-lg border border-border p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{CATEGORY_LABELS[f.category] ?? f.category}</Badge>
                        <span className="text-sm font-medium">{f.author}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {new Date(f.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{f.message}</p>
                      {f.page_path && (
                        <code className="mt-2 inline-block font-mono text-xs text-muted-foreground">
                          {f.page_path}
                        </code>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
