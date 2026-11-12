import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["main.js", "node_modules/**", "tests/**", "*.mjs"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
		rules: {
			// Product and format names keep their official casing in UI text.
			"obsidianmd/ui/sentence-case": [
				"warn",
				{ brands: ["XWiki", "Obsidian", "Markdown", "WebHome", "Folder notes"], acronyms: ["URL", "HTTPS", "HTTP", "PDF"], ignoreRegex: ["^https?://"] },
			],
		},
	},
]);
