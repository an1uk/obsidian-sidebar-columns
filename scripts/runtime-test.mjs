import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, normalize, basename } from "node:path";
import { homedir, type as osType, release as osRelease, arch as osArch } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { readAsar } from "./asar.mjs";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.14.4";
const LIVE_VAULT = process.env.SIDEBAR_COLUMNS_SOURCE_VAULT;
assert.ok(LIVE_VAULT, "Set SIDEBAR_COLUMNS_SOURCE_VAULT to a read-only asset-source vault before runtime testing.");
const SOURCE_CONFIG_DIR = process.env.SIDEBAR_COLUMNS_SOURCE_CONFIG_DIR ?? ".obsidian";
assert.ok(!pathIsUnsafe(SOURCE_CONFIG_DIR), "Asset-source configuration directory must be vault-relative.");
function pathIsUnsafe(value) { return !value || /^[\\/]/.test(value) || value.includes(":") || value.split(/[\\/]/).some(part => !part || part === "." || part === ".."); }
const ROAMING_OBSIDIAN = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "obsidian");
const EXE = process.env.SIDEBAR_COLUMNS_OBSIDIAN_EXE ?? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Programs", "Obsidian", "Obsidian.exe");
const SOURCE_ASAR = process.env.SIDEBAR_COLUMNS_ASAR ?? join(ROAMING_OBSIDIAN, "obsidian-" + VERSION + ".asar");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomBytes(4).toString("hex");
const RUN = join(PROJECT, ".runtime-tests", RUN_ID);
const PROFILE = join(RUN, "profile"), VAULT = join(RUN, "vault"), EVIDENCE = join(RUN, "evidence");
const ASAR = join(PROFILE, "obsidian-" + VERSION + ".asar"), FIXTURE_ID = randomBytes(8).toString("hex");
const shouldRun = process.argv.includes("--run");
const rtlRun = process.argv.includes("--rtl");
const report = {
  runId: RUN_ID, startedAt: new Date().toISOString(), platform: process.platform,
  os: osType() + " " + osRelease() + " (" + osArch() + ")", automatedChecks: "Run pnpm test separately; no result is inferred by this harness", locale: rtlRun?"ar":"en", expectedVersion: VERSION, installerVersion: null, runDirectory: RUN,
  sourceArchiveSha256: null, isolation: null, assets: [], cases: [], consoleErrors: [], productionGuard: null,
  limitations: [
    "Windows only; macOS and Linux native acceptance remains manual.",
    "Renderer 1.14.4 on installed launcher 1.12.7; latest installer acceptance remains manual.",
    "Theme coverage uses only copied installed distributable assets and clean fixture settings.",
    "Only individually recorded passed scenarios establish runtime acceptance.",
  ],
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = p => createHash("sha256").update(readFileSync(p)).digest("hex");
const canonical = p => normalize(resolve(p)).toLowerCase();
function safeWrite(p) {
  assert.ok(canonical(p).startsWith(canonical(RUN) + "\\"), "Refusing write outside this runtime directory");
  mkdirSync(dirname(p), { recursive: true });
}
function write(p, content) { safeWrite(p); writeFileSync(p, content, "utf8"); }
function json(p, content) { write(p, JSON.stringify(content, null, 2) + "\n"); }
function copy(source, target) { safeWrite(target); copyFileSync(source, target); }
function protocolCommand() {
  const out = execFileSync("reg.exe", ["query", "HKCU\\Software\\Classes\\obsidian\\shell\\open\\command", "/ve"],
    { encoding: "utf8", windowsHide: true });
  const m = out.match(/REG_SZ\s+(.+)/);
  assert.ok(m, "Cannot determine the protocol handler"); return m[1].trim();
}
function assertProtocol() {
  assert.equal(protocolCommand(), '"' + EXE + '" "%1"', "Protocol mismatch; launch might change Windows registration");
}
function productionSnapshot() {
  const paths = [
    join(ROAMING_OBSIDIAN, "obsidian.json"),
    join(dirname(EXE), "resources", "app.asar"), SOURCE_ASAR,
  ];
  const walk = folder => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const p = join(folder, entry.name);
      if (entry.isDirectory() && !["node_modules", ".git"].includes(entry.name)) walk(p);
      else if (entry.name.endsWith(".json")) paths.push(p);
    }
  };
  walk(join(LIVE_VAULT, SOURCE_CONFIG_DIR));
  return { protocol: protocolCommand(), hashes: Object.fromEntries(paths.map(p => [p, sha(p)])) };
}
const leaf = (id, type, state = {}) => ({ id, type: "leaf", state: { type, state } });
const tab = (id, children) => ({ id, type: "tabs", children });
function stage() {
  assert.equal(process.platform, "win32"); assertProtocol();
  assert.equal(JSON.parse(readAsar(SOURCE_ASAR).read("package.json").toString()).version, VERSION);
  report.installerVersion = JSON.parse(readAsar(join(dirname(EXE), "resources", "app.asar"))
    .read("package.json").toString()).version;
  mkdirSync(PROFILE, { recursive: true }); mkdirSync(EVIDENCE, { recursive: true });
  copy(SOURCE_ASAR, ASAR); report.sourceArchiveSha256 = sha(SOURCE_ASAR);
  assert.equal(sha(ASAR), report.sourceArchiveSha256);
  json(join(PROFILE, "obsidian.json"), {
    vaults: { [FIXTURE_ID]: { path: VAULT, ts: Date.now(), open: true } }, updateDisabled: true, cli: false, language: rtlRun ? "ar" : "en",
  });
  write(join(VAULT, "Fixture A.md"), "# Fixture A\n\nRuntime verification fixture.\n\n## Section\n\nA preserved central editor.\n");
  write(join(VAULT, "Fixture B.md"), "# Fixture B\n\n[[Fixture A]]\n");
  write(join(VAULT, "2026-10-08.md"), "# Daily note fixture\n");
  json(join(VAULT, ".obsidian", "app.json"), { safeMode: false });
  json(join(VAULT, ".obsidian", "appearance.json"), { theme: "obsidian" });
  json(join(VAULT, ".obsidian", "core-plugins.json"), [
    "file-explorer", "global-search", "switcher", "backlink", "outgoing-link", "tag-pane",
    "daily-notes", "command-palette", "bookmarks", "outline", "workspaces",
  ]);
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    assert.ok(existsSync(join(PROJECT, name)), "Build plugin before staging; missing " + name);
    copy(join(PROJECT, name), join(VAULT, ".obsidian", "plugins", "sidebar-columns", name));
  }
  report.pluginArtifacts=Object.fromEntries(["main.js","manifest.json","styles.css"].map(n=>[n,sha(join(PROJECT,n))]));const h=process.argv.indexOf("--expected-build-hash");if(h>=0)assert.equal(report.pluginArtifacts["main.js"],process.argv[h+1]);
  const community = ["sidebar-columns"];
  const calendar = join(LIVE_VAULT, SOURCE_CONFIG_DIR, "plugins", "calendar");
  if (existsSync(join(calendar, "main.js")) && existsSync(join(calendar, "manifest.json"))) {
    for (const name of ["main.js", "manifest.json", "styles.css"]) if (existsSync(join(calendar, name))) {
      copy(join(calendar, name), join(VAULT, ".obsidian", "plugins", "calendar", name));
    }
    community.push("calendar");
    report.assets.push({ kind: "plugin", name: "Calendar",
      version: JSON.parse(readFileSync(join(calendar, "manifest.json"), "utf8")).version, settingsCopied: false });
  }
  json(join(VAULT, ".obsidian", "community-plugins.json"), community);
  for (const name of ["Minimal", "Blue Topaz", "AnuPpuccin"]) {
    const source = join(LIVE_VAULT, SOURCE_CONFIG_DIR, "themes", name);
    if (!existsSync(join(source, "theme.css")) || !existsSync(join(source, "manifest.json"))) continue;
    for (const f of ["manifest.json", "theme.css"]) copy(join(source, f), join(VAULT, ".obsidian", "themes", name, f));
    report.assets.push({ kind: "theme", name,
      version: JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")).version, settingsCopied: false });
  }
  json(join(VAULT, ".obsidian", "workspace.json"), {
    main: { id: "fixture-main", type: "split", direction: "vertical", children: [
      tab("fixture-center", [
        leaf("fixture-a", "markdown", { file: "Fixture A.md", mode: "source", source: false }),
        leaf("fixture-b", "markdown", { file: "Fixture B.md", mode: "source", source: false }),
      ]),
    ] },
    left: { id: "fixture-left", type: "split", direction: "horizontal", width: 440, collapsed: false, children: [
      tab("fixture-files", [leaf("fixture-explorer", "file-explorer")]),
      tab("fixture-search", [leaf("fixture-search-leaf", "search", { query: "Fixture" })]),
    ] },
    right: { id: "fixture-right", type: "split", direction: "horizontal", width: 440, collapsed: false, children: [
      tab("fixture-links", [leaf("fixture-backlinks", "backlink")]),
      tab("fixture-tools", [leaf("fixture-outline", "outline"),
        ...(community.includes("calendar") ? [leaf("fixture-calendar", "calendar")] : [])]),
    ] }, active: "fixture-a",
  });
  json(join(VAULT, ".obsidian", "workspaces.json"), { workspaces: {}, active: null });
}
class CDP {
  constructor(url) {
    this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", event => {
      const m = JSON.parse(event.data);
      if (m.id) {
        const p = this.pending.get(m.id); if (!p) return;
        clearTimeout(p.timeout); this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else for (const cb of this.listeners.get(m.method) ?? []) cb(m.params);
    });
    this.socket.addEventListener("close", () => {
      for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error("CDP closed")); }
      this.pending.clear();
    });
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timeout }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, callback) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(callback);
  }
  async run(fn, ...args) {
    const expression = "(" + fn.toString() + ")(" + args.map(a => JSON.stringify(a)).join(",") + ")";
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  close() { this.socket.close(); }
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
const psQuote = text => "'" + text.replaceAll("'", "''") + "'";
function launch(port) {
  assertProtocol();
  const args = ['--user-data-dir="' + PROFILE + '"', "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=" + port, "session=sidebar-columns-isolated-" + randomBytes(8).toString("hex")];
  const command = "$p = Start-Process -FilePath " + psQuote(EXE) + " -ArgumentList @("
    + args.map(psQuote).join(",") + ") -WorkingDirectory " + psQuote(RUN) + " -WindowStyle Hidden -PassThru; $p.Id";
  const pid = Number(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true }).trim());
  assert.ok(Number.isInteger(pid) && pid > 0); return pid;
}
async function attach(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const target = targets.find(t => t.type === "page" && t.url.includes("obsidian.md/index.html"));
      if (target) { const c = new CDP(target.webSocketDebuggerUrl); await c.ready;
        c.on("Runtime.exceptionThrown",p=>report.consoleErrors.push(p.exceptionDetails));
        c.on("Runtime.consoleAPICalled",p=>{if(p.type==="error")report.consoleErrors.push({type:"console",text:p.args.map(a=>a.value??a.description).join(" ")})});
        await c.send("Runtime.enable");return c; }
    } catch {}
    await delay(250);
  }
  throw new Error("Isolated renderer not ready; no URI or CLI fallback is allowed");
}
async function assertIsolation(cdp) {
  const s = await cdp.run(() => {
    const ipc = require("electron").ipcRenderer;
    return { resources: ipc.sendSync("resources"), version: ipc.sendSync("version"),
      vault: ipc.sendSync("vault"), vaults: ipc.sendSync("vault-list"), basePath: app.vault.adapter.getBasePath() };
  });
  assert.equal(canonical(s.resources), canonical(ASAR)); assert.equal(s.version, VERSION);
  assert.equal(canonical(s.vault.path), canonical(VAULT)); assert.equal(canonical(s.basePath), canonical(VAULT));
  assert.deepEqual(Object.keys(s.vaults), [FIXTURE_ID]);
  assert.equal(canonical(s.vaults[FIXTURE_ID].path), canonical(VAULT)); report.isolation = s;
}
async function readiness(cdp) {
  let trusted=false;
  for (let i = 0; i < 100; i++) {
    if(!trusted) trusted=await cdp.run(rtl=>{const button=[...document.querySelectorAll(".modal button")].find(b=>b.textContent.trim()==="Trust author and enable plugins");if(button){button.click();return true}if(rtl){const b=[...document.querySelectorAll(".modal button")];if(b.length===2){b[1].click();return true}}return false},rtlRun);
    if (await cdp.run(() => Boolean(window.app?.workspace?.leftSplit && app.plugins?.plugins?.["sidebar-columns"]?.adapter && app.plugins?.plugins?.["sidebar-columns"]?.operations))) return;
    await delay(200);
  }
  const diagnostic = await cdp.run(() => ({hasApp:Boolean(window.app),layoutReady:app.workspace?.layoutReady,plugins:Object.keys(app.plugins?.plugins??{}),safeMode:app.plugins?.safeMode,body:document.body.innerText.slice(0,3000)}));
  json(join(EVIDENCE,"readiness-diagnostic.json"),diagnostic);
  const shot=await cdp.send("Page.captureScreenshot",{format:"png"});const p=join(EVIDENCE,"readiness-diagnostic.png");safeWrite(p);writeFileSync(p,Buffer.from(shot.data,"base64"));
  throw new Error("Plugin readiness timed out: "+JSON.stringify(diagnostic));
}
function runtimeSnapshot() {
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, display: getComputedStyle(el).display }; };
  const visit = n => ({ id: n.id ?? null, class: n.constructor.name, direction: n.direction ?? null,
    geometry: rect(n.containerEl), type: n.view?.getViewType?.() ?? null, file: n.view?.file?.path ?? null,
    children: Array.isArray(n.children) ? n.children.map(visit) : [] });
  const groups = root => [...root.containerEl.querySelectorAll(".workspace-tabs")].map(rect).filter(r => r.width > 0 && r.height > 0);
  const p = app.plugins.plugins["sidebar-columns"];
  return { main: visit(app.workspace.rootSplit), left: visit(app.workspace.leftSplit), right: visit(app.workspace.rightSplit),
    groups: { left: groups(app.workspace.leftSplit), right: groups(app.workspace.rightSplit) },
    collapsed: p.adapter.getCollapsedCount(), acknowledged: p.settings.acknowledged };
}
function nodes(n, result = []) { result.push(n); for (const c of n.children ?? []) nodes(c, result); return result; }
function columns(snapshot, side) { return new Set(snapshot.groups[side].map(r => Math.round(r.x))).size; }
const stripGeometry = n => ({ id: n.id, class: n.class, direction: n.direction, type: n.type, file: n.file,
  children: n.children.map(stripGeometry) });
