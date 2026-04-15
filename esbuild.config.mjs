import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// Load .env.local for OBSIDIAN_VAULT if present
let obsidianVault = "";
try {
  const env = fs.readFileSync(".env.local", "utf8");
  const match = env.match(/^OBSIDIAN_VAULT=(.+)$/m);
  if (match) obsidianVault = match[1].trim();
} catch {}

/** Copy src/styles/main.css → styles.css after each build */
const copyCSS = {
  name: "copy-css",
  setup(build) {
    build.onEnd(() => {
      try {
        fs.copyFileSync("src/styles/main.css", "styles.css");
      } catch (e) {
        console.warn("[copy-css] Failed:", e.message);
      }
    });
  },
};

/** @type {import('esbuild').Plugin} */
const copyToObsidian = {
  name: "copy-to-obsidian",
  setup(build) {
    if (!obsidianVault) return;
    build.onEnd(() => {
      const dest = path.join(obsidianVault, ".obsidian", "plugins", "obsidian-claude-code");
      fs.mkdirSync(dest, { recursive: true });
      for (const file of ["main.js", "manifest.json", "styles.css"]) {
        try {
          fs.copyFileSync(file, path.join(dest, file));
        } catch {}
      }
      console.log(`[copy-to-obsidian] Copied to ${dest}`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  define: {
    "import.meta.url": JSON.stringify("file:///obsidian-plugin"),
  },
  plugins: [copyCSS, copyToObsidian],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
