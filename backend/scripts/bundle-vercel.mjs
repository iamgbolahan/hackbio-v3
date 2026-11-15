// Bundles the Express app into one minified CommonJS file: api/index.js. Dependencies stay external
// (Vercel installs them from package.json); only this project's own source is inlined.
import { build } from "esbuild";

await build({
  entryPoints: ["api/handler.ts"],
  outfile: process.argv[2] || "dist-vercel/api/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minify: true,
  legalComments: "none",
  external: ["express", "cors", "cookie-parser", "zod", "csv-parse", "pg", "@prisma/*", "generated/*", "@simplewebauthn/server"],
});
