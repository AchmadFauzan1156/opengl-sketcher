// Loads the browser classic scripts into this Node process (they attach to globalThis).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const loaded = new Set();
export function load(...files) {
  for (const file of files) {
    if (loaded.has(file)) continue;
    const path = fileURLToPath(new URL(`../web/${file}`, import.meta.url));
    vm.runInThisContext(readFileSync(path, "utf8"), { filename: path });
    loaded.add(file);
  }
  return globalThis;
}
