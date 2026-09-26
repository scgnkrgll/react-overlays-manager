// Runs from the npm `version` lifecycle hook so `npm version x.y.z` bumps jsr.json too.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const jsr = JSON.parse(readFileSync("jsr.json", "utf8"));
jsr.version = version;
writeFileSync("jsr.json", JSON.stringify(jsr, null, 2) + "\n");
