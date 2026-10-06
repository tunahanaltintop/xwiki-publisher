# Changelog

## 1.1.0

- Requires Obsidian 1.13.0 or later. The settings tab and confirmation buttons use only the current Obsidian APIs; the classic settings tab for older Obsidian versions was removed.

## 1.0.1

- Settings appear in Obsidian's settings search (Obsidian 1.13 and later), using the declarative settings API; earlier Obsidian versions keep the classic settings tab.
- The plugin no longer lists all files of the vault: notes are matched to XWiki pages through the notes it published or pulled.
- Destructive confirmation buttons use the current Obsidian button style on Obsidian 1.13 and later.

## 1.0.0

First public release.

- Publish the current note to XWiki in the Markdown Syntax 1.2 format, with images and attachments.
- Pull a note from its XWiki page, import any page by URL or reference, and sync a whole space with all pages below it.
- Convert pages that are not written in Markdown (for example `xwiki/2.1`) to Markdown when pulling, from their rendered view; with the "Keep XWiki macros" option, from their source with macros kept so they keep working after publishing.
- Resolve XWiki Markdown 1.2 wiki-style links and images (`[[label|Space.Page]]`, `![[alt|file.png]]`) to notes, attachments or XWiki URLs.
- Save pulled attachments in an `assets` folder next to each note, move them along with the note, and keep their XWiki names when publishing.
- Fill empty table cells on publish so XWiki keeps the table columns.
- Mirror vault folders as nested XWiki pages, and recreate the XWiki page tree in the vault, with notes and folders named after page titles.
- Folder notes support, compatible with the Folder notes plugin: pages with children become folder notes (inside or next to their folder, with a configurable name), and folder notes publish as their folder's page.
- Conflict protection for publish and pull, based on the page version and a fingerprint of the note.
- Side panel with every action, the target page, the sync state and recent activity; space sync shows progress and can be cancelled.
- Token kept in Obsidian's secret storage; bearer, basic and custom header authentication.