async function snapshot(cdp, name) {
  const s = await cdp.run(runtimeSnapshot); json(join(EVIDENCE, name + ".json"), s);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const p = join(EVIDENCE, name + ".png"); safeWrite(p); writeFileSync(p, Buffer.from(shot.data, "base64")); return s;
}
async function focus(cdp, id) {
  await cdp.run(id => { let leaf = null; app.workspace.iterateAllLeaves(l => { if (l.id === id) leaf = l; });
    if (!leaf) throw Error("Fixture leaf disappeared: " + id); app.workspace.setActiveLeaf(leaf, { focus: true }); }, id);
  if(["fixture-a","fixture-b"].includes(id)){await delay(100);return;}
  const position=await cdp.run(id=>{let leaf=null;app.workspace.iterateAllLeaves(l=>{if(l.id===id)leaf=l});const r=leaf.tabHeaderEl.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}},id);
  await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...position});
  await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...position});
  await delay(100);
  const diagnostic=await cdp.run(id=>{const p=app.plugins.plugins["sidebar-columns"];let leaf=null;app.workspace.iterateAllLeaves(l=>{if(l.id===id)leaf=l});let target,commandTarget,compatible;try{target=p.adapter.resolveTarget(leaf).side}catch(e){target=e.message}try{commandTarget=p.adapter.resolveCommandTarget().side}catch(e){commandTarget=e.message}try{p.adapter.assertCompatible();compatible=true}catch(e){compatible=e.message}return {active:app.workspace.activeLeaf?.id,activeElement:document.activeElement?.outerHTML.slice(0,500),target,commandTarget,compatible}},id);
  json(join(EVIDENCE,"focus-"+id+".json"),diagnostic);
}
async function command(cdp, suffix) {
  return cdp.run(id => app.commands.executeCommandById(id), "sidebar-columns:" + suffix);
}
async function modalButtons(cdp) {
  return cdp.run(() => [...document.querySelectorAll(".modal button")].map(b => b.textContent.trim()));
}
async function clickButton(cdp, text) {
  await cdp.run(text => { const b = [...document.querySelectorAll(".modal button")].find(b => b.textContent.trim() === text);
    if (!b) throw Error("Modal button missing: " + text); b.click(); }, text); await delay(250);
}
async function check(name, fn) {
  try { const detail = await fn(); report.cases.push({ name, status: "passed", detail: detail ?? null }); console.log("PASS " + name); }
  catch (e) { report.cases.push({ name, status: "failed", error: e.stack }); console.error("FAIL " + name + ": " + e.message); }
}
async function closeRuntime(port, cdp) {
  cdp?.close();
  const v = await (await fetch("http://127.0.0.1:" + port + "/json/version")).json();
  const browser = new CDP(v.webSocketDebuggerUrl); await browser.ready;
  try { await browser.send("Browser.close"); } catch (e) { if (!e.message.includes("closed")) throw e; }
  browser.close(); await delay(1500);
}
async function acceptance(cdp) {
  const initial = await snapshot(cdp, "00-initial");
  const originals = nodes(initial.left).concat(nodes(initial.right)).filter(n => n.type).map(n => n.id);
  const groups = nodes(initial.left).concat(nodes(initial.right)).filter(n => n.children.length && !n.direction).map(n => n.id);
  await check("Central focus explains sidebar target without mutation", async () => {
    await focus(cdp,"fixture-a");await command(cdp,"split-right");await delay(150);
    const after=await cdp.run(runtimeSnapshot);assert.deepEqual(stripGeometry(after.left),stripGeometry(initial.left));assert.equal(after.acknowledged,false);
    let guidance="";for(let i=0;i<20;i++){guidance=await cdp.run(()=>document.querySelector(".notice")?.textContent??"");if(guidance)break;await delay(100);}if(!guidance){const d=await cdp.run(()=>{const p=app.plugins.plugins["sidebar-columns"];let error;try{p.adapter.resolveCommandTarget()}catch(e){error=e.message}const docs=[document,app.workspace.containerEl.ownerDocument];app.workspace.iterateAllLeaves(l=>docs.push(l.containerEl.ownerDocument));return {active:app.workspace.activeLeaf?.id,hasFocus:document.hasFocus(),activeDocumentUrl:typeof activeDocument==="undefined"?null:activeDocument.URL,activeDocumentSame:typeof activeDocument==="undefined"?null:activeDocument===document,activeWindowUrl:typeof activeWindow==="undefined"?null:activeWindow.location.href,alive:p.alive,checking:app.commands.commands["sidebar-columns:split-right"].checkCallback(true),targetError:error,documents:[...new Set(docs)].map(d=>({url:d.URL,notices:[...d.querySelectorAll(".notice")].map(e=>e.textContent),tail:d.body.innerText.slice(-500)}))}});json(join(EVIDENCE,"central-guidance-diagnostic.json"),d);}assert.ok(guidance,"Expected selection guidance notice");
  });
  await check("Consent Cancel preserves native sidebar structure", async () => {
    await focus(cdp, "fixture-explorer"); await command(cdp, "split-right"); await delay(150);
    const cancel = (await modalButtons(cdp)).find(t => /cancel/i.test(t)); assert.ok(cancel);
    await clickButton(cdp, cancel); const after = await snapshot(cdp, "01-consent-cancel");
    assert.equal(after.acknowledged, false); assert.deepEqual(stripGeometry(after.left), stripGeometry(initial.left));
  });
  await check("Consent Enable permits a native left column split", async () => {
    await focus(cdp, "fixture-explorer"); await command(cdp, "split-right"); await delay(150);
    const enable = (await modalButtons(cdp)).find(t => /enable|accept|understand/i.test(t) && !/cancel/i.test(t)); assert.ok(enable);
    await clickButton(cdp, enable); const after = await snapshot(cdp, "02-left-two");
    assert.equal(after.acknowledged, true); assert.equal(columns(after, "left"), 2);
  });
  await check("Left sidebar supports three and four visible columns", async () => {
    await focus(cdp, "fixture-explorer"); await command(cdp, "split-right"); await delay(250);
    assert.equal(columns(await snapshot(cdp, "03-left-three"), "left"), 3);
    await focus(cdp, "fixture-explorer"); await command(cdp, "split-right"); await delay(250);
    assert.equal(columns(await snapshot(cdp, "04-left-four"), "left"), 4);
  });
  await check("Right sidebar splits independently", async () => {
    await focus(cdp, "fixture-backlinks"); await command(cdp, "split-right"); await delay(250);
    const after = await snapshot(cdp, "05-right-two"); assert.equal(columns(after, "right"), 2); assert.equal(columns(after, "left"), 4);
  });
  await check("Original native leaves, groups and central editors survive splits", async () => {
    const after = await cdp.run(runtimeSnapshot), ns = nodes(after.left).concat(nodes(after.right));
    for (const id of originals) assert.ok(ns.some(n => n.id === id), "Original leaf lost: " + id);
    for (const id of groups) assert.ok(ns.some(n => n.id === id), "Original group lost: " + id);
    assert.deepEqual(stripGeometry(after.main), stripGeometry(initial.main));
    return { originalLeaves: originals.length, originalGroups: groups.length, centralPreserved: true };
  });
  await check("Collapse preserves native views; Expand all restores columns", async () => {
    await focus(cdp, "fixture-explorer"); await command(cdp, "collapse-column"); await delay(200);
    assert.equal((await snapshot(cdp, "06-collapsed")).collapsed, 1);
    await command(cdp, "expand-all-columns"); await delay(200);
    assert.equal((await snapshot(cdp, "07-expanded")).collapsed, 0);
  });
  await check("Sidebar close/reopen preserves split structure", async () => {
    const before = await cdp.run(runtimeSnapshot);
    await cdp.run(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); }); await delay(200);
    await cdp.run(() => { app.workspace.leftSplit.expand(); app.workspace.rightSplit.expand(); }); await delay(300);
    const after = await snapshot(cdp, "08-reopened");
    assert.equal(columns(after, "left"), columns(before, "left")); assert.equal(columns(after, "right"), columns(before, "right"));
  });
  for (const theme of ["Minimal", "Blue Topaz", "AnuPpuccin"]) if (report.assets.some(a => a.kind === "theme" && a.name === theme)) {
    await check(theme + " theme displays distinct sidebar columns", async () => {
      const themeProof=await cdp.run(async name=>{app.customCss.setTheme(name);await app.customCss.loadTheme();const text=app.customCss.styleEl.textContent;const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));return {name:app.customCss.theme,characters:text.length,sha256:[...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,"0")).join("")};},theme);assert.equal(themeProof.sha256,sha(join(VAULT,".obsidian","themes",theme,"theme.css")));await delay(200);
      const s = await snapshot(cdp, "09-theme-" + theme.replaceAll(" ", "-"));
      assert.equal(columns(s, "left"), 4); assert.equal(columns(s, "right"), 2); return {geometryOnly:true,themeStylesheetApplied:themeProof};
    });
  }
  await check("Default theme restores after community theme checks", async () => {
    await cdp.run(async()=>{app.customCss.setTheme("");await app.customCss.loadTheme();return app.customCss.styleEl.textContent.length;}); await delay(150); await snapshot(cdp, "10-default");
  });
  await check("125 and 150 percent scaling retain sidebar columns", async () => {
    try {
      for (const factor of [1.25, 1.5]) {
        await cdp.run(f => require("electron").webFrame.setZoomFactor(f), factor); await delay(300);
        const s = await snapshot(cdp, "11-scale-" + factor);
        assert.equal(columns(s, "left"), 4); assert.equal(columns(s, "right"), 2);
      }
    } finally { await cdp.run(() => require("electron").webFrame.setZoomFactor(1)); await delay(200); }
  });
  await inactiveMenus(cdp);
  await nativePointerChecks(cdp);
  await dragAndNarrow(cdp);
}

