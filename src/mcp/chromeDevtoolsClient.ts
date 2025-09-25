import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ensureWebSocketPolyfill } from "../utils/websocket.js";

const DEFAULT_CDP_TOOL_CANDIDATES = [
  "cdp",
  "call_cdp",
  "chromium-cdp",
  "chrome-devtools:call_cdp",
  "call-cdp-method",
  "devtools-cdp",
  "cdp.call",
  "cdp-method"
];

export interface ChromeDevToolsClientOptions {
  serverUrl: string;
  explicitCdpToolName?: string;
}

export class ChromeDevToolsMCPClient {
  private readonly options: ChromeDevToolsClientOptions;
  private client: Client | undefined;
  private transport: WebSocketClientTransport | undefined;
  private cdpToolName: string | undefined;

  constructor(options: ChromeDevToolsClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    ensureWebSocketPolyfill();

    const url = new URL(this.options.serverUrl);
    const client = new Client({
      name: "breakpoint-tour-agent",
      version: "0.1.0"
    });

    client.onerror = (error) => {
      console.error("[MCP client] error", error);
    };

    const transport = new WebSocketClientTransport(url);
    await client.connect(transport);

    this.client = client;
    this.transport = transport;

    this.cdpToolName = await this.resolveCdpToolName();
    if (!this.cdpToolName) {
      throw new Error(
        "Unable to discover a CDP bridge tool on the connected MCP server. Provide MCP_CDP_TOOL_NAME explicitly."
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
    this.transport = undefined;
    this.client = undefined;
  }

  async callCdpMethod(method: string, params: Record<string, unknown> = {}): Promise<CallToolResult> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    if (!this.cdpToolName) {
      throw new Error("CDP tool name is not resolved");
    }

    const result = await this.client.callTool({
      name: this.cdpToolName,
      arguments: {
        method,
        params
      }
    });
    return result as CallToolResult;
  }

  async listTools(): Promise<Array<{ name: string; description?: string | undefined }>> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    const result = await this.client.listTools();
    return (result.tools ?? []) as Array<{ name: string; description?: string | undefined }>;
  }

  private async resolveCdpToolName(): Promise<string | undefined> {
    if (this.options.explicitCdpToolName) {
      return this.options.explicitCdpToolName;
    }
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    try {
      const availableTools = await this.listTools();
      const candidates = new Set(DEFAULT_CDP_TOOL_CANDIDATES.map((name) => name.toLowerCase()));
      for (const tool of availableTools) {
        const name = tool.name.toLowerCase();
        if (candidates.has(name) || name.includes("cdp")) {
          return tool.name;
        }
        if ((tool.description ?? "").toLowerCase().includes("cdp")) {
          return tool.name;
        }
      }
    } catch (error) {
      console.warn("Failed to auto-discover CDP tool", error);
    }

    return undefined;
  }
}
