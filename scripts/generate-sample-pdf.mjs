/**
 * Writes fixtures/sample-orders.pdf with an embedded GRIDWIRE_PDF_MOCK_JSON marker
 * so PDF_PARSE_MOCK=true deployments can exercise the full ingest path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures");
mkdirSync(outDir, { recursive: true });

const mock = {
  page_count: 1,
  tables: [
    {
      name: "Orders",
      headers: ["Order ID", "Customer", "Amount", "Status"],
      rows: [
        ["ORD-1001", "Acme Corp", 1250.5, "paid"],
        ["ORD-1002", "Northwind", 890, "pending"],
        ["ORD-1003", "Contoso", 2100, "paid"],
      ],
      confidence: 0.95,
      flags: ["fixture"],
    },
  ],
};

const marker = `GRIDWIRE_PDF_MOCK_JSON:${JSON.stringify(mock)}`;
const escaped = marker.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const content = `BT /F1 8 Tf 40 750 Td (${escaped}) Tj ET`;
const streamLen = Buffer.byteLength(content, "latin1");

const objects = [
  "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
  "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
  "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
  `4 0 obj<< /Length ${streamLen} >>stream\n${content}\nendstream\nendobj\n`,
  "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
];

let body = "%PDF-1.4\n";
const offsets = [0];
for (const obj of objects) {
  offsets.push(Buffer.byteLength(body, "latin1"));
  body += obj;
}
const xrefStart = Buffer.byteLength(body, "latin1");
body += `xref\n0 ${objects.length + 1}\n`;
body += "0000000000 65535 f \n";
for (let i = 1; i <= objects.length; i++) {
  body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const outPath = join(outDir, "sample-orders.pdf");
writeFileSync(outPath, Buffer.from(body, "latin1"));
console.log(`Wrote ${outPath} (${Buffer.byteLength(body, "latin1")} bytes)`);
