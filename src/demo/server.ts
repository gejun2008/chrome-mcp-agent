import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";
import { fileURLToPath } from "url";

const DEFAULT_PORT = 4173;
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(currentDir, "../../public");

const rawPort = process.env.DEMO_PORT ?? String(DEFAULT_PORT);
const port = Number.parseInt(rawPort, 10) || DEFAULT_PORT;

const server = createServer(async (req, res) => {
  try {
    const urlPathRaw = req.url ?? "/";
    const urlPath = urlPathRaw.split("?")[0] ?? "/";
    const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = join(publicDir, relativePath);
    const body = await readFile(filePath);
    const mime = MIME_TYPES[extname(filePath)] ?? "text/plain; charset=utf-8";
    res.writeHead(200, { "Content-Type": mime });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(port, () => {
  console.log(`Demo page available at http://localhost:${port}`);
});
