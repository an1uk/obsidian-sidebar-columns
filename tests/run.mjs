import {build} from "esbuild";
import {mkdir,readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
await mkdir(".cache/tests",{recursive:true});
const tests=(await readdir("tests")).filter(name=>name.endsWith(".test.ts"));
if(!tests.length) throw new Error("No tests found");
for(const name of tests){
  await build({entryPoints:[path.join("tests",name)],outfile:path.join(".cache/tests",name.slice(0, -3) + ".mjs"),bundle:true,platform:"node",format:"esm",target:"node24",packages:"external",alias:{obsidian:path.resolve("tests/obsidian-stub.ts")}});
}
const result=spawnSync(process.execPath,["--test",...tests.map(name=>path.join(".cache/tests",name.slice(0, -3) + ".mjs"))],{stdio:"inherit"});
process.exitCode=result.status??1;
