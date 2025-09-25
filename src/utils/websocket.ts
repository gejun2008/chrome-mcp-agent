import NodeWebSocket from "ws";

export function ensureWebSocketPolyfill(): void {
  const globalWithWs = globalThis as typeof globalThis & { WebSocket?: unknown };
  if (typeof globalWithWs.WebSocket === "undefined") {
    const wsCtor = NodeWebSocket as unknown as typeof globalThis.WebSocket;
    globalWithWs.WebSocket = wsCtor;
  }
}
