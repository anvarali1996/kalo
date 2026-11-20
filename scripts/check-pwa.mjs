import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
for (const [name,size] of [["kalo-balance-192.png",192],["kalo-balance-mark.png",512],["kalo-balance-maskable-512.png",512],["kalo-balance-apple-touch.png",180]]) {
  const p=join(root,"public/icons",name); assert(existsSync(p),name);
  const b=readFileSync(p);assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);
}
assert(read("app/manifest.ts").includes("standalone"));
assert(read("public/sw.js").includes('request.mode !== "navigate"'));
assert(read("public/sw.js").includes('url.pathname.startsWith("/api/")'));
assert(!read("public/sw.js").includes("cache.put("));
console.log("KALO PWA static checks passed");
