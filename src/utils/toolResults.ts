import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ToolContent =
  | { type: "text"; text: string }
  | { type: "json"; json: unknown }
  | { type: string; [key: string]: unknown };

export function extractJsonPayload(result: CallToolResult): unknown[] {
  const payloads: unknown[] = [];
  const contents = (result.content ?? []) as ToolContent[];
  for (const item of contents) {
    if (item.type === "json") {
      payloads.push(item.json);
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      try {
        payloads.push(JSON.parse(item.text));
      } catch (error) {
        // ignore non-JSON text
      }
    }
  }
  return payloads;
}

export function extractTextPayload(result: CallToolResult): string {
  const contents = (result.content ?? []) as ToolContent[];
  const lines: string[] = [];
  for (const item of contents) {
    if (item.type === "text" && typeof item.text === "string") {
      lines.push(item.text);
    }
  }
  return lines.join("\n");
}