async function idle(cdp) {
  for(let i=0;i<100;i++) { if(!await cdp.run(()=>app.plugins.plugins["sidebar-columns"].operations.busy)){await delay(100);return;} await delay(50); }
  throw Error("Operation did not settle");
}
async function pointerClick(cdp,x,y,button="left") {
  await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button,clickCount:1});
  await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button,clickCount:1});
}
async function inactiveMenus(cdp) {
  const fileId=await cdp.run(async()=>{const l=app.workspace.getLeftLeaf(true);await l.setViewState({type:"markdown",state:{file:"Fixture B.md",mode:"source"},active:false});return l.id;});
  await cdp.run(id=>{window.__scRuntimeFileId=id;},fileId);
  for(const [label,id] of [["file-backed Markdown",fileId],["core Search panel","fixture-search-leaf"],["Calendar panel","fixture-calendar"]]) {
    await check("Inactive native header menu: "+label,async()=>{
      await focus(cdp,"fixture-a");
      const before=await cdp.run(id=>{let l;app.workspace.iterateAllLeaves(x=>{if(x.id===id)l=x;});if(!l)throw Error("Fixture panel unavailable");
        const r=l.tabHeaderEl.getBoundingClientRect();return {active:app.workspace.activeLeaf.id,type:l.view.getViewType(),parent:l.parent.parent.id,x:r.x+Math.min(12,r.width/2),y:r.y+r.height/2};},id);
      assert.equal(before.active,"fixture-a");if(label==="Calendar panel")assert.equal(before.type,"calendar");
      await pointerClick(cdp,before.x,before.y,"right");
      let items=[];
      for(let i=0;i<30;i++) {items=await cdp.run(()=>[...document.querySelectorAll(".menu-item-title")].map(e=>e.textContent.trim()));
        if(items.includes("Split this row right (experimental)"))break;await delay(100);}
      assert.equal(items.filter(t=>t==="Split this row right (experimental)").length,1,"Own action missing or duplicated");
      await cdp.run(()=>{const e=[...document.querySelectorAll(".menu-item-title")].find(e=>e.textContent.trim()==="Split this row right (experimental)");if(!e)throw Error("Menu action disappeared");e.closest(".menu-item").click();});
      await idle(cdp);await delay(150);
      const after=await cdp.run(id=>{let l;app.workspace.iterateAllLeaves(x=>{if(x.id===id)l=x;});return {parent:l.parent.parent.id,direction:l.parent.parent.direction,siblings:l.parent.parent.children.length};},id);
      assert.notEqual(after.parent,before.parent);assert.equal(after.direction,"vertical");assert.equal(after.siblings,2);
      await snapshot(cdp,"12-menu-"+label.replaceAll(" ","-"));return {before,after,menuItems:items};
    });
  }
}


