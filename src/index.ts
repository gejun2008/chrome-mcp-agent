import { OpenAI } from "openai";
import { loadConfig } from "./config.js";
import { BreakpointGuideAgent } from "./agent/breakpointGuide.js";
import { ChromeDevToolsMCPClient, type ChromeDevToolsClientOptions } from "./mcp/chromeDevtoolsClient.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const openai = new OpenAI({ apiKey: config.openAiApiKey });
  const clientOptions: ChromeDevToolsClientOptions = {
    serverUrl: config.mcpServerUrl,
    ...(config.mcpCdpToolName ? { explicitCdpToolName: config.mcpCdpToolName } : {})
  };
  const mcpClient = new ChromeDevToolsMCPClient(clientOptions);

  const agent = new BreakpointGuideAgent({
    config,
    mcpClient,
    openai
  });

  try {
    await agent.run();
  } catch (error) {
    console.error("Breakpoint guide failed:", error);
    process.exitCode = 1;
  } finally {
    await mcpClient.disconnect();
  }
}

void main();
