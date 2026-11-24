# XWiki Publisher

Publish notes from your vault to [XWiki](https://www.xwiki.org) and pull XWiki pages back into your vault as
Markdown. Pages are stored in XWiki with the
[Markdown Syntax 1.2](https://extensions.xwiki.org/xwiki/bin/view/Extension/Markdown%20Syntax%201.2/) extension, so
they keep their Markdown source and can travel both ways.

> XWiki Publisher is a community plugin. It is not affiliated with or endorsed by XWiki SAS. XWiki is a trademark of
> XWiki SAS.

## Features

- **Publish** the current note to an XWiki page (created or updated), with its images and attachments.
- **Pull** a note back from its XWiki page, **import** any page by URL, or **sync** a whole space and everything
  below it.
- Pages that are not written in Markdown (for example `xwiki/2.1`) are **converted to Markdown** when pulled;
  optionally their **XWiki macros are kept** so they keep working after publishing.
- **Inline comments** made on XWiki are shown in the pulled note, on the text they were made on, and stay out of
  what is published. You can comment on a text and reply to a comment from Obsidian too.
- **Mentions** of XWiki users are shown in the note as links with the name of the user, published as the mentions
  they were, and written in Obsidian by typing `@`.
- The vault folder structure is **mirrored** as nested XWiki pages, and pulled pages recreate the XWiki page tree in
  the vault.
- **Conflict protection** in both directions: nothing is overwritten silently when a note and its page both changed.
- **Built-in folder notes**: XWiki pages that have children become folder notes, and selecting a folder in the file
  explorer shows the parent page's content. No other plugin is needed.
- A **side panel** with every action, the note's target page, its sync state and recent activity.
- A **Source control** tab that works both ways: it lists every note added, modified or deleted since its last sync,
  as a list or a folder tree, and **publishes the selected changes** in one go, including deleting the pages of
  deleted notes; and it **checks every note against XWiki**, lists the ones whose page is newer, and **pulls the
  selected ones**.
- **OpenProject links** (optional): published pages are linked to the work packages their notes link to, without
  duplicates, and the link is removed when it leaves the note.
- Access tokens are kept in Obsidian's **secret storage**, never in the plugin's data file.

## Requirements

- Obsidian **1.13.0** or later (desktop and mobile).
- An XWiki instance reachable over **HTTPS** with:
  - the **Markdown Syntax 1.2** extension installed (syntax id `markdown/1.2`);
  - an authenticator that accepts an **access token** (for example a bearer token issued by the OpenID Connect
    Provider extension) on both REST (`/rest/…`) and page (`/bin/…`) URLs;
  - an XWiki **account** with *view* right on the spaces you pull and *edit* right on the spaces you publish to, and
    *delete* right where you want deleted notes to delete their pages.

The XWiki administrator checklist, with commands to verify each point, is in
[docs/XWIKI_SETUP.md](docs/XWIKI_SETUP.md) (Turkish).

[OpenProject links](#openproject-links) are optional and have their own requirements, listed in
[docs/OPENPROJECT_SETUP.md](docs/OPENPROJECT_SETUP.md) (Turkish): OpenProject 17.6 or later with its XWiki integration.

## Setup

1. Install the plugin and enable it in **Settings → Community plugins**.
2. Open **Settings → XWiki Publisher**:
   - **XWiki URL**: the base URL of your instance, for example `https://wiki.example.com` or
     `https://wiki.example.com/xwiki` when XWiki runs under `/xwiki`.
   - **Wiki**: the wiki identifier; keep `xwiki` for the main wiki.
   - **Token**: create or select a secret holding your XWiki access token. Pasting the token with a `Bearer ` prefix
     is fine.
   - **Authentication method**: how the token is sent:
     - **Bearer token**: `Authorization: Bearer <token>` (default);
     - **Basic (username + token)**: the token is used as the password;
     - **Custom header**: the raw token is sent in a header you name.
3. Select **Test connection**. It shows the XWiki user the token authenticates as, and the Markdown syntaxes the
   server supports.
4. Optionally, set up [OpenProject links](#openproject-links).

## Usage

Open the side panel with the **Open XWiki panel** ribbon icon or the **XWiki Publisher: Open panel** command. It has
two tabs:

- **XWiki** shows, for the current note, the XWiki page it maps to, whether it is in sync, and buttons for every
  action.
- **Source control** lists the notes with local changes and publishes a selection of them; see
  [Source control](#source-control).

| Action | Where | What it does |
| --- | --- | --- |
| Publish current note | Panel, command palette, file menu | Creates or updates the note's XWiki page and uploads its attachments. |
| Publish folder to XWiki | Panel, command palette, folder menu | Publishes every note in a folder and its subfolders, folder notes first. |
| Publish selected changes | Panel, *Source control* tab | Publishes the notes checked in the list of local changes, and deletes the pages of checked deleted notes. |
| Pull current note from XWiki | Panel, command palette, file menu | Updates the note from its XWiki page. |
| Check XWiki | Panel | Tells whether the page changed on XWiki since the last sync. |
| Import page from XWiki | Panel, command palette | Imports one page given by URL or reference (`Space.Page`). |
| Sync space from XWiki | Panel, command palette | Pulls a page and every page below it, given by URL or space reference. |
| Open published page in browser | Panel, command palette | Opens the page saved in the note's `xwiki-url` property. |

Only one XWiki operation runs at a time. A running space sync or folder publish (or a publish of selected changes)
shows its progress in the panel and can be cancelled.

### Source control

The **Source control** tab of the panel lists, under **Changes**, every note of the vault that publishing would
change on XWiki. The letter at the right of each row tells why:

| Letter | Meaning |
| --- | --- |
| **A** (green) | Added: the note was never published or pulled. |
| **M** (orange) | Modified: the note's body changed since its last publish or pull. |
| **D** (red) | Deleted: the note left the vault, and its page is still on XWiki. |

Editing only a note's properties is not a change, the same rule as for [conflicts](#conflicts). Conflict copies
(`<Note> (XWiki conflict).md`) are not listed. The list updates as notes are created, edited, renamed, deleted,
published or pulled; the **Refresh** button scans the vault again.

- **Folder view** (the folder tree button at the top) switches between a flat list, where each note shows its folder
  next to its name, and a tree of the notes below their folders. The choice is kept when Obsidian restarts.
- In the folder view, a [folder note](#folder-notes) is shown as its folder, like in the file explorer: a changed folder
  note puts its letter on the folder's row instead of a row of its own, selecting a folder that has a folder note
  opens the note (its name is underlined), and the arrow expands and collapses the folder. Folders without a folder
  note, and **Changes**, expand and collapse when selected.
- Select a row to open its note; with Ctrl/Cmd it opens in a new tab.
- The **checkbox** at the left of a row selects the note for publishing. In the folder view, a folder's checkbox
  selects or clears every changed note below it, and shows a partial mark when only some are selected.
- **Select all** at the top selects or clears every listed change.
- **Publish** publishes the selected notes, with the same rules as a [folder publish](#conflicts): you choose between
  *Publish* and *Publish and overwrite*, notes are published from the outermost page inwards (folder notes first), notes
  in sync with their page are skipped, and pages changed on XWiki or not written in Markdown are skipped unless you
  choose to overwrite them. The result lists every skipped or failed note. Published notes leave the list. For notes
  marked **D**, see [Deleted notes](#deleted-notes).

Below it, **Incoming from XWiki** lists the notes that pulling would change: their page on XWiki is newer than the
note. **Check XWiki** compares every note that was published or pulled with its page (it reads each page, four at a
time, and can be cancelled from the panel); nothing is changed in the vault or on XWiki. The letter at the right of
each row tells what was found, and its tooltip gives the versions:

| Letter | Meaning |
| --- | --- |
| **U** (blue) | Updated on XWiki: the page has a newer version. Also when only comments or attachments are new (the text of the note stays), and for notes pulled before mentions were shown as links. |
| **C** (red) | Changed on both sides: the page changed, and the note was edited since its last sync. |
| **R** (grey) | Removed: the page is no longer on XWiki, or you cannot see it. It cannot be selected. |

- The list shows the result of the last check; check again to update it. Notes that are pulled or published leave
  it, and it follows notes that are renamed or deleted.
- It has the same **folder view**, **checkboxes** (per note, and per folder for every note below it) and **Select all**
  as *Changes*.
- **Pull** pulls the selected notes, outermost pages first. When notes marked **C** are selected, you choose once for
  all of them: *Keep both* writes the XWiki version next to each note as `<Note> (XWiki conflict).md`, *Overwrite
  local notes* replaces them. A note whose page only got new comments or attachments keeps its text either way. The
  result lists the notes kept as conflicts and the ones that failed.
- Only notes already in the vault are checked: pages created on XWiki since are brought in by **Sync space**.

**Show differences** (right-click a note in either list, or a folder that carries its folder note's letter) opens the
note and its XWiki page side by side, the older version on the left: for *Changes*, the page on the left and the
note on the right; for *Incoming from XWiki*, the note on the left and the page on the right. The page is shown as a
pull would write it into the note (with its mentions and comments), so only real differences are marked: removed
lines in red on the left, added lines in green on the right, and within a changed line the words that differ.
Spacing does not count: Obsidian pads and aligns every cell of a table when one cell of it is edited, which would
otherwise mark the whole table as changed; blank lines at the start of the note, or on one side only, do not count
either. **Show spacing changes** marks spacing too. Unchanged parts are folded to
a few lines around each change; select a fold, or **Show whole note**, to see them.
Comparing only reads the page: nothing is pulled or published, until you use the buttons of a block.

Each block of changes has its own bar, with what can be done with that block alone; the rest of the note and of the
page stays as it is:

| List | Buttons of a block |
| --- | --- |
| *Changes* | **Publish** sends this change to XWiki. **Revert** undoes it in the note, which gets the lines of the page back (what a pull would do). |
| *Incoming from XWiki* | **Pull** takes this change into the note, with the attachments it links to. **Revert** undoes it on XWiki: the page gets the lines of the note back, published under your account. |

Reverts ask first. Once the last block is taken, the comparison closes. A block is only taken when the note and the page are still what was compared; otherwise the
comparison is done again and nothing is changed. The note counts as in sync with the page once nothing differs, or
when the page was what the note was last synced with; until then, publishing or pulling the whole note still
protects the other changes as usual. A block of a page that is not written in Markdown cannot be published alone.

**Revert changes** (right-click a note under *Changes*, or the button in its comparison) undoes the change of the
note, after a confirmation: a modified note (**M**) gets its page as it is on XWiki, losing the edits made since the
last publish or pull; a deleted note (**D**) is created again at its path from its page; a note never published
(**A**), which XWiki has no copy of, is moved to the trash, where Obsidian keeps it according to its *Deleted files*
setting.
- **Recent activity** below the lists shows the results of the latest operations, the same list as on the *XWiki* tab.

### Where a note is published

The target page is chosen in this order:

1. `xwiki-reference` property: the full page reference, for example `Docs.Team.Guide.WebHome`. Pulled notes get it
   automatically, so they always go back to the page they came from.
2. `xwiki-space` and `xwiki-page` properties.
3. The note's folders, below the **Default space** setting, when **Mirror folder structure** is on:
   `Projects/Alpha/Note.md` becomes `<Default space>.Projects.Alpha.Note`. A note created inside a folder that was
   pulled from XWiki goes below that folder's page instead.
4. The **Default space** alone.

With **Use nested pages** (default) a note becomes a nested page (`Space.Note.WebHome`); otherwise a terminal page
(`Space.Note`). With **Create folder pages** (default) an empty page is created for each mirrored folder that has
no page yet, so the XWiki page tree shows the same hierarchy. Existing pages are never modified by this.

The page title is the note name, or the `xwiki-title` property when set.

### What is converted when publishing

| In the note | On XWiki |
| --- | --- |
| Frontmatter | Removed |
| `%%comments%%` | Removed, or kept as hidden `{{comment}}` macros (setting **Obsidian comments**) |
| `![[image.png]]`, `![](image.png)` | Image of the uploaded attachment: `![[alt\|image.png]]` |
| `![[image.png\|300]]`, `\|300x200` | Sized image: `{{content syntax="xwiki/2.1"}}[[image:image.png\|\|width="300"]]{{/content}}` |
| `![[file.pdf]]`, `[label](file.pdf)` | Link to the uploaded attachment: `[[label\|attach:file.pdf]]` |
| `[[Note]]`, `[[Note\|alias]]` | Link to the page the note is (or will be) published to: `[[alias\|doc:Space.Note.WebHome]]` |
| `[[Note#Heading]]`, `[[Note#^block]]` | The same link with `anchor="HHeading"` / `anchor="block"` |
| `[[#Heading]]` | Link to the heading on the same page (`#HHeading`) |
| `![[Note]]`, `![[Note#Heading]]` | `{{display reference="Space.Note.WebHome" section="HHeading"/}}`: the page or section is shown in place |
| `> [!tip] Title` callouts | Message boxes: `{{info}}`, `{{success}}`, `{{warning}}` or `{{error}}` with the title; the box content stays Markdown |
| `==highlight==` | `<mark>highlight</mark>` |
| `==🟢highlight==` (Obsidian's highlight colours: 🔴🟠🟡🟢🔵🟣, or the squares 🟥🟧🟨🟩🟦🟪) | `<mark class="obsidian-highlight-green" style="background-color: …">highlight</mark>`: the colour is shown on XWiki without the emoji |
| `- [ ]`, `- [x]`, `- [X]` | `- ☐`, `- ☑`, `- ☒` |
| `[^1]` footnotes, `^[inline footnotes]` | `{{footnote}}…{{/footnote}}`, listed at the end of the page |
| `text ^block-id` | `text {{id name="block-id"/}}`, an anchor links can target |
| `[@Jane Doe](https://wiki…/bin/view/XWiki/jdoe)`, a link to the profile of a user whose text starts with `@` | A mention of the user: `{{mention reference="XWiki.jdoe" style="FULL_NAME" anchor="…"/}}`; see [Mentions](#mentions) |
| Single line breaks | Kept as line breaks when Obsidian shows them so (setting **Line breaks**) |
| `~`, `^`, a line starting with `:` or `*[` | Escaped: Markdown 1.2 would read them as subscript, superscript, definition or abbreviation |
| XWiki macros (`{{toc/}}`, `{{info}}…{{/info}}`) | Unchanged: Markdown 1.2 runs them like XWiki syntax does |
| Empty table cells | Filled with a non-breaking space (`&nbsp;`), so XWiki keeps the columns |
| Unresolved `[[links]]` | Plain text |
| Code blocks and inline code | Unchanged |

Links and images are written as XWiki references rather than URLs: XWiki lists them as links of the page, updates
them when a page is renamed or moved, and they do not depend on the address of the wiki. Heading anchors are computed
the way XWiki generates them (`H` followed by the heading text without spaces, other characters written in hex:
`Giriş` → `HGiri15F`).

Pulling turns each of these back into the Obsidian syntax it came from, so a page that is not edited on XWiki gives
back its note. Exceptions: footnotes come back numbered with their definitions at the end, a Markdown link to a note
comes back as a wiki link, and an embed's alias is not kept.

Publishing over a page that is not written in Markdown asks for confirmation first, because the page's syntax
changes to Markdown and its macros are lost.

### Pulling and syncing

- Pages written in Markdown are taken as they are.
- Other pages (for example `xwiki/2.1`) are rendered by XWiki, application sheets and macros included, and the result
  is converted to Markdown: macros appear as their output, for example as links. This is the default.
- With **Keep XWiki macros** on, pages in XWiki syntax (`xwiki/2.x`) are converted from their **source** instead:
  headings, formatting, lists, tables, links and images become Markdown, and **macros are copied as they are**
  (`{{toc/}}`, `{{info}}…{{/info}}`, extension macros). XWiki Markdown 1.2 accepts the same macro syntax, so they keep
  working once the note is published. In Obsidian they appear as text. Pages whose source is empty (their content
  comes from an application sheet) are still converted from their rendered view.
- Converted notes get an `xwiki-syntax` property with the page's original syntax, and the panel shows a warning.
- XWiki Markdown links and images (`[[label|Space.Page]]`, `![[alt|file.png]]`) become wiki links and embeds in the
  vault, or links to XWiki when the target is not in the vault.
- Table cells filled with `&nbsp;` on publish become empty again.
- Pages that hold only attachments become a list of those attachments. Empty pages become empty notes.
- Attachments used by the page are downloaded to an **`assets` folder next to the note** (setting **Attachment
  folder**; leave it empty to use Obsidian's own attachment location). They move with the note, files that belong to
  other notes are never overwritten, and a name clash in the folder is solved by numbering (`logo 2.png`); such a file
  is still uploaded under its XWiki name when the note is published.
- Attachments that earlier versions saved elsewhere (for example in the vault root) are moved to the `assets` folder
  on the next pull or sync, when their name matches an attachment of the page and no other note links to them.
- Links to pages that exist in the vault become `[[wiki links]]`.
- New pages are written to the **Sync folder** (default: the vault root), which recreates the whole XWiki page tree
  from the wiki root, whatever space you sync from. Notes and folders are named after the page **titles**. A page
  with children becomes the **folder note** of the folder holding its children; see [Folder notes](#folder-notes).
- When a page is renamed or moved on XWiki, the next pull or sync renames or moves its note (Obsidian updates links
  to it), as long as the note is still where the plugin put it. A pulled note you moved yourself stays where you put
  it and is only renamed after the page title; folder notes keep the name of their folder. Notes you created in the
  vault are never moved or renamed, and only folders the plugin emptied by such a move are removed.
- A sync can be **resumed**: its progress is saved every few seconds, so after an interruption (Obsidian closed or
  crashed during a large sync) syncing the space again skips the pages and attachments already pulled. Attachments
  that failed to download are tried again on the next pull or sync, even when the page did not change. Pages that
  failed are listed in the result, with the reason.
- Attachments are downloaded again only when their XWiki version changed. Files you published from the vault are
  reused when the page is pulled, not downloaded as a copy, and they stay where you keep them.
- Inside a dedicated **Sync folder**, folders mirror XWiki spaces from the wiki root: a new note in `XWiki/Team/` is
  published below `Team`, not below the default space.

### Mentions

On XWiki a mention of a user is a macro, `{{mention reference="XWiki.jdoe" style="FULL_NAME" anchor="XWiki-jdoe-k3x9qa"/}}`.
In a note it is a link to the profile of the user, with the name XWiki shows:

```markdown
[@Jane Doe](https://wiki.example.com/bin/view/XWiki/jdoe#XWiki-jdoe-k3x9qa)
```

- **Pulling** writes the mentions of a page as such links, also in a note pulled before, at its next pull. The name
  is read from XWiki; when it cannot be read, the login is shown. **Opening** a note does the same for the mention
  macros still in it, when *Update comments and mentions when a note is opened* is on.
- **Publishing** writes each link back as the macro it was, character for character: the user, the style and the
  anchor are in the address of the link (the anchor after `#`, a style other than the full name as `?style=`). The
  text of the link is only for reading. XWiki notifies a user once for each anchor, so a published mention that did
  not change notifies nobody again.
- **To mention a user**, type `@` and the start of a name or login in a note that has an XWiki page, and choose the
  user from the list (setting **Suggest users to mention**; what is typed after the `@` is sent to XWiki to find
  the users). The command *Mention an XWiki user* and the editor menu do the same from a search box. A link written
  by hand works too: any link to a user profile whose text starts with `@`.
- A mention written in Obsidian has no anchor yet. Publishing gives it one, made like those of the XWiki editor,
  and XWiki notifies the user. The anchor is then written into the link in the note (`…/XWiki/jdoe#XWiki-jdoe-k3x9qa`),
  so the mention keeps it when other mentions are added before it, and nobody is notified twice. Notes published
  before this get their anchors when they are opened, for the mentions whose macro the page has.
- Mentions that are not written the way the XWiki editor writes them (other parameters, users of another wiki,
  groups) stay macros in the note and are published as they are.

### Inline comments

On XWiki, a comment can be made on a selection of the page text (*Annotate*). XWiki keeps such comments next to the
page, not in its content, so pulling shows them in the note with marks of its own (setting **Inline comments**):

```markdown
The budget of ==💬1.2M for Q3==[^xwiki-3] was approved.

[^xwiki-3]: 💬 **Jane Doe** · 2026-11-20 14:03: Is this still right?<br>↳ **John Roe** · 2026-11-21 09:10: Yes.
```

- The commented text is highlighted, starting with 💬, and followed by a footnote reference. The footnote holds the
  comment and the replies to it, with their authors and dates.
- Text that a highlight cannot wrap as it is (a selection that crosses formatting, a link, code or several lines)
  only gets the reference, and its footnote starts with the commented text.
- Comments whose text is not found in the note (it changed since, appears several times, or is in a heading or a
  code block) are referenced on a `💬` line after the text, so no comment is left out.
- **Nothing of this is published.** The marks are removed before a note is sent to XWiki, so the page content stays
  what it was and the comments on XWiki stay attached to their text. They do not count as an edit of the note
  either: a note that only shows new comments is still in sync.
- Comments are read when the page changed (a new comment gives it a new version), and at the next pull of a note
  that was synced before this was available or published since. Pulling a note you edited keeps your text and
  refreshes the comments in it.
- Comments on the page as a whole are not pulled.
- The footnote reference after a commented text (`[^xwiki-3]`) is hidden where the note is shown, in the reading
  view, in Live Preview and in table cells: the 💬 icon stands for it. In Live Preview it shows again where the cursor
  is, to be edited; the file always keeps it.
- **Selecting the 💬 icon** of a commented text, of the line of comments without a place, or of a footnote shows the
  comment and its replies in a popover, in the reading view, in Live Preview and in table cells alike, as XWiki has
  them now. Every comment and reply has its own **Reply** and **Delete** buttons; the comment also has **Resolve**.
  The rest of the highlighted text places the cursor as usual.
- On a wiki with comment resolution (the `Tools.CommentResolve` service), **resolved comments are shown too**, with the
  ✅ icon instead of 💬 and a faded highlight (`==✅text==`), their footnote starting with
  `✅ Resolved by <name> · <date>`. A comment resolved or reopened on XWiki is updated the next
  time the note is opened. **Resolve** in the popover resolves a comment, when you may resolve comments of the page;
  on a resolved comment it is **Reopen**. **Resolved XWiki comments** (editor menu, or the command *Show resolved
  XWiki comments of the note*) lists the resolved comments of the note with who resolved them, to reopen them.
- **Delete** removes that comment or reply and the replies below it on XWiki, for everyone, after a confirmation that
  says how many replies go with it. It needs *edit* right on the page.
- In the comment and reply boxes, typing `@` and the start of a name lists the XWiki users: the chosen one shows as
  `@Name` and is sent as an XWiki mention, so XWiki notifies them. Mentions in pulled comments show as links with the
  names of the users.
- **Opening a note** updates its comments too, in the background (setting **Update comments and mentions when a note
  is opened**): the plugin reads the page, at most every two minutes per note, and shows the comments it has now.
  This takes one request when nothing changed, and never changes the text of the note: when the page text changed
  on XWiki, a notice asks you to pull it. A note open for editing is changed in its editor, so nothing being typed
  is lost.

To comment from Obsidian, in a note that was published or pulled:

- **Comment on XWiki** (editor context menu, or the command *Comment on the selected text on XWiki*): select text,
  write the comment, and it is added to the page as an inline comment on that text.
- **Reply to XWiki comment** (editor context menu, or the command *Reply to the XWiki comment at the cursor*): with
  the cursor on a commented text or on its footnote, write the reply.

Both are sent right away under your XWiki account, like a comment made on XWiki, not with the next publish; the note
then shows the comments of the page again. The selected text must be on the page: publish the note first when the
text is new. A comment needs *comment* right on the page, a reply needs *edit* right. The marks in the note belong to
the plugin: text typed into them is not sent, and the next pull writes them again from what is on XWiki. Comments
are edited, deleted and resolved on XWiki.

### Folder notes

In XWiki a page can have content *and* child pages. In the vault, its children live in a folder, and the page itself
becomes that folder's **folder note**. Folder notes are built in; no other plugin is needed:

- Selecting a folder's name in the file explorer opens its folder note. The arrow still expands and collapses the
  folder, and folders with a folder note are underlined.
- Folder notes are hidden from the file explorer, so the folder shows only its children.
- Renaming or moving a folder renames or moves its folder note too.
- A folder without a folder note gets **Create folder note** in its context menu; one with a note gets **Open folder
  note**.

| Setting | Default | Meaning |
| --- | --- | --- |
| Folder note location | Inside the folder | `Projects/Projects.md` (inside) or `Projects.md` next to `Projects/`. |
| Folder note name | `{{folder_name}}` | File name template of folder notes. |
| Open folder notes from the file explorer | On | Selecting a folder opens its folder note. |
| Hide folder notes in the file explorer | On | Folder notes are not listed in the explorer. |
| Rename folder notes with their folder | On | The folder note follows renames and moves of its folder. |

The layouts are the same as those of the [Folder notes](https://github.com/LostPaul/obsidian-folder-notes) plugin by
Lost Paul, so a vault organised with it keeps working: select **Use Folder notes settings → Copy** to take over its
layout, then disable it so folders are not handled twice (the settings page warns while both are enabled). Notes
already pulled from XWiki move to a new layout on the next sync. Folder notes' *vault folder* storage location and
non-Markdown folder notes (canvas, base) are not supported.

The file explorer has no public API for these features, so they work on its interface, like other folder note
plugins; each of them can be turned off.

Folder notes are also respected when publishing:

- A folder note is published as its folder's page (`Docs.Projects.WebHome` for `Projects/Projects.md`), not as a page
  below it, and its title is the folder name unless `xwiki-title` is set.
- A note created inside a folder whose folder note was pulled from XWiki is published below that page.

### Conflicts

After each publish or pull, the plugin remembers the page version and a fingerprint of the note's body. Editing the
note's properties, links that Obsidian rewrites when the plugin moves a file, and spacing (Obsidian aligning the
cells of a table, blank lines) do not count as local changes. A note listed as modified by an earlier version only
because of spacing is in sync again when it is next opened, or compared (**Show differences**): the plugin checks
that it shows its page, spacing aside.

- **Pull**: when the note and the page both changed, you choose between *Keep both* and *Overwrite local note*.
  **Sync** keeps your note and writes the XWiki version next to it as `<Note> (XWiki conflict).md`.
  A page whose content is what it was at the last sync did not change in this sense: a new comment or attachment on
  it is pulled into the note you are editing, without a conflict.
- **Publish**: when the page changed on XWiki since the last sync, you are asked before it is overwritten.
- **Publish folder** and **Publish** in the *Source control* tab: notes in sync with their page are skipped. Pages
  changed on XWiki since the last sync, or not written in Markdown, are skipped and listed in the result, unless you
  choose *Publish and overwrite*.

### Deleted notes

A note that was published or pulled and then deleted from the vault, also outside Obsidian, is listed in the
*Source control* tab with a red **D**. Nothing happens on XWiki until you select it and publish:

- The confirmation names every page that will be deleted, and has *Publish and delete* and *Overwrite and delete*.
- The page goes with its attachments, into XWiki's recycle bin unless the administrator turned it off. **Pages below it
  stay**, and folder pages the plugin created for the note's folders stay too.
- A page changed on XWiki since the last sync, or not written in Markdown, is kept and listed in the result, unless you
  choose *Overwrite and delete*.
- A page that another note belongs to, for example a copy of the note with the same `xwiki-reference`, is never listed.
- A page that is already gone from XWiki is just removed from the list.
- *Publish folder* and *Publish* on a note never delete pages.

To keep the page, select the **×** on the row: the note leaves the list and the page stays on XWiki. Restoring the note
from the trash, or pulling its page again, also takes it off the list. Notes deleted before the plugin tracked deleted
notes are not listed, because it did not keep what it needs to find their pages.

### OpenProject links

Links in a note stay plain links on XWiki, so OpenProject would not know about the page. With an OpenProject set up,
publishing also links the XWiki page to those work packages, in the **Wikis** tab of each work package, through
[OpenProject's XWiki integration](https://www.openproject.org/docs/system-admin-guide/integrations/xwiki/). Publish,
*Publish folder* and *Publish* in the *Source control* tab all do this.

To set it up, enter the **OpenProject URL** and an **OpenProject token** (an API token from your OpenProject account
page) in the settings, and select **Test OpenProject connection**, there or in the panel's *Connection* section. The
token is kept in Obsidian's secret storage like the XWiki token, and sent only to that URL. Without a URL the plugin
never contacts OpenProject. Requirements and checks are in [docs/OPENPROJECT_SETUP.md](docs/OPENPROJECT_SETUP.md).

These links to the configured address count, with numeric or semantic ids such as `PROJ-123`. Links in code and in
`%%comments%%` do not:

```text
https://openproject.example.com/work_packages/123
https://openproject.example.com/wp/123
https://openproject.example.com/projects/demo/work_packages/123/activity
https://openproject.example.com/projects/demo/work_packages/details/123/overview
```

| Situation when publishing | What happens in OpenProject |
| --- | --- |
| The note links to a work package that is not linked to the page | The link is added. |
| The work package is already linked to the page | Nothing: a page is never linked twice. |
| The page on XWiki links to a work package and the note no longer does | The link is removed. |
| A work package was linked by hand and the page never linked to it | Nothing. |
| A note in a folder publish is in sync with its page | Its links are still checked, so existing pages get linked after setup. |
| The page is skipped, for example because it changed on XWiki | Nothing. |
| The page is deleted through a [deleted note](#deleted-notes) | The links of the page are removed first. |

Every note with work package links gets a line in **Recent activity**, for example
`OpenProject links of "Plan": linked #12; already linked #15; removed #9`. A folder publish also adds the totals to its
result. A failure here does not fail the publish: the page is saved, and the line names the work package and the error.
A removal is decided from the page's content before the publish, so one that failed is not tried again: remove that link
in OpenProject by hand.

### Note properties

| Property | Set by | Meaning |
| --- | --- | --- |
| `xwiki-reference` | Pull, or you | Full XWiki page reference; wins over every other rule. |
| `xwiki-space`, `xwiki-page` | You | Target space (dot separated, escape dots with `\.`) and page name. |
| `xwiki-title` | Pull, or you | Page title when it differs from the note name. |
| `xwiki-url` | Publish and pull | Address of the page; used by *Open published page in browser*. |
| `xwiki-syntax` | Pull | Original syntax of a page that was converted to Markdown. |

## Settings reference

| Setting | Default | What it does |
| --- | --- | --- |
| XWiki URL | – | Base URL of the XWiki instance; must start with `https://` (plain `http://` works but triggers a warning). |
| Wiki | `xwiki` | Wiki identifier. |
| Token | – | Secret in Obsidian's secret storage holding the XWiki access token. |
| Authentication method | Bearer token | Bearer, basic (username + token) or custom header. |
| Username / Header name | – | Shown for the basic and custom header methods. |
| Test connection | – | Checks the token and lists the Markdown syntaxes of the server. |
| **OpenProject** | | |
| OpenProject URL | – | Address of the OpenProject whose work packages get linked to published pages; empty turns this off. |
| OpenProject token | – | Secret in Obsidian's secret storage holding the OpenProject API token. |
| Test OpenProject connection | – | Checks the token, and that OpenProject has this XWiki as a wiki provider. |
| **Publishing** | | |
| Default space | `Obsidian` | Space for notes without a location of their own; dot separated for nested spaces. |
| Mirror folder structure | On | Publish notes below the default space following their folders. |
| Create folder pages | On | Create an empty page for each mirrored folder that has none. |
| Use nested pages | On | Nested pages (`Space.Note.WebHome`) instead of terminal pages (`Space.Note`). |
| Markdown syntax | `markdown/1.2` | Syntax id the pages are saved with. |
| Line breaks | Same as Obsidian | Publish single line breaks as line breaks (unless Obsidian's *Strict line breaks* is on), always, or never. |
| Obsidian comments | Remove | Remove `%%comments%%`, or keep them as `{{comment}}` macros: hidden on the page, visible in its source. |
| Suggest users to mention | On | List the matching XWiki users while `@` and a name are typed in a note that has a page. |
| Upload attachments | On | Upload embedded images and linked files. |
| Save page URL in note | On | Write `xwiki-url` to the note. |
| **Sync** | | |
| Sync folder | Vault root | Where the XWiki page tree is recreated. |
| Attachment folder | `assets` | Subfolder next to each pulled note for its attachments; empty uses Obsidian's attachment location. |
| Inline comments | On | Show the inline comments of a page in its pulled note; they are never published. |
| Update comments and mentions when a note is opened | On | Read the page of an opened note in the background and show its current comments and its mentions as links; the text is never changed. |
| Keep XWiki macros | Off | Convert XWiki syntax pages from their source and keep their macros. |
| **Folder notes** | | |
| Folder note location | Inside the folder | Inside (`X/X.md`) or next to the folder (`X.md`). |
| Folder note name | `{{folder_name}}` | File name template of folder notes. |
| Open folder notes from the file explorer | On | Selecting a folder opens its folder note. |
| Hide folder notes in the file explorer | On | Folder notes are not listed in the explorer. |
| Rename folder notes with their folder | On | The folder note follows renames and moves of its folder. |
| Use Folder notes settings | – | Copies the layout from the Folder notes plugin, for vaults that used it. |

## Limitations

- Math (`$…$`) and Mermaid diagrams are published as text and code: the formula, MathJax and Mermaid macros are
  separate XWiki extensions. Foldable callouts are shown open on XWiki.
- With comments removed (the default), a note pulled after its page was edited on XWiki loses its `%%comments%%`.
  Keep them as `{{comment}}` macros to avoid this, knowing that page editors can read them.
- Inline comments are added and answered with the commands of the plugin; text typed into the marks of a note is
  not sent to XWiki, and is replaced at the next pull. Comments cannot be edited or deleted from Obsidian. After
  publishing a note, pull it to see its comments where XWiki now has them.
- A link to a user profile whose text starts with `@` is published as a mention, and XWiki notifies that user.
  Mentions of pages that are converted from their rendered view (not written in Markdown, **Keep XWiki macros**
  off) are published with their anchors, but always with the full name style.
- Converting a non-Markdown page is lossy. By default macros are kept as their rendered output (for example links),
  and publishing such a note replaces the page's macros with that output. With **Keep XWiki macros** on, macros are
  kept, but formatting without a Markdown equivalent (CSS classes, `(% %)` parameters) is lost; underline,
  superscript and subscript become `<u>`, `<sup>` and `<sub>`. The plugin asks for confirmation before publishing
  over a page that is not written in Markdown.
- Kept macros run on XWiki only if the macro's extension is installed there.
- Deleting a page on XWiki is not synced to the vault. Deleting a note deletes its page only through the
  [*Source control* tab](#deleted-notes).
- Pages are found through `/bin/view/…` and `/bin/download/…` URLs below the configured XWiki URL. Instances with a
  different URL scheme are not supported.
- Space sync lists spaces through the REST API and falls back to XWiki's search index, which is updated with a short
  delay after pages are saved.
- OpenProject's wiki page link API is not part of its published API documentation, so an OpenProject upgrade may
  change it. Deleting a note does not remove its OpenProject links.

## Privacy, network use and accounts

- **Network use**: the plugin only talks to the XWiki server you configure, and only when you run an action (test
  connection, publish, pull, import, sync, check, comment, mention), when you open a note that has an XWiki page (to
  show its current comments and mentions; setting **Update comments and mentions when a note is opened**), and to
  list the users to mention while you type
  `@` and a name in a note that has an XWiki page (setting **Suggest users to mention**). It sends the notes you
  publish and their attachments, the comments and replies you write with its comment commands, and what you type
  to find a user; it downloads the pages you pull with their attachments and comments, and the names of the users
  they mention. It deletes a page only when you select its deleted note in the *Source control* tab,
  publish and confirm. If you configure OpenProject, it also talks to that server,
  when you test the connection and when you publish a note with work package links: it sends the work package numbers
  and the page's identifier, never the note's content.
- **Account**: an XWiki account and an access token for it are required. OpenProject links need an OpenProject account
  and an API token for it.
- **No telemetry**: the plugin collects no usage data and contacts no other service.
- **Files**: the plugin only reads and writes files inside your vault. It opens notes it published or pulled, the
  notes you act on, and the files they link to. While the panel's *Source control* tab is open, it lists the vault's
  Markdown notes to find the ones never published, and reads the notes it published or pulled to detect edits;
  nothing leaves the vault until you publish.
- **Tokens**: stored in Obsidian's secret storage and sent only to the XWiki or OpenProject URL they are configured
  for. Use HTTPS; with plain HTTP a token travels unencrypted, and the plugin warns about it.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type check and production build
npm run lint    # Obsidian's official ESLint rules
npm test        # unit tests
```

To try a build, copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/xwiki-publisher/`.

Release and submission steps are described in [docs/SUBMISSION.md](docs/SUBMISSION.md) (Turkish).

## License

[MIT](LICENSE)