async function nativePointerChecks(cdp) {
  await check("Collapse rail is 32px and native proportions remain unchanged",async()=>{
    await focus(cdp,"fixture-search-leaf");
    const before=await cdp.run(()=>{const walk=n=>({id:n.id,dimension:n.dimension??null,children:n.children?.map(walk)??[]});return walk(app.workspace.leftSplit);});
    await command(cdp,"collapse-column");await idle(cdp);
    const rail=await cdp.run(()=>{const e=document.querySelector(".sidebar-columns-collapsed");return e?{width:e.getBoundingClientRect().width,count:app.plugins.plugins["sidebar-columns"].adapter.getCollapsedCount()}:null;});
    assert.ok(rail);assert.ok(rail.width>=30&&rail.width<=34);
    const after=await cdp.run(()=>{const walk=n=>({id:n.id,dimension:n.dimension??null,children:n.children?.map(walk)??[]});return walk(app.workspace.leftSplit);});
    assert.deepEqual(after,before);await command(cdp,"expand-all-columns");return rail;
  });
  await check("Native pointer divider drag changes column width",async()=>{
    const before=await cdp.run(()=>{let l;app.workspace.iterateAllLeaves(x=>{if(x.id==="fixture-search-leaf")l=x;});const branch=l.parent.parent.children.find(b=>{const r=b.resizeHandleEl.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(b.resizeHandleEl).display!=="none"});if(!branch)throw Error("No visible native column handle");const h=branch.resizeHandleEl.getBoundingClientRect(),r=branch.containerEl.getBoundingClientRect();return {branchId:branch.id,x:h.x+h.width/2,y:h.y+h.height/2,width:r.width,handleWidth:h.width,handleHeight:h.height,display:getComputedStyle(branch.resizeHandleEl).display,hit:document.elementFromPoint(h.x+h.width/2,h.y+h.height/2)===branch.resizeHandleEl};});
    assert.ok(before.handleWidth>0&&before.handleHeight>0);assert.notEqual(before.display,"none");assert.equal(before.hit,true,"Pointer must hit the exact native group handle");
    await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:before.x,y:before.y,button:"left",clickCount:1});
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:before.x+45,y:before.y,button:"left",buttons:1});
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:before.x+45,y:before.y,button:"left",clickCount:1});await delay(250);
    const after=await cdp.run(id=>{let b;const walk=n=>{if(n.id===id)b=n;for(const c of n.children??[])walk(c)};walk(app.workspace.leftSplit);return b.containerEl.getBoundingClientRect().width;},before.branchId);
    assert.ok(Math.abs(after-before.width)>10,"Native drag did not change width");await snapshot(cdp,"13-pointer-resize");return {before,after};
  });
}


