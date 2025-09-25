import { OpenAI } from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AppConfig } from "../config.js";
import { ChromeDevToolsMCPClient } from "../mcp/chromeDevtoolsClient.js";
import { delay } from "../utils/time.js";
import { extractJsonPayload, extractTextPayload } from "../utils/toolResults.js";

const BreakpointPlanSchema = z
  .object({
    targetType: z.enum(["dom-event", "function-call"]),
    selector: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    functionName: z.string().min(1).optional(),
    explanation: z.string().optional(),
    consoleNotes: z.array(z.string()).default([])
  })
  .superRefine((value, ctx) => {
    if (value.targetType === "dom-event" && !value.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selector is required for dom-event plans"
      });
    }
    if (value.targetType === "function-call" && !value.functionName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "functionName is required for function-call plans"
      });
    }
  });

export type BreakpointPlan = z.infer<typeof BreakpointPlanSchema>;

export interface BreakpointGuideOptions {
  config: AppConfig;
  mcpClient: ChromeDevToolsMCPClient;
  openai: OpenAI;
}

export class BreakpointGuideAgent {
  private readonly config: AppConfig;
  private readonly mcpClient: ChromeDevToolsMCPClient;
  private readonly openai: OpenAI;

  constructor(options: BreakpointGuideOptions) {
    this.config = options.config;
    this.mcpClient = options.mcpClient;
    this.openai = options.openai;
  }

  async run(): Promise<void> {
    console.log("Connecting to Chrome DevTools MCP server...");
    await this.mcpClient.connect();
    console.log("Connected.");

    await this.enableDebuggingDomains();
    await this.navigateIfNeeded();

    const domOutline = await this.captureDomOutline();
    const toolSummary = await this.describeAvailableTools();

    console.log("Requesting breakpoint plan from OpenAI...");
    const plan = await this.generatePlan(domOutline, toolSummary);
    console.log("Plan received:", plan);

    console.log("Injecting instrumentation...");
    const evaluationResult = await this.installInstrumentation(plan);
    const textResult = extractTextPayload(evaluationResult);
    if (textResult.trim().length > 0) {
      console.log("Instrumentation response:", textResult);
    }
    const jsonResults = extractJsonPayload(evaluationResult);
    if (jsonResults.length > 0) {
      console.dir(jsonResults, { depth: 4 });
    }

    console.log("\n🎯 Breakpoint tour ready! Trigger the problematic interaction in the browser.");
    if (plan.targetType === "dom-event" && plan.selector) {
      console.log(`- Target selector: ${plan.selector}`);
      console.log(`- Event: ${plan.eventType ?? "click"}`);
    }
    if (plan.targetType === "function-call" && plan.functionName) {
      console.log(`- Wrapped function: ${plan.functionName}`);
    }
    console.log("Watch the DevTools console for '[BreakpointGuide]' logs and the Sources panel for the pause.");
    if (plan.consoleNotes.length > 0) {
      console.log("\nNotes from planner:");
      for (const note of plan.consoleNotes) {
        console.log(` • ${note}`);
      }
    }
  }

  private async enableDebuggingDomains(): Promise<void> {
    await this.mcpClient.callCdpMethod("Runtime.enable");
    await this.mcpClient.callCdpMethod("Debugger.enable");
    await this.mcpClient.callCdpMethod("DOM.enable");
    await this.mcpClient.callCdpMethod("Page.enable");
  }

  private async navigateIfNeeded(): Promise<void> {
    if (!this.config.navigationUrl) {
      return;
    }
    console.log(`Navigating page to ${this.config.navigationUrl} ...`);
    await this.mcpClient.callCdpMethod("Page.navigate", { url: this.config.navigationUrl });
    await delay(this.config.waitForPageMs);
  }

  private async captureDomOutline(): Promise<string> {
    try {
      const result = await this.mcpClient.callCdpMethod("DOM.getDocument", { depth: 2, pierce: true });
      const payloads = extractJsonPayload(result);
      for (const payload of payloads) {
        const outline = this.stringifyDomPayload(payload);
        if (outline) {
          return outline;
        }
      }
    } catch (error) {
      console.warn("Unable to capture DOM outline", error);
    }
    return "<dom outline unavailable>";
  }

