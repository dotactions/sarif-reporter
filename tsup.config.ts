import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        "dist/index": "src/index.ts",
    },
    format: ["cjs"],
    platform: "node",
    target: "node24",
    outDir: ".",
    outExtension: () => ({ js: ".cjs" }),
    bundle: true,
    splitting: false,
    clean: false,
    minify: true,
    sourcemap: false,
    noExternal: [/.*/],
});
