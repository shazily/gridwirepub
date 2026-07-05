const fs = require("fs");

const files = [
  "src/routes/_authenticated/_dash/admin.audit.tsx",
  "src/routes/_authenticated/_dash/admin.api-keys.tsx",
  "src/routes/_authenticated/_dash/admin.api-docs.tsx",
  "src/routes/_authenticated/_dash/admin.connectors.tsx",
  "src/routes/_authenticated/_dash/admin.alerts.tsx",
  "src/routes/_authenticated/_dash/admin.storage.tsx",
  "src/routes/_authenticated/_dash/admin.organization.tsx",
  "src/routes/_authenticated/_dash/admin.authentication.tsx",
  "src/routes/_authenticated/_dash/admin.usage.tsx",
  "src/routes/_authenticated/_dash/admin.feedback.tsx",
  "src/routes/_authenticated/_dash/admin.index.tsx",
];

for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  if (!s.includes("AdminShell")) {
    s = s.replace(
      'import { PageHeader } from "@/components/app-shell";',
      'import { PageHeader } from "@/components/app-shell";\nimport { AdminShell } from "@/components/admin-shell";',
    );
  }
  if (!s.includes("<AdminShell>")) {
    s = s.replace(/return \(\s*\n\s*<div>/, "return (\n    <AdminShell>\n      <div>");
    const marker = "\n    </div>\n  );\n}";
    const idx = s.lastIndexOf(marker);
    if (idx > 0) {
      s = s.slice(0, idx) + "\n      </div>\n    </AdminShell>\n  );\n}" + s.slice(idx + marker.length);
    }
  }
  fs.writeFileSync(f, s);
  console.log("ok", f);
}
