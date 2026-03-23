import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { Readable } from "node:stream";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "epub-proxy",
      configureServer(server) {
        server.middlewares.use("/epub-proxy", async (req, res) => {
          try {
            const urlObj = new URL(req.url, "http://localhost");
            const target = urlObj.searchParams.get("url");

            if (!target) {
              res.statusCode = 400;
              res.end("Missing ?url=");
              return;
            }

            const r = await fetch(target, { redirect: "follow" });

            if (!r.ok) {
              res.statusCode = r.status;
              res.end(`Fetch failed: ${r.status}`);
              return;
            }

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader(
              "Content-Type",
              r.headers.get("content-type") || "application/epub+zip"
            );

            if (!r.body) {
              res.statusCode = 500;
              res.end("No response body from upstream");
              return;
            }

            Readable.fromWeb(r.body).pipe(res);
          } catch (e) {
            console.error("EPUB proxy error:", e);
            res.statusCode = 500;
            res.end(`Proxy error: ${e.message}`);
          }
        });
      },
    },
  ],
});