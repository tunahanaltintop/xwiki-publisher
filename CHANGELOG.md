# Changelog

## 1.9.0

- **Inline comments**: comments made on a text selection of an XWiki page are shown in the pulled note. The commented text is highlighted (`==💬text==`) and followed by a footnote with the comment, its replies, their authors and dates; comments whose text is no longer in the note are listed after it. The marks are removed when the note is published, so the page content and the comments on XWiki stay as they are, and they do not count as an edit of the note. Notes synced before get their comments at the next pull. New setting *Inline comments* to turn this off.
- **Commenting from Obsidian**: *Comment on XWiki* in the editor menu adds an inline comment on the selected text of a note to its page, and *Reply to XWiki comment* answers the comment at the cursor. Both are sent right away under your XWiki account and then shown in the note; a comment of your own does not make the page count as changed on XWiki.
- **Mentions**: mentions of XWiki users (`{{mention …/}}`) are shown in the note as links to the profile of the user, with the user's name (`[@Jane Doe](…)`), also in notes pulled before, and are published as exactly the macros they were. Typing `@` and a name in a note that has an XWiki page lists the matching users (new setting *Suggest users to mention*; the command *Mention an XWiki user* does the same from a search box). A mention written in Obsidian is published as an XWiki mention, and XWiki notifies the user once; the anchor it got is written into the note's link, so a comparison shows no difference and adding another mention before it does not notify anyone again.
- **Differences**: right-click a note in the *Source control* tab (*Changes* or *Incoming from XWiki*) and choose **Show differences** to see the note and its XWiki page side by side, the older version on the left, with removed and added lines and the changed words marked. Spacing is ignored, blank lines included, so a table that Obsidian realigned after one cell was edited shows only that cell as changed (**Show spacing changes** shows the rest).
- **Changes by block**: in the comparison of a note, each block of changes has its own buttons: **Publish** and **Revert** for a change made in the vault, **Pull** and **Revert** for a change made on XWiki. Only that block is published or taken; the rest of the note and of the page stays as it is.
- **Comment references hidden**: the footnote reference after a commented text (`xwiki-0` in tables) is no longer shown; the 💬 icon stands for it. The file keeps it.
- **Comment icon**: selecting the 💬 icon of an inline comment shows the comment and its replies in a popover, also in tables, with **Reply** and **Delete** buttons. Delete removes the comment and its replies on XWiki after a confirmation.
- **Resolve and reopen**: on a wiki with comment resolution (`Tools.CommentResolve`), the comment popover has **Resolve**, and **Reopen** on a resolved comment. Resolved comments stay in the note with the ✅ icon and a faded highlight, their footnote saying who resolved them and when; resolving or reopening on XWiki shows when the note is next opened. **Resolved XWiki comments** lists them, to reopen one. Notes pulled by an earlier version read their comments again once.
- **Actions on every reply**: the comment popover shows the comment and its replies as XWiki has them now, each with its own **Reply** and **Delete**; deleting a reply also deletes the replies below it.
- The comparison closes once its last block of changes is taken.
- **Mentions in comments**: typing `@` in the comment and reply boxes lists the XWiki users; the chosen one is sent as an XWiki mention. Mentions in pulled comments show as links with the users' names.
- **Revert changes**: right-click a note under *Changes*, or use the button in its comparison, to undo its change after a confirmation: a modified note gets its XWiki page back, a deleted note is created again from its page, and a note never published is moved to the trash.
- **Spacing is not an edit**: Obsidian realigning a table or adding a blank line no longer lists a note as modified. A note listed so by an earlier version is in sync again when it is next opened or compared, once the plugin finds that it shows its page.
- **Comments and mentions on opening**: opening a note that has an XWiki page reads the page in the background (at most every two minutes per note) and shows its current inline comments, and its mention macros as links, without a pull and without changing the text of the note. When the page text changed on XWiki, a notice says so. New setting *Update comments and mentions when a note is opened*.
- **Source control both ways**: the *Source control* tab has a second list, **Incoming from XWiki**. **Check XWiki** compares every note that was published or pulled with its page, and lists the notes whose page is newer (**U**), changed on both sides (**C**) or no longer on XWiki (**R**), in the same folder tree. Select them one by one, by folder or all at once, and **Pull** brings them into the vault; for notes changed on both sides you choose once between keeping both and overwriting.
- **Conflicts**: pulling a note you edited no longer reports a conflict when the content of the page is what it was at the last sync, for example after someone commented on it or replaced an attachment. Your text is kept, and the comments and attachments are updated.

## 1.8.0

- **Highlight colours**: Obsidian's coloured highlights (`==🟢text==`) are published in their colour, without the emoji, and come back unchanged on pull. Before, XWiki showed the default highlight with the emoji in the text.
- **Links to formatted headings**: links and section embeds pointing at a formatted heading (`## **Scope**`) come back on pull as `[[Note#Scope]]`. Before, they came back with the Markdown marks and an extra alias (`[[Note#**Scope**|Note > Scope]]`).

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
