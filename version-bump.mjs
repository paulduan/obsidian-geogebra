import { readFileSync, writeFileSync } from "fs";

const manifestPath = "manifest.json";
const packagePath = "package.json";

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

const oldVersion = manifest.version;
const parts = oldVersion.split(".").map(Number);
parts[2] += 1; // bump patch
const newVersion = parts.join(".");

manifest.version = newVersion;
pkg.version = newVersion;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Version: ${oldVersion} → ${newVersion}`);
