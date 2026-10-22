import { defineConfig } from "tsup";

// One self-contained file: every JS dependency is bundled, so the installed
// service needs no node_modules beyond the one native module.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^(?!better-sqlite3)/],
  external: ["better-sqlite3"],
  // Bundled CommonJS dependencies still call require(); give ESM one.
  banner: {
    js: 'import { createRequire as __ikatRequire } from "node:module"; const require = __ikatRequire(import.meta.url);',
  },
});
