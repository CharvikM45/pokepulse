import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const generated = resolve("test-results/components/browser");
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    if (pathname === "/packages/ui/src/tokens.css") {
      response
        .writeHead(200, { "Content-Type": "text/css" })
        .end(await readFile("packages/ui/src/tokens.css"));
      return;
    }
    if (!pathname.startsWith("/qa/")) {
      response.writeHead(404).end();
      return;
    }
    const file = resolve(generated, "." + pathname.slice(3));
    if (!file.startsWith(generated + sep)) {
      response.writeHead(403).end();
      return;
    }
    const type = { ".html": "text/html", ".js": "text/javascript" }[
      extname(file)
    ];
    if (!type) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": type }).end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(4174, "127.0.0.1", () => process.send?.("ready"));