  private stringifyDomPayload(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") {
      return undefined;
    }
    const root = this.resolveRootNode(payload);
    if (!root) {
      return undefined;
    }
    const lines: string[] = [];
    this.appendNodeSummary(root, lines, 0, 3, 8);
    return lines.join("\n");
  }

  private resolveRootNode(payload: unknown): unknown {
    if (!payload || typeof payload !== "object") {
      return undefined;
    }
    if ("root" in (payload as Record<string, unknown>)) {
      return (payload as Record<string, unknown>).root;
    }
    if ("result" in (payload as Record<string, unknown>)) {
      const result = (payload as Record<string, unknown>).result;
      if (result && typeof result === "object" && "root" in (result as Record<string, unknown>)) {
        return (result as Record<string, unknown>).root;
      }
    }
    return payload;
  }

  private appendNodeSummary(node: unknown, lines: string[], depth: number, maxDepth: number, maxChildren: number): void {
    if (!node || typeof node !== "object") {
      return;
    }
    const record = node as Record<string, unknown>;
    const nodeName = (record.nodeName ?? record.localName ?? record.name ?? "?") as string;
    const indent = "  ".repeat(depth);

    if (nodeName === "#text") {
      const value = String(record.nodeValue ?? "").trim();
      if (value.length === 0) {
        return;
      }
      lines.push(`${indent}#text ${value.slice(0, 60)}`);
      return;
    }

    const attrs = Array.isArray(record.attributes)
      ? this.formatAttributes(record.attributes as unknown[])
      : this.formatAttributeObject(record.attributes);
    const attrString = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
    lines.push(`${indent}<${nodeName.toLowerCase()}${attrString}>`);

    if (depth >= maxDepth) {
      const childCount = Array.isArray(record.children) ? (record.children as unknown[]).length : 0;
      if (childCount > 0) {
        lines.push(`${indent}  ... (${childCount} more children)`);
      }
      return;
    }

    const children = Array.isArray(record.children) ? (record.children as unknown[]) : [];
    const limited = children.slice(0, maxChildren);
    for (const child of limited) {
      this.appendNodeSummary(child, lines, depth + 1, maxDepth, maxChildren);
    }
    if (children.length > maxChildren) {
      lines.push(`${indent}  ... (${children.length - maxChildren} more children)`);
    }
  }

  private formatAttributes(attributes: unknown[]): string[] {
    const formatted: string[] = [];
    for (let i = 0; i < attributes.length; i += 2) {
      const key = String(attributes[i] ?? "");
      const value = String(attributes[i + 1] ?? "");
      if (key.length === 0) {
        continue;
      }
      formatted.push(`${key}="${value}"`);
    }
    return formatted;
  }

  private formatAttributeObject(attributes: unknown): string[] {
    if (!attributes || typeof attributes !== "object") {
      return [];
    }
    const formatted: string[] = [];
    for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
      formatted.push(`${key}="${String(value)}"`);
    }
    return formatted;
  }

  private async describeAvailableTools(): Promise<string> {
    try {
      const tools = await this.mcpClient.listTools();
      if (!tools || tools.length === 0) {
        return "(no tools reported)";
      }
      return tools
        .map((tool) => `${tool.name}: ${tool.description ?? ""}`.trim())
        .join("\n");
    } catch (error) {
      console.warn("Unable to list MCP tools", error);
      return "(tool listing failed)";
    }
  }

  private async generatePlan(domOutline: string, toolSummary: string): Promise<BreakpointPlan> {
    const schema = zodToJsonSchema(BreakpointPlanSchema, "BreakpointGuidePlan");
    const response = await this.openai.responses.parse({
      model: this.config.openAiModel,
      instructions:
        "You are an expert Chrome DevTools engineer who designs debugging breakpoints. Use DOM context and tool list to choose a plan.",
      response_format: {
        type: "json_schema",
        json_schema: schema
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Debugging goal: ${this.config.goal}`
            },
            {
              type: "input_text",
              text: `Available tools:\n${toolSummary}`
            },
            {
              type: "input_text",
              text: `DOM outline snippet:\n${domOutline}`
            }
          ]
        }
      ]
    });

    if (!response.output_parsed) {
      throw new Error("OpenAI did not return a structured breakpoint plan");
    }
    return BreakpointPlanSchema.parse(response.output_parsed);
  }

  private async installInstrumentation(plan: BreakpointPlan) {
    const expression =
      plan.targetType === "dom-event"
        ? this.buildEventInstrumentation(plan)
        : this.buildFunctionInstrumentation(plan);

    return this.mcpClient.callCdpMethod("Runtime.evaluate", {
      expression,
      includeCommandLineAPI: true,
      awaitPromise: false,
      returnByValue: true
    });
  }

  private buildEventInstrumentation(plan: BreakpointPlan): string {
    const selector = plan.selector ?? "";
    const eventType = plan.eventType ?? "click";
    const goal = this.config.goal;
    return `(() => {
  const selector = ${JSON.stringify(selector)};
  const eventType = ${JSON.stringify(eventType)};
  const label = ${JSON.stringify(goal)};
  const registryKey = selector + '::' + eventType;
  const guideState = window.__breakpointGuide ?? (window.__breakpointGuide = { handlers: {} });
  if (guideState.handlers[registryKey]) {
    console.info('[BreakpointGuide] handler already registered for', selector, eventType);
    return '[BreakpointGuide] already registered';
  }
  const target = document.querySelector(selector);
  if (!target) {
    console.warn('[BreakpointGuide] selector not found', selector);
    return '[BreakpointGuide] selector not found';
  }
  const handler = function(event) {
    try {
      console.group('[BreakpointGuide] ' + label);
      console.log('Event:', event.type);
      console.log('Target:', event.currentTarget);
      console.log('Arguments snapshot:', event);
      console.log('Stack trace:', new Error('BreakpointGuide trace').stack);
      console.groupEnd();
    } catch (error) {
      console.error('[BreakpointGuide] error while logging', error);
    }
    debugger;
  };
  guideState.handlers[registryKey] = handler;
  target.addEventListener(eventType, handler, { capture: false });
  console.info('[BreakpointGuide] instrumentation attached', selector, eventType);
  return '[BreakpointGuide] instrumentation attached';
})();`;
  }

  private buildFunctionInstrumentation(plan: BreakpointPlan): string {
    const functionName = plan.functionName ?? "";
    const goal = this.config.goal;
    return `(() => {
  const path = ${JSON.stringify(functionName.split('.'))};
  const label = ${JSON.stringify(goal)};
  if (!Array.isArray(path) || path.length === 0) {
    console.warn('[BreakpointGuide] invalid function path', path);
    return '[BreakpointGuide] invalid path';
  }
  let context = window;
  for (let i = 0; i < path.length - 1; i += 1) {
    const part = path[i];
    if (!context || !(part in context)) {
      console.warn('[BreakpointGuide] missing path segment', part);
      return '[BreakpointGuide] missing segment';
    }
    context = context[part];
  }
  const methodName = path[path.length - 1];
  const original = context ? context[methodName] : undefined;
  if (typeof original !== 'function') {
    console.warn('[BreakpointGuide] target is not a function', methodName);
    return '[BreakpointGuide] not a function';
  }
  if (original.__breakpointGuideWrapped) {
    console.info('[BreakpointGuide] function already wrapped', path.join('.'));
    return '[BreakpointGuide] already wrapped';
  }
  const wrapped = function(...args) {
    try {
      console.group('[BreakpointGuide] ' + label);
      console.log('Arguments:', args);
      console.log('this:', this);
      console.log('Stack trace:', new Error('BreakpointGuide trace').stack);
      console.groupEnd();
    } catch (error) {
      console.error('[BreakpointGuide] error while logging', error);
    }
    debugger;
    return original.apply(this, args);
  };
  Object.defineProperties(wrapped, {
    __breakpointGuideWrapped: { value: true },
    __breakpointGuideOriginal: { value: original }
  });
  context[methodName] = wrapped;
  console.info('[BreakpointGuide] wrapped function', path.join('.'));
  return '[BreakpointGuide] wrapped function';
})();`;
  }
}
