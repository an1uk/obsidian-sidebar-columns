import * as esbuild from "esbuild";
const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"], outfile: "main.js", bundle: true,
  platform: "browser", format: "cjs", target: "es2018",
  external: ["obsidian", "electron", ...["node:crypto", "crypto"]],
  sourcemap: watch ? "inline" : false, minify: false,
  banner: {js: "/* Sidebar Columns 0.1.0 - experimental. Source distributed under 0BSD. */"},
  logLevel: "info"
});
if (watch) await context.watch();
else { await context.rebuild(); await context.dispose(); }
