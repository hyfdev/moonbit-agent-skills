import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const build = spawnSync("moon", ["build"], { encoding: "utf8" });
if (build.status !== 0) {
  process.stderr.write(build.stdout + build.stderr);
  process.exit(build.status ?? 1);
}

const artifact = "_build/wasm-gc/debug/build/cmd/main/main.wasm";
if (!existsSync(artifact)) {
  throw new Error(`missing default artifact: ${artifact}`);
}
console.log("default artifact ok");
