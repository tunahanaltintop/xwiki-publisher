import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
import { copyFileSync, existsSync } from "fs";
import { join } from "path";

// Optional: set OBSIDIAN_PLUGIN_DIR to a vault's .obsidian/plugins/<id> folder to copy each build there.
const pluginDir = process.env.OBSIDIAN_PLUGIN_DIR;
const copyToVault = {
	name: "copy-to-vault",
	setup(build) {
		build.onEnd((result) => {
			if (!pluginDir || result.errors.length > 0) return;
			for (const file of ["main.js", "manifest.json", "styles.css"]) {
				if (existsSync(file)) copyFileSync(file, join(pluginDir, file));
			}
			console.log(`Copied build to ${pluginDir}`);
		});
	},
};

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
	plugins: [copyToVault],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
