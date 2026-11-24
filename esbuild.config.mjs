import esbuild from "esbuild";
import process from "node:process";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";

// `import ocr from "vision-ocr-binary"` is native/vision_ocr (see native/build.sh) as base64, so the
// OCR helper reaches users who install only main.js, manifest.json and styles.css.
const visionOcr = {
  name: "vision-ocr-binary",
  setup(build) {
    build.onResolve({ filter: /^vision-ocr-binary$/ }, () => ({ path: "vision-ocr-binary", namespace: "binary" }));
    build.onLoad({ filter: /.*/, namespace: "binary" }, () => ({
      contents: readFileSync(new URL("./native/vision_ocr", import.meta.url)),
      loader: "base64",
      watchFiles: [new URL("./native/vision_ocr", import.meta.url).pathname],
    }));
  },
};

const banner = `"use strict";

/*
  Crisp Visual by letschips (Xiaohongshu: letschips).
  Generated from src/ by esbuild.config.mjs. Edit src/, then run npm run build.
*/
`;

const context = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  external: ["obsidian", "electron", ...builtinModules],
  format: "cjs",
  platform: "node",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  outfile: "main.js",
  minify: false,
  plugins: [visionOcr],
  banner: { js: banner },
  // Obsidian and the tests load the plugin class as module.exports itself.
  footer: { js: "module.exports = module.exports.default;" },
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