async function dragAndNarrow(cdp) {
  await check("Native tab drag moves a sidebar Markdown tab and clears collapse rails",async()=>{
    await focus(cdp,"fixture-search-leaf");await command(cdp,"collapse-column");await idle(cdp);
    const before=await cdp.run(()=>{let source,target;app.workspace.iterateAllLeaves(l=>{
      if(l.id===window.__scRuntimeFileId)source=l;
      if(!target&&l.view.getViewType()==="empty"&&l.getRoot()===app.workspace.leftSplit)target=l;});
      if(!source||!target)throw Error("Native drag fixture unavailable");
      const s=(source.tabHeaderEl.querySelector(".workspace-tab-header-inner-icon")??source.tabHeaderEl).getBoundingClientRect(),t=target.parent.containerEl.getBoundingClientRect();
      return {sourceId:source.id,parent:source.parent.id,x:s.x+s.width/2,y:s.y+s.height/2,
        tx:t.x+t.width/2,ty:t.y+20,collapsed:app.plugins.plugins["sidebar-columns"].adapter.getCollapsedCount()};});
    assert.equal(before.collapsed,1);
    let data;cdp.on("Input.dragIntercepted",event=>{data=event.data;});
    await cdp.send("Input.setInterceptDrags",{enabled:true});
    let dropped=false;
    try {
      await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:before.x,y:before.y,button:"left",clickCount:1});
      for(let i=1;i<=8&&!data;i++){await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:before.x+i*8,y:before.y+i*4,button:"left",buttons:1});await delay(30);}
      for(let i=0;i<10&&!data;i++)await delay(50);
      assert.ok(data,"Chrome did not intercept a real native tab drag");
      for(const type of ["dragEnter","dragOver","drop"])await cdp.send("Input.dispatchDragEvent",{type,x:before.tx,y:before.ty,data});
      dropped=true;await delay(300);
      const after=await cdp.run(id=>{let l;app.workspace.iterateAllLeaves(x=>{if(x.id===id)l=x;});return {parent:l?.parent.id,
        collapsed:app.plugins.plugins["sidebar-columns"].adapter.getCollapsedCount(),type:l?.view.getViewType()};},before.sourceId);
      assert.notEqual(after.parent,before.parent,"Native drop did not move the original tab");
      assert.equal(after.type,"markdown");assert.equal(after.collapsed,0);await snapshot(cdp,"14-native-tab-drop");return {before,after};
    } finally {
      if(data&&!dropped)await cdp.send("Input.dispatchDragEvent",{type:"dragCancel",x:before.x,y:before.y,data}).catch(()=>{});
      await cdp.send("Input.setInterceptDrags",{enabled:false});
      await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:before.tx,y:before.ty,button:"left",clickCount:1});
    }
  });
  await check("900px window retains a usable central editor",async()=>{
    await cdp.run(()=>window.electronWindow.setSize(900,700));await delay(250);
    const detail=await cdp.run(()=>{app.plugins.plugins["sidebar-columns"].adapter.assertCompatible();return {nativeBounds:window.electronWindow.getBounds(),
      innerWidth:innerWidth,rootId:app.workspace.rootSplit.id,rootType:app.workspace.rootSplit.type,rootClasses:app.workspace.rootSplit.containerEl.className,rootChildren:app.workspace.rootSplit.children.map(n=>n.id),leftWidth:app.workspace.leftSplit.containerEl.getBoundingClientRect().width,rightWidth:app.workspace.rightSplit.containerEl.getBoundingClientRect().width,centralWidth:app.workspace.rootSplit.containerEl.getBoundingClientRect().width};});
    json(join(EVIDENCE,"15-narrow-diagnostic.json"),detail);await snapshot(cdp,"15-narrow-window");await cdp.run(()=>app.workspace.rightSplit.collapse());await delay(150);const sidebarRecovery=await cdp.run(()=>app.workspace.rootSplit.containerEl.getBoundingClientRect().width);await cdp.run(()=>app.workspace.rightSplit.expand());await cdp.run(()=>window.electronWindow.setSize(1600,1000));await delay(150);const recovered=await cdp.run(()=>app.workspace.rootSplit.containerEl.getBoundingClientRect().width);json(join(EVIDENCE,"15-wide-recovery.json"),{centralWidth:recovered,closingWholeRightSidebarWidth:sidebarRecovery});assert.ok(sidebarRecovery>0);assert.ok(recovered>0,"Widening must restore the center");assert.ok(detail.centralWidth>0,"Observed native width limit: close a whole sidebar or widen the window to restore the center");return {...detail,recovered,structuralOnly:true};
  });
}

