import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "es2020",
  dts: true,
  clean: true,
  external: ["react"],
  // The library uses hooks and context, so React Server Components must treat it as client code.
  banner: { js: '"use client";' },
});
