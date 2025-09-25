import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const RawConfigSchema = z.object({
  openAiApiKey: z.string().min(1, "OPENAI_API_KEY is required"),
  openAiModel: z.string().min(1).default("gpt-4.1-mini"),
  mcpServerUrl: z.string().url("MCP_SERVER_URL must be a valid URL"),
  mcpCdpToolName: z.string().min(1).optional(),
  goal: z.string().min(1, "A debugging goal is required"),
  navigationUrl: z.string().url().optional(),
  waitForPageMs: z.coerce.number().int().positive().default(2500)
});

export type AppConfig = z.infer<typeof RawConfigSchema>;

function parseArgs(argv: string[]): Partial<AppConfig> {
  const partial: Partial<AppConfig> = {};
  for (const raw of argv) {
    const [rawKey, ...rest] = raw.replace(/^--/, "").split("=");
    if (!rawKey) {
      continue;
    }
    const key = rawKey.trim();
    const value = rest.join("=");
    switch (key) {
      case "goal":
        partial.goal = value;
        break;
      case "target-url":
      case "navigation-url":
        partial.navigationUrl = value;
        break;
      case "mcp-url":
        partial.mcpServerUrl = value;
        break;
      case "mcp-cdp-tool":
        partial.mcpCdpToolName = value;
        break;
      case "wait-ms":
        partial.waitForPageMs = Number.parseInt(value, 10);
        break;
      case "openai-model":
        partial.openAiModel = value;
        break;
      case "openai-key":
        partial.openAiApiKey = value;
        break;
      default:
        if (key.length > 0) {
          console.warn(`Unknown CLI argument --${key} ignored.`);
        }
    }
  }
  return partial;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const cli = parseArgs(argv);

  const configInput: Record<string, unknown> = {
    openAiApiKey: cli.openAiApiKey ?? process.env.OPENAI_API_KEY ?? "",
    openAiModel: cli.openAiModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    mcpServerUrl: cli.mcpServerUrl ?? process.env.MCP_SERVER_URL ?? "",
    mcpCdpToolName: cli.mcpCdpToolName ?? process.env.MCP_CDP_TOOL_NAME,
    goal: cli.goal ?? process.env.BREAKPOINT_GOAL ?? "",
    navigationUrl: cli.navigationUrl ?? process.env.TARGET_URL ?? process.env.NAVIGATION_URL,
    waitForPageMs: cli.waitForPageMs ?? (process.env.WAIT_FOR_PAGE_MS ? Number.parseInt(process.env.WAIT_FOR_PAGE_MS, 10) : undefined)
  };

  return RawConfigSchema.parse(configInput);
}
