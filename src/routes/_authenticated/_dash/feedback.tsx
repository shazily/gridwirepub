import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useOrg } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { MessageSquarePlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/feedback")({
  component: FeedbackPage,
});

const categories = [
  { value: "general", label: "General feedback" },
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "support", label: "Support question" },
];

function FeedbackPage() {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const previousPath = useRouterState({ select: (s) => s.location.pathname });
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Feedback"
        description="Tell us what's working, what's broken, or what you'd like to see next."
      />
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-primary" />
          <div>
            <CardTitle className="text-base">Send feedback</CardTitle>
            <CardDescription>Your message goes straight to the team.</CardDescription>
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
    </div>
  );
}
