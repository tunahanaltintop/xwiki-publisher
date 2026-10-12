// Creates or refreshes a test vault for trying local builds: copies the sample notes from dev/sample-vault, enables
// the plugin and seeds its settings. The vault is the one OBSIDIAN_PLUGIN_DIR (from .env) points into.
// Existing notes are kept; `--reset` overwrites the sample notes with the template.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import process from "process";
import { fileURLToPath } from "url";

const PLUGIN_ID = "xwiki-publisher";
const template = resolve(dirname(fileURLToPath(import.meta.url)), "../dev/sample-vault");
const reset = process.argv.includes("--reset");

const pluginDir = process.env.OBSIDIAN_PLUGIN_DIR;
const suffix = join(".obsidian", "plugins", PLUGIN_ID);
if (!pluginDir || !resolve(pluginDir).endsWith(suffix)) {
	console.error(`Set OBSIDIAN_PLUGIN_DIR in .env to <vault>/${suffix} (see .env.example).`);
	process.exit(1);
}
const vault = resolve(pluginDir).slice(0, -suffix.length - 1);

function templateFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? templateFiles(path) : [path];
	});
}

let copied = 0;
let kept = 0;
for (const source of templateFiles(template)) {
	const target = join(vault, relative(template, source));
	if (existsSync(target) && !reset) {
		kept++;
		continue;
	}
	mkdirSync(dirname(target), { recursive: true });
	cpSync(source, target);
	copied++;
}

mkdirSync(pluginDir, { recursive: true });

// Enable the plugin; Obsidian still asks once to turn off restricted mode for community plugins.
const pluginsList = join(vault, ".obsidian", "community-plugins.json");
const enabled = existsSync(pluginsList) ? JSON.parse(readFileSync(pluginsList, "utf8")) : [];
if (!enabled.includes(PLUGIN_ID)) writeFileSync(pluginsList, JSON.stringify([...enabled, PLUGIN_ID], null, 2));

// Seed settings once: test pages go to their own space. The URL and token are set in Obsidian.
const data = join(pluginDir, "data.json");
if (!existsSync(data)) writeFileSync(data, JSON.stringify({ defaultSpace: "ObsidianTest" }, null, 2));

// Marker for the Hot Reload plugin, which reloads the plugin whenever a new build is copied in.
writeFileSync(join(pluginDir, ".hotreload"), "");

for (const file of ["main.js", "manifest.json", "styles.css"]) {
	if (existsSync(file)) cpSync(file, join(pluginDir, file));
}

console.log(`Test vault ready: ${vault}`);
console.log(`  ${copied} sample file(s) copied, ${kept} kept${kept > 0 && !reset ? " (run with --reset to overwrite them)" : ""}.`);