function resultsDocument() {
  const tick = String.fromCharCode(96);
  const lines = ["# Runtime test results", "", "Generated from an isolated fixture; the personal vault was not a test target.", "",
    "Run: " + tick + report.runId + tick + ".", "",
    "Renderer: " + VERSION + ". Installer: " + (report.installerVersion ?? "not verified") + ". Platform: Windows.", "",
    "Status: " + (shouldRun ? "Native runtime attempted." : "Staged only; native runtime not executed."), "",
    "| Scenario | Result |", "| --- | --- |", ...report.cases.map(c => "| " + c.name.replaceAll("|", "/") + " | " + c.status + " |"), "",
    "Full evidence: " + tick + ".runtime-tests/" + basename(RUN) + tick + ".", "",
    "Production configuration guard: " + (report.productionGuard?.unchanged ? "unchanged" : "changed or failed; inspect report.json") + ".", "",
    "## Acceptance limits", "", ...report.limitations.map(l => "- " + l), "",
    "See [MANUAL-TESTS.md](MANUAL-TESTS.md) for unexecuted scenarios.", ""];
  writeFileSync(join(PROJECT, "docs", "TEST-RESULTS.md"), lines.join("\n"), "utf8");
}
let cdp, port;
const before = productionSnapshot();
try {
  stage();
  if (shouldRun) {
    port = await freePort(); report.pid = launch(port); report.debuggingPort = port;
    cdp = await attach(port);
    const native=await cdp.run(()=>{const ipc=require("electron").ipcRenderer;return {resources:ipc.sendSync("resources"),version:ipc.sendSync("version"),vault:ipc.sendSync("vault"),vaults:ipc.sendSync("vault-list")}});
    assert.equal(canonical(native.resources),canonical(ASAR));assert.equal(native.version,VERSION);assert.equal(canonical(native.vault.path),canonical(VAULT));assert.deepEqual(Object.keys(native.vaults),[FIXTURE_ID]);json(join(EVIDENCE,"native-isolation.json"),native);
    await readiness(cdp); await assertIsolation(cdp);
    if(rtlRun){await cdp.run(()=>{localStorage.setItem("language","ar");require("electron").ipcRenderer.sendSync("set-language","ar");});await cdp.send("Page.reload");await delay(350);await readiness(cdp);await assertIsolation(cdp);}
    await cdp.send("Page.bringToFront");
    await cdp.run(()=>{window.electronWindow.setSize(1600,1000);window.electronWindow.focus();window.electronWindow.webContents.focus();});await delay(250);
    cdp.on("Runtime.exceptionThrown", p => report.consoleErrors.push(p.exceptionDetails));
    cdp.on("Runtime.consoleAPICalled", p => {
      if (p.type === "error") report.consoleErrors.push({ type: "console", text: p.args.map(a => a.value ?? a.description).join(" ") });
    });
    if(rtlRun)await check("Actual Arabic RTL workspace boots and flips",async()=>{const d=await cdp.run(()=>({className:document.body.className,direction:getComputedStyle(document.body).direction,flex:getComputedStyle(app.workspace.containerEl).flexDirection,leftX:app.workspace.leftSplit.containerEl.getBoundingClientRect().x,rightX:app.workspace.rightSplit.containerEl.getBoundingClientRect().x,arabicText:/[\u0600-\u06ff]/.test(document.body.innerText)}));json(join(EVIDENCE,"rtl-native.json"),d);assert.ok(d.arabicText);assert.ok(d.direction==="rtl"||d.className.includes("mod-rtl"));return d;});
    await acceptance(cdp);
  } else console.log("Staged fixture: " + RUN + " (not launched)");
} catch (e) {
  report.cases.push({ name: "Harness setup/isolation", status: "failed", error: e.stack }); console.error(e.stack);
} finally {
  if (port) try { await closeRuntime(port, cdp); }
  catch (e) { report.cases.push({ name: "Close isolated runtime", status: "failed", error: e.stack }); }
  const after = productionSnapshot(); report.productionGuard = { unchanged: JSON.stringify(before) === JSON.stringify(after), before, after };
  report.finishedAt = new Date().toISOString();
  if (!report.productionGuard.unchanged) report.cases.push({ name: "Production configuration content guard", status: "failed",
    detail: "Production JSON or protocol content changed; contents are not logged. Concurrent user changes cannot be attributed automatically." });
  mkdirSync(EVIDENCE, { recursive: true }); json(join(RUN, "report.json"), report); resultsDocument();
  console.log("Evidence: " + RUN);
  if (report.cases.some(c => c.status === "failed")) process.exitCode = 1;
}
