# Changelog

## 1.7.0

- **Obsidian syntax on XWiki**: callouts become message boxes (`{{info}}`, `{{success}}`, `{{warning}}`, `{{error}}`) with their title, highlights become `<mark>`, task lists get ☐/☑/☒, footnotes become `{{footnote}}` macros, block ids become `{{id}}` anchors, embedded notes and sections are shown with `{{display}}`, and sized images (`![[a.png|300]]`) keep their size. Characters that XWiki Markdown would read as subscript, superscript, definitions or abbreviations are escaped. Pulling turns all of them back into the Obsidian syntax.
- **Links as XWiki references**: page links and attachments are written as XWiki references (`[[label|doc:Space.Note.WebHome]]`, `![[alt|a.png]]`) instead of URLs, so XWiki tracks them and updates them on renames. Links to headings and blocks (`[[Note#Heading]]`, `[[#Heading]]`, `[[Note#^block]]`) now point at the heading or block, with the anchor XWiki generates, and come back unchanged on pull; before, the heading was dropped and the pulled link got a `Note > Heading` alias.
- **Line breaks**: single line breaks are published as line breaks when Obsidian shows them so (setting *Line breaks*); XWiki Markdown joined such lines into one.
- **Comments**: new setting *Obsidian comments* to keep `%%comments%%` as hidden `{{comment}}` macros, so they survive a pull after an edit on XWiki.
- Pages in XWiki syntax: underline, superscript and subscript are pulled as `<u>`, `<sup>` and `<sub>` instead of being dropped or written in a syntax Obsidian does not show.

## 1.6.0

- **Resuming large syncs**: a space sync saves its progress every few seconds, including each downloaded attachment, so when it is interrupted (Obsidian closed, crashed or ran out of memory) syncing the space again skips the pages and files already pulled. Notes written by an interrupted sync before its progress was saved take over the attachment files already in the vault, instead of downloading them again as copies or becoming conflicts. Attachments that could not be downloaded are tried again on the next pull or sync, even when the page did not change. The sync result lists the pages that failed, with the reason. A folder publish saves its progress the same way.

## 1.5.0

- **Deleted notes**: the *Source control* tab lists notes deleted from the vault with a red **D**. Selecting one and publishing deletes its XWiki page, after a confirmation that names the page, and removes the OpenProject links of the page. Pages changed on XWiki or not written in Markdown are kept unless you choose to overwrite them, and a page another note still belongs to is never offered. The **×** on the row keeps the page and removes the note from the list. Needs *delete* right on the page.
- **OpenProject links**: with an OpenProject URL and API token in the settings, publishing a note (one note, a folder or the *Source control* selection) links its XWiki page to the work packages the note links to, in their **Wikis** tab. A work package that already has the link is left alone, and when a link leaves the note its work package loses the page. Each note's result is shown in **Recent activity**, which now keeps the last 100 entries. The panel's *Connection* section and the settings can test the connection. Needs OpenProject 17.6 or later with its XWiki integration; see `docs/OPENPROJECT_SETUP.md`.

## 1.4.1

- In the *Source control* tab, folders with a folder note are marked with a dotted underline drawn as a border, which every supported Obsidian version renders the same way.

## 1.4.0

- The side panel has two tabs. **XWiki** holds the existing actions; **Source control** lists every note added (green **A**) or modified (orange **M**) since its last publish or pull, as a flat list or, with the *Folder view* button, as a tree below their folders, where a folder note is shown as its folder, like in the file explorer. Selecting a row opens the note. Notes are selected with checkboxes, one by one, by folder in the folder view, or all at once with *Select all*, and **Publish** publishes the selection with the same rules as a folder publish. The recent activity list is shown on both tabs.

## 1.3.0

- Publish a whole folder: the **Publish folder to XWiki** command, the folder menu item and the panel's *Publish folder* section publish every note in a folder and its subfolders, folder notes first. Notes in sync with their page are skipped; pages changed on XWiki or not written in Markdown are skipped unless you choose to overwrite them. The publish shows its progress and can be cancelled; notes that fail are listed with the error XWiki returned.

## 1.2.1

- Folders with a folder note are marked with a dotted underline drawn as a border, which every supported Obsidian version renders the same way.

## 1.2.0

- Built-in folder notes: selecting a folder in the file explorer opens its folder note, folder notes are hidden from the explorer and follow their folder when it is renamed or moved, and folders get "Create folder note" / "Open folder note" menu items. The Folder notes plugin is no longer needed; its layouts stay supported.

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
