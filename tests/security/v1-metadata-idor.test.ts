import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authorizeDataset,
  resetRateLimitsForTests,
  type AdminClient,
  type ResolvedDataset,
} from "@/lib/api-serve.server";

const DATASET_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

const SECURE_DATASET: ResolvedDataset = {
  id: DATASET_ID,
  org_id: ORG_A,
  name: "Secure dataset",
  description: null,
  slug: "secure-dataset",
  api_access: "secure",
  status: "published",
  current_version_id: VERSION_ID,
  updated_at: new Date().toISOString(),
};

const PUBLIC_DATASET: ResolvedDataset = {
  ...SECURE_DATASET,
  api_access: "public",
};

const VALID_API_KEY = "gridwire-test-key-valid";
const VALID_KEY_HASH = createHash("sha256").update(VALID_API_KEY).digest("hex");

const METADATA_ROUTE_FILES = [
  "src/routes/api/v1/datasets.$datasetId.lineage[.]json.ts",
  "src/routes/api/v1/datasets.$datasetId.contract[.]json.ts",
  "src/routes/api/v1/datasets.$datasetId.contract[.]yaml.ts",
  "src/routes/api/v1/datasets.$datasetId.openapi[.]json.ts",
  "src/routes/api/v1/datasets.$datasetId.versions.$versionNo.contract[.]json.ts",
] as const;

type MockConfig = {
  dataset: ResolvedDataset | null;
  apiKey?: {
    id: string;
    org_id: string;
    name: string;
    revoked_at: string | null;
    rate_limit_override: number | null;
  } | null;
};

function buildMockAdmin(config: MockConfig): AdminClient {
  return {
    from(table: string) {
      const state: { filters: Record<string, unknown> } = { filters: {} };
      const chain = {
        select: () => chain,
        eq(col: string, val: unknown) {
          state.filters[col] = val;
          return chain;
        },
        gte: () => chain,
        is: () => chain,
        maybeSingle: async () => {
          if (table === "datasets" && state.filters.id === DATASET_ID) {
            return { data: config.dataset, error: null };
          }
          if (table === "api_keys" && state.filters.key_hash === VALID_KEY_HASH && config.apiKey) {
            return { data: config.apiKey, error: null };
          }
          if (table === "organizations" && state.filters.id === ORG_A) {
            return {
              data: { api_rate_limit_per_min: null, api_monthly_quota: null },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        insert: async () => ({ error: null }),
      };
      return chain;
    },
  } as unknown as AdminClient;
}

async function authStatus(
  request: Request,
  dataset: ResolvedDataset | null,
  apiKeyOrg: string | null,
): Promise<number> {
  const admin = buildMockAdmin({
    dataset,
    apiKey: apiKeyOrg
      ? {
          id: "key-1",
          org_id: apiKeyOrg,
          name: "test",
          revoked_at: null,
          rate_limit_override: null,
        }
      : null,
  });
  const result = await authorizeDataset(admin, request, DATASET_ID);
  if (result.ok) return 200;
  return result.response.status;
}

describe("v1 metadata routes — source uses authorizeDataset", () => {
  const root = join(process.cwd());
  for (const rel of METADATA_ROUTE_FILES) {
    it(`${rel} calls authorizeDataset`, () => {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src).toContain("authorizeDataset");
    });
  }
});

function describeMetadataRouteAuth(routeLabel: string) {
  describe(`${routeLabel} — authorizeDataset gate`, () => {
    beforeEach(() => {
      resetRateLimitsForTests();
      process.env.API_RATE_LIMIT_PER_MIN = "1000";
      process.env.API_RATE_LIMIT_BURST = "1000";
    });

    it("secure dataset without API key → 401", async () => {
      const req = new Request(`http://localhost/api/v1/datasets/${DATASET_ID}/metadata`);
      expect(await authStatus(req, SECURE_DATASET, null)).toBe(401);
    });

    it("secure dataset with wrong-org API key → 404", async () => {
      const req = new Request(`http://localhost/api/v1/datasets/${DATASET_ID}/metadata`, {
        headers: { Authorization: `Bearer ${VALID_API_KEY}` },
      });
      expect(await authStatus(req, SECURE_DATASET, ORG_B)).toBe(404);
    });

    it("secure dataset with valid org API key → 200", async () => {
      const req = new Request(`http://localhost/api/v1/datasets/${DATASET_ID}/metadata`, {
        headers: { Authorization: `Bearer ${VALID_API_KEY}` },
      });
      expect(await authStatus(req, SECURE_DATASET, ORG_A)).toBe(200);
    });

    it("public dataset without API key → 200", async () => {
      const req = new Request(`http://localhost/api/v1/datasets/${DATASET_ID}/metadata`);
      expect(await authStatus(req, PUBLIC_DATASET, null)).toBe(200);
    });
  });
}

describeMetadataRouteAuth("lineage.json");
describeMetadataRouteAuth("contract.json");
describeMetadataRouteAuth("contract.yaml");
describeMetadataRouteAuth("openapi.json");
describeMetadataRouteAuth("versions/contract.json");
