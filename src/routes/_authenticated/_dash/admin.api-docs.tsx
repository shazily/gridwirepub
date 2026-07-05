import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { slugify } from "@/lib/spreadsheet";
import { useOrg } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { BookOpen, Copy, Download, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/api-docs")({
  component: ApiDocs,
});

function copy(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("Copied to clipboard");
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
      <Button variant="ghost" size="icon" className="absolute right-1.5 top-1.5 h-7 w-7" onClick={() => copy(code)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ApiDocs() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-host";
  const [datasetId, setDatasetId] = useState<string>("");

  const datasets = useQuery({
    queryKey: ["api-docs-datasets", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("id, name, status, current_version_id, api_access")
        .eq("org_id", orgId!)
        .eq("status", "published")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const selected = useMemo(
    () => datasets.data?.find((d) => d.id === datasetId) ?? datasets.data?.[0],
    [datasets.data, datasetId],
  );

  const fields = useQuery({
    queryKey: ["api-docs-fields", selected?.current_version_id],
    enabled: !!selected?.current_version_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dataset_fields")
        .select("sheet_name, api_name, data_type, masking, included")
        .eq("version_id", selected!.current_version_id!)
        .eq("included", true)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  const sheets = useMemo(() => {
    const map = new Map<string, { api_name: string; data_type: string; masking: string }[]>();
    for (const f of fields.data ?? []) {
      if (!map.has(f.sheet_name)) map.set(f.sheet_name, []);
      map.get(f.sheet_name)!.push({ api_name: f.api_name, data_type: f.data_type, masking: f.masking });
    }
    return [...map.entries()].map(([name, cols]) => ({ name, slug: slugify(name), cols }));
  }, [fields.data]);

  function endpoint(sheetSlug: string) {
    return `${origin}/api/v1/datasets/${selected?.id}/${sheetSlug}`;
  }

  const metaEndpoint = `${origin}/api/v1/datasets/${selected?.id}`;
  const isPublicDs = selected?.api_access === "public";
  const authHeaderLine = isPublicDs ? "" : `-H "Authorization: Bearer YOUR_API_KEY" \\\n  `;

  // cURL showing the auth + ETag polling flow against the dataset metadata endpoint.
  const pollCurl = [
    "# 1. First call — capture the returned ETag header",
    `curl -i ${isPublicDs ? "" : '-H "Authorization: Bearer YOUR_API_KEY" '}"${metaEndpoint}"`,
    "",
    "# 2. Poll cheaply — server returns 304 Not Modified while unchanged,",
    "#    and 200 with a new body once the dataset is re-published.",
    `curl -i ${isPublicDs ? "" : '-H "Authorization: Bearer YOUR_API_KEY" '}\\`,
    `  -H 'If-None-Match: "PASTE_ETAG_HERE"' \\`,
    `  "${metaEndpoint}"`,
    "",
    "# 3. Lightweight change check without a body (HEAD)",
    `curl -I ${isPublicDs ? "" : '-H "Authorization: Bearer YOUR_API_KEY" '}"${metaEndpoint}"`,
  ].join("\n");

  // Builds a Postman v2.1 collection for the selected dataset.
  function buildPostmanCollection() {
    if (!selected) return null;
    const get = (name: string, rawPath: string, query: { key: string; value: string; disabled?: boolean }[] = [], extraHeaders: { key: string; value: string }[] = []) => ({
      name,
      request: {
        method: "GET",
        header: extraHeaders,
        url: {
          raw: `{{base_url}}${rawPath}${query.length ? "?" + query.map((q) => `${q.key}=${q.value}`).join("&") : ""}`,
          host: ["{{base_url}}"],
          path: rawPath.replace(/^\//, "").split("/"),
          query: query.length ? query : undefined,
        },
      },
    });

    const base = `/api/v1/datasets/{{dataset_id}}`;
    const items: unknown[] = [
      get("Dataset metadata + poll", base, [], [
        { key: "If-None-Match", value: '"PASTE_ETAG_HERE"' },
      ]),
      {
        name: "Poll for changes (HEAD)",
        request: { method: "HEAD", header: [], url: { raw: `{{base_url}}${base}`, host: ["{{base_url}}"], path: base.replace(/^\//, "").split("/") } },
      },
      get("OpenAPI spec", `${base}/openapi.json`),
    ];
    for (const s of sheets) {
      items.push(
        get(`Get rows — ${s.name}`, `${base}/${s.slug}`, [
          { key: "limit", value: "50" },
          { key: "offset", value: "0" },
          { key: "fields", value: s.cols.map((c) => c.api_name).slice(0, 3).join(","), disabled: true },
        ]),
        get(`Schema — ${s.name}`, `${base}/${s.slug}/schema`),
      );
    }

    return {
      info: {
        name: `Gridwire · ${selected.name}`,
        description: `Auto-generated Postman collection for the "${selected.name}" dataset.${isPublicDs ? " This is a PUBLIC dataset — no API key required." : " Set the {{api_key}} variable to a valid API key (Authorization: Bearer)."}\n\nPolling: capture the ETag header from any GET, then send it back as If-None-Match to receive 304 Not Modified until the data changes.`,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      auth: isPublicDs
        ? undefined
        : { type: "bearer", bearer: [{ key: "token", value: "{{api_key}}", type: "string" }] },
      variable: [
        { key: "base_url", value: origin },
        { key: "dataset_id", value: selected.id },
        ...(isPublicDs ? [] : [{ key: "api_key", value: "" }]),
      ],
      item: items,
    };
  }

  function downloadPostman() {
    const collection = buildPostmanCollection();
    if (!collection) return;
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gridwire-${slugify(selected?.name ?? "dataset")}.postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Postman collection downloaded");
  }





  return (
    <AdminShell>
      <div>
      <PageHeader
        title="API Documentation"
        description="Auto-generated REST reference for every published dataset. Swagger's server dropdown uses PUBLIC_APP_URL from your deployment .env when set; otherwise the URL in your browser."
      />

      {selected?.api_access === "public" ? (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
          <BookOpen className="mt-0.5 h-4 w-4 text-success" />
          <span>
            <strong>{selected.name}</strong> is a <strong>public</strong> dataset — no API key required. Anyone with the
            URL can read it.
          </span>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <KeyRound className="mt-0.5 h-4 w-4 text-primary" />
          <span>
            Secure datasets require a Bearer API key. Create one under <strong>API Keys</strong>. Authenticate with the
            header <code className="font-mono text-xs">Authorization: Bearer YOUR_API_KEY</code>.
          </span>
        </div>
      )}

      {datasets.data && datasets.data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              No published datasets yet. Publish a dataset to generate its API docs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select value={selected?.id ?? ""} onValueChange={setDatasetId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select dataset" /></SelectTrigger>
              <SelectContent>
                {datasets.data?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <>
                <Button variant="default" size="sm" asChild>
                  <a href={`/docs/${selected.id}`} target="_blank" rel="noreferrer">
                    <BookOpen className="h-4 w-4" /> Open Swagger UI
                  </a>
                </Button>
                <Button variant="outline" size="sm" onClick={downloadPostman}>
                  <Download className="h-4 w-4" /> Download Postman collection
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/v1/datasets/${selected.id}/openapi.json`} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" /> Live OpenAPI spec
                  </a>
                </Button>
              </>
            )}
          </div>

          {selected && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4 text-primary" /> Authentication &amp; polling
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {isPublicDs
                    ? "This dataset is public — no key required. Use the ETag flow to poll for updates efficiently."
                    : "Send your key as a Bearer token, then use the returned ETag with If-None-Match to poll cheaply."}
                </p>
              </CardHeader>
              <CardContent>
                <CodeBlock code={pollCurl} />
              </CardContent>
            </Card>
          )}


          <div className="space-y-4">
            {sheets.map((s) => {
              const ep = endpoint(s.slug);
              const isPublic = selected?.api_access === "public";
              const auth = isPublic ? "" : `-H "Authorization: Bearer YOUR_API_KEY" \\\n  `;
              const curl = `curl ${auth}"${ep}?limit=20&offset=0"`;
              const jsSnippet = isPublic
                ? `const res = await fetch("${ep}?limit=20");\nconst { data } = await res.json();`
                : `const res = await fetch(\n  "${ep}?limit=20",\n  { headers: { Authorization: "Bearer YOUR_API_KEY" } }\n);\nconst { data } = await res.json();`;
              const pollSnippet = [
                "# Capture the ETag from the first response...",
                `curl -i ${isPublic ? "" : '-H "Authorization: Bearer YOUR_API_KEY" '}"${ep}?limit=20"`,
                "",
                "# ...then poll — 304 Not Modified until rows change.",
                `curl -i ${isPublic ? "" : '-H "Authorization: Bearer YOUR_API_KEY" '}\\`,
                `  -H 'If-None-Match: "PASTE_ETAG_HERE"' \\`,
                `  "${ep}?limit=20"`,
              ].join("\n");
              return (
                <Card key={s.name}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <Badge>GET</Badge>
                      <span className="font-mono text-sm">/api/v1/datasets/{selected?.id}/{s.slug}</span>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">Sheet: {s.name} · {s.cols.length} fields</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-1.5">
                      {s.cols.map((c) => (
                        <Badge key={c.api_name} variant="secondary" className="font-mono text-[11px]">
                          {c.api_name}
                          <span className="ml-1 text-muted-foreground">:{c.data_type}</span>
                          {c.masking !== "none" && <span className="ml-1 text-amber-500">({c.masking})</span>}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Query params: <code className="font-mono">limit</code> (max 1000),{" "}
                      <code className="font-mono">offset</code>, <code className="font-mono">fields</code> (comma-separated),
                      plus any field name for equality filtering.
                    </p>
                    <Tabs defaultValue="curl">
                      <TabsList>
                        <TabsTrigger value="curl">cURL</TabsTrigger>
                        <TabsTrigger value="js">JavaScript</TabsTrigger>
                        <TabsTrigger value="poll">Poll (ETag)</TabsTrigger>
                      </TabsList>
                      <TabsContent value="curl"><CodeBlock code={curl} /></TabsContent>
                      <TabsContent value="js"><CodeBlock code={jsSnippet} /></TabsContent>
                      <TabsContent value="poll"><CodeBlock code={pollSnippet} /></TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              );
            })}
          </div>

        </>
      )}
      </div>
    </AdminShell>
  );
}
