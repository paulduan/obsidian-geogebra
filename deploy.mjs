import { copyFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const VAULT_PLUGIN_DIR = join(
  process.env.HOME,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/mathematics/.obsidian/plugins/obsidian-geogebra"
);

if (!existsSync(VAULT_PLUGIN_DIR)) {
  mkdirSync(VAULT_PLUGIN_DIR, { recursive: true });
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));

const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  copyFileSync(file, join(VAULT_PLUGIN_DIR, file));
  console.log(`Deployed ${file} -> ${VAULT_PLUGIN_DIR}/${file}`);
}

console.log(`\nDeploy complete! v${manifest.version} — Reload Obsidian to see changes.`);
