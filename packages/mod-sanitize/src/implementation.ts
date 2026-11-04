import { readFileSync, writeFileSync } from "node:fs";
import type {
  AgonModFactory,
  CommandResult,
  Dispose,
  InvocationContext,
  Json,
  ModServices,
  Registrar,
} from "@kernlang/agon-mod-api";

import { scanText, cleanText } from "./text-forensics.js";
import { formatForensicReport } from "./report.js";
export { scanText, cleanText };
export type { TextFinding as Finding } from "./text-forensics.js";
export type MetadataFinding = {
  offset: number;
  length: number;
  channel: string;
  action: "strip";
  detail: string;
};
const imageNA = [
  "pixel/frequency-domain image watermarks — not assessable without a detector",
  "absence of provenance metadata is not proof of human origin",
];
const counts = (findings: readonly { channel: string }[]) =>
  Object.fromEntries(
    [...new Set(findings.map((x) => x.channel))].map((key) => [
      key,
      findings.filter((x) => x.channel === key).length,
    ]),
  );
function format(input: Buffer): "png" | "jpeg" | "svg" | "unknown" {
  if (
    input.length >= 8 &&
    input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (input[0] === 0xff && input[1] === 0xd8) return "jpeg";
  const head = input
    .toString("utf8", 0, Math.min(input.length, 512))
    .replace(/^\uFEFF/, "")
    .trimStart();
  return head.startsWith("<") &&
    (head.includes("<svg") || head.includes("<?xml"))
    ? "svg"
    : "unknown";
}
function jpegKind(input: Buffer, start: number, length: number): string {
  if (
    length >= 6 &&
    input.toString("latin1", start, start + 4) === "Exif" &&
    input[start + 4] === 0 &&
    input[start + 5] === 0
  )
    return "exif-metadata";
  if (
    length >= 29 &&
    input.toString("latin1", start, start + 29) ===
      "http://ns.adobe.com/xap/1.0/\0"
  )
    return "xmp-packet";
  const head = input.toString("latin1", start, start + Math.min(length, 64));
  return head.includes("jumb") || head.includes("c2pa") ? "c2pa-manifest" : "";
}
function pngFindings(input: Buffer): MetadataFinding[] {
  const out: MetadataFinding[] = [];
  for (let pos = 8; pos + 12 <= input.length; ) {
    const length = input.readUInt32BE(pos);
    const type = input.toString("latin1", pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > input.length) break;
    let kind =
      type === "caBX"
        ? "c2pa-manifest"
        : type === "eXIf"
          ? "exif-metadata"
          : "";
    if (type === "iTXt") {
      const zero = input.indexOf(0, pos + 8);
      if (
        zero >= 0 &&
        zero < pos + 8 + length &&
        input.toString("latin1", pos + 8, zero) === "XML:com.adobe.xmp"
      )
        kind = "xmp-packet";
    }
    if (kind)
      out.push({
        offset: pos,
        length: end - pos,
        channel: kind,
        action: "strip",
        detail: `${type} provenance metadata`,
      });
    pos = end;
    if (type === "IEND") break;
  }
  return out;
}
function jpegFindings(input: Buffer): MetadataFinding[] {
  const out: MetadataFinding[] = [];
  for (let pos = 2; pos + 4 <= input.length; ) {
    if (input[pos] !== 0xff) break;
    const marker = input[pos + 1]!;
    if (
      marker === 0xff ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      pos += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = input.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (end > input.length) break;
    const kind =
      marker === 0xe1 || marker === 0xeb
        ? jpegKind(input, pos + 4, length - 2)
        : "";
    if (kind && (marker !== 0xeb || kind === "c2pa-manifest"))
      out.push({
        offset: pos,
        length: end - pos,
        channel: kind,
        action: "strip",
        detail: `JPEG APP${marker - 0xe0} provenance metadata`,
      });
    if (marker === 0xda) break;
    pos = end;
  }
  return out;
}
function svgFindings(text: string): MetadataFinding[] {
  const out: MetadataFinding[] = [];
  for (const re of [
    /<metadata[\s>][\s\S]*?<\/metadata>/gi,
    /<x:xmpmeta[\s>][\s\S]*?<\/x:xmpmeta>/gi,
    /<\?xpacket[\s\S]*?\?>/gi,
  ])
    for (const match of text.matchAll(re))
      out.push({
        offset: match.index,
        length: match[0].length,
        channel: "xmp-packet",
        action: "strip",
        detail: "SVG provenance metadata",
      });
  return out.filter(
    (item, index) =>
      !out.some(
        (parent, parentIndex) =>
          parentIndex < index &&
          item.offset >= parent.offset &&
          item.offset + item.length <= parent.offset + parent.length,
      ),
  );
}
export function scanMetadata(input: Buffer) {
  const kind = format(input);
  const findings =
    kind === "png"
      ? pngFindings(input)
      : kind === "jpeg"
        ? jpegFindings(input)
        : kind === "svg"
          ? svgFindings(input.toString("utf8"))
          : [];
  return {
    format: kind,
    findings,
    byChannel: counts(findings),
    clean: kind !== "unknown" && findings.length === 0,
    notAssessable:
      kind === "unknown"
        ? [...imageNA, "unrecognized file format — no metadata scan performed"]
        : imageNA,
  };
}
export function stripMetadata(input: Buffer) {
  const report = scanMetadata(input);
  if (report.format === "unknown") return { output: input, report };
  if (report.format === "svg")
    return {
      output: Buffer.from(
        input
          .toString("utf8")
          .replace(/<metadata[\s>][\s\S]*?<\/metadata>/gi, "")
          .replace(/<x:xmpmeta[\s>][\s\S]*?<\/x:xmpmeta>/gi, "")
          .replace(/<\?xpacket[\s\S]*?\?>/gi, ""),
        "utf8",
      ),
      report,
    };
  const findings = report.findings;
  const parts: Buffer[] = [];
  let cursor = 0;
  for (const finding of findings.sort((a, b) => a.offset - b.offset)) {
    parts.push(input.subarray(cursor, finding.offset));
    cursor = finding.offset + finding.length;
  }
  parts.push(input.subarray(cursor));
  return { output: Buffer.concat(parts), report };
}

const schema = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    text: { type: "string" },
    file: { type: "string" },
    out: { type: "string" },
    detect: { type: "boolean", default: false },
    jsonl: { type: "boolean", default: false },
    metadata: { type: "boolean", default: false },
    stripMetadata: { type: "boolean", default: false },
    inPlace: { type: "boolean", default: false },
    _: { type: "array", items: { type: "string" } },
  },
}) as Readonly<Record<string, Json>>;
const cliSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    file: { type: "string" },
    detect: { type: "boolean", default: false },
    out: { type: "string" },
    jsonl: { type: "boolean", default: false },
    metadata: { type: "boolean", default: false },
    stripMetadata: { type: "boolean", default: false },
    inPlace: { type: "boolean", default: false },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ["file"], aliases: { out: "o" }, descriptions: { detect: "Report-only forensic scan; exits 1 when actionable hidden channels are found", out: "Write cleaned output to this file instead of stdout", jsonl: "Emit the report as machine-readable JSONL", metadata: "Metadata mode: scan a PNG/JPEG/SVG file for signed provenance metadata (C2PA/JUMBF, XMP, Exif). Requires a file argument. Honest framing: pixel-level watermarks are not assessable.", stripMetadata: "With --metadata: strip the provenance metadata (breaks the C2PA signature — result is honestly \"metadata removed\"). Writes to --out or overwrites nothing (refuses without --out unless --in-place).", inPlace: "With --metadata --strip-metadata: rewrite the input file in place after stripping" } });
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
export async function runSanitize(
  raw: Json,
  _context: InvocationContext,
  services: ModServices,
): Promise<CommandResult> {
  const x = raw as Record<string, Json>;
  const file = String(x.file ?? "").trim();
  const stripRequested = x.stripMetadata === true || x["strip-metadata"] === true;
  const inPlaceRequested = x.inPlace === true || x["in-place"] === true;
  const jsonl = x.jsonl === true;
  if (x.metadata === true || stripRequested) {
    if (!file)
      return { exitCode: 1, stderr: "Metadata mode requires a file.\n" };
    const bytes = readFileSync(file);
    const report = scanMetadata(bytes);
    if (report.format === "unknown")
      return {
        exitCode: 2,
        stderr: "Unrecognized format; nothing was examined.\n",
        result: report as unknown as Json,
      };
    if (!stripRequested) {
      const payload = { type: "sanitize.metadata-report", source: file, strip: false, ...report };
      return {
        exitCode: report.clean ? 0 : 1,
        stdout: `${JSON.stringify(payload, null, jsonl ? 0 : 2)}\n`,
        result: report as unknown as Json,
      };
    }
    if (report.findings.length === 0) {
      const payload = { type: "sanitize.metadata-stripped", source: file, destination: null, removedFindings: 0, verifiedClean: true, ...report };
      return { exitCode: 0, stdout: `${JSON.stringify(payload, null, jsonl ? 0 : 2)}\n`, result: payload as unknown as Json };
    }
    const destination = inPlaceRequested ? file : String(x.out ?? "").trim();
    if (!destination)
      return {
        exitCode: 1,
        stderr:
          "Metadata stripping requires --out or --in-place; the source was not changed.\n",
      };
    if ((await services.permissions.check("fs.write", destination)) !== "allow")
      return { exitCode: 1, stderr: "fs.write permission denied.\n" };
    const stripped = stripMetadata(bytes);
    const verified = scanMetadata(stripped.output);
    if (!verified.clean)
      return {
        exitCode: 1,
        stderr: "Stripped output failed metadata verification.\n",
        result: verified as unknown as Json,
      };
    writeFileSync(destination, stripped.output);
    const result = {
      ...report,
      destination,
      removedFindings: report.findings.length,
      verifiedClean: true,
    };
    const receiptId = await services.receipts.record(
      "sanitize.metadata-stripped",
      result as unknown as Json,
    );
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ type: "sanitize.metadata-stripped", source: file, ...result, receiptId }, null, jsonl ? 0 : 2)}\n`,
      result: { ...result, receiptId } as unknown as Json,
    };
  }
  const input =
    typeof x.text === "string"
      ? x.text
      : file
        ? readFileSync(file, "utf8")
        : await readStdin();
  if (!input)
    return {
      exitCode: 1,
      stderr: "Sanitize requires text, a file, or stdin.\n",
    };
  const report = scanText(input);
  const source = file || "stdin";
  if (x.detect === true) {
    const payload = { type: "sanitize.report", source, detect: true, ...report };
    return {
      exitCode: report.clean ? 0 : 1,
      stdout: `${JSON.stringify(payload, null, jsonl ? 0 : 2)}\n`,
      result: report as unknown as Json,
    };
  }
  const cleaned = cleanText(input);
  if (!scanText(cleaned.output).clean)
    return { exitCode: 1, stderr: "Cleaned output failed verification.\n" };
  const out = String(x.out ?? "").trim();
  if (out) {
    if ((await services.permissions.check("fs.write", out)) !== "allow")
      return { exitCode: 1, stderr: "fs.write permission denied.\n" };
    writeFileSync(out, cleaned.output, "utf8");
  }
  const result = { ...report, output: cleaned.output, verifiedClean: true };
  const receiptId = await services.receipts.record(
    "sanitize",
    result as unknown as Json,
  );
  const reportedOnly = report.findings.filter((finding) => finding.action === "reported").length;
  const addressed = report.findings.length - reportedOnly;
  const preserved = reportedOnly ? `; ${reportedOnly} reported-only finding(s) preserved` : "";
  return {
    exitCode: 0,
    stdout: jsonl
      ? `${JSON.stringify({ type: "sanitize.report", source, detect: false, ...report })}\n${JSON.stringify({ type: "sanitize.cleaned", source, output: cleaned.output, findings: report.findings.length, receiptId })}\n`
      : out
        ? `Cleaned output written to ${out} (${addressed} finding(s) addressed${preserved}; verified by re-scan).\n`
        : cleaned.output,
    ...(jsonl ? {} : { stderr: formatForensicReport(source, report) }),
    result: { ...result, receiptId } as unknown as Json,
  };
}
export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const command = {
        description:
          "Deterministically detect and remove hidden text and image metadata channels",
        inputSchema: schema,
        run: (input: Json, context: InvocationContext) =>
          runSanitize(input, context, services),
      };
      const disposers = [
        registrar.command("cli", {
          id: "cliCommands:0065",
          description: command.description,
          inputSchema: cliSchema,
          cli,
          run: command.run,
        }),
        registrar.command("tui", {
          id: "tuiSlashCommands:0060",
          ...command,
          parse: (value: string) => ({
            text: value.replace(/^\/sanitize\s*/i, ""),
          }),
        }),
      ];
      return async () => {
        for (const dispose of [...disposers].reverse()) await dispose();
      };
    },
  });
export default createMod;
