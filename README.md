# Chrome DevTools Breakpoint Tour Prototype

This prototype wires an OpenAI-powered agent to the Chrome DevTools Model Context Protocol (MCP) server. The agent receives a debugging goal, inspects the current page via MCP, asks the OpenAI Responses API to design a breakpoint plan, and injects instrumentation that logs call stacks and pauses execution right where the issue lives.

The repository also contains a tiny demo web app with a hidden asynchronous bug. Run the agent and watch it hook into the page without any manual fiddling.

## Features

- Connects to the Chrome DevTools MCP server over WebSocket.
- Auto-discovers the CDP bridge tool (or lets you override it).
- Captures a DOM outline, feeds it to OpenAI, and requests a structured breakpoint plan.
- Injects breakpoint helpers that log variables and call stacks before triggering `debugger`.
- Ships with a playground page (`public/index.html`) and a static file server for local testing.

## Prerequisites

1. **Node.js 18+**
2. **OpenAI API key** with access to the Responses API (e.g. `gpt-4.1-mini`).
3. **Chrome DevTools MCP server**. Follow Google's instructions to enable the DevTools MCP bridge (public preview) and note the server URL plus the tool name that proxies CDP calls.
4. A Chrome instance attached to the MCP server (usually Chrome must run with remote debugging enabled).

> ℹ️ The exact setup flow for the Chrome DevTools MCP server may change while the preview evolves. Refer to the [Chrome for Developers announcement](https://developer.chrome.com/docs/devtools) for the latest CLI and configuration details.

## Getting started

```bash
npm install
cp .env.example .env
# edit .env with your keys and MCP endpoint
```

Compile the TypeScript sources:

```bash
npm run build
```

### Launch the demo page (optional)

```bash
npm run start:demo-server
```

The playground will be served from `http://localhost:4173`. Point Chrome to this URL and ensure the MCP server has access to the same page context.

### Run the breakpoint tour agent

Once the MCP server is reachable, execute:

```bash
npm start
```

Environment variables from `.env` are picked up automatically. You can also override options via CLI flags:

```
npm start -- \
  --goal="帮我跟踪保存按钮点击没有反馈的原因" \
  --navigation-url=http://localhost:4173/ \
  --mcp-url=ws://localhost:4030/ \
  --mcp-cdp-tool=call_cdp
```

Supported flags mirror the `.env` keys:

| Flag | Description |
| --- | --- |
| `--goal` | Natural-language debugging request. Required. |
| `--navigation-url` | Page URL to load before planning. Optional. |
| `--mcp-url` | WebSocket URL for the MCP server. Required. |
| `--mcp-cdp-tool` | Name of the MCP tool that forwards CDP commands. Optional (auto-detect). |
| `--wait-ms` | Delay after navigation before inspecting the DOM (default `2500`). |
| `--openai-model` | Model id for the Responses API. |

## How it works

1. **Connect to MCP** – the client opens a WebSocket transport and looks for a CDP bridge tool (name contains `cdp`).
2. **Prime debugging domains** – `Runtime`, `Debugger`, `DOM`, and `Page` are enabled.
3. **Optional navigation** – if a navigation URL is provided, the agent triggers a `Page.navigate` call and waits briefly.
4. **Page context capture** – a trimmed DOM outline plus the available tool list are collected via MCP.
5. **LLM planning** – the DOM summary, tool list and user goal feed into the OpenAI Responses API with a JSON schema. The model replies with either a DOM-event or function-call plan.
6. **Instrumentation injection** – the agent evaluates a JavaScript snippet through `Runtime.evaluate` that logs arguments, prints a stack trace, and executes `debugger;` for the chosen target.
7. **Interactive follow-up** – trigger the problematic UI flow in Chrome and watch the console logs plus paused call stack.

## Troubleshooting

- **No CDP tool found** – set `MCP_CDP_TOOL_NAME` to the exact tool name reported by `tools/list` on your MCP server (e.g. `call_cdp`, `chrome-devtools:call_cdp`).
- **Plan missing selector** – the DOM outline might be too shallow. Increase `WAIT_FOR_PAGE_MS` so the page finishes rendering before inspection.
- **Chrome does not pause** – make sure DevTools is open for the inspected tab and that Chrome is launched with remote debugging enabled.
- **Large pages** – the DOM serializer trims depth and children counts to keep the prompt compact. Adjust `appendNodeSummary` in `src/agent/breakpointGuide.ts` if you need more context.

## Limitations & next steps

- The agent currently logs only to the console and uses simple `debugger;` statements. A next iteration could subscribe to `Debugger.paused` events via MCP and stream the call stack back to the terminal.
- Security is left to the MCP server. Lock down which hosts the agent can touch.
- Error handling around the MCP protocol is minimal; production tooling should retry and guard against tool poisoning.

Happy breakpoint touring! ✨
