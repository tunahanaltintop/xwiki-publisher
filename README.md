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
- The vault folder structure is **mirrored** as nested XWiki pages, and pulled pages recreate the XWiki page tree in
  the vault.
- **Conflict protection** in both directions: nothing is overwritten silently when a note and its page both changed.
- **Built-in folder notes**: XWiki pages that have children become folder notes, and selecting a folder in the file
  explorer shows the parent page's content. No other plugin is needed.
- A **side panel** with every action, the note's target page, its sync state and recent activity.
- A **Source control** tab that lists every note added, modified or deleted since its last sync, as a list or a folder
  tree, and **publishes the selected changes** in one go, including deleting the pages of deleted notes.
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
- **Recent activity** below the list shows the results of the latest operations, the same list as on the *XWiki* tab.

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
note's properties, or links that Obsidian rewrites when the plugin moves a file, do not count as local changes.

- **Pull**: when the note and the page both changed, you choose between *Keep both* and *Overwrite local note*.
  **Sync** keeps your note and writes the XWiki version next to it as `<Note> (XWiki conflict).md`.
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
| Upload attachments | On | Upload embedded images and linked files. |
| Save page URL in note | On | Write `xwiki-url` to the note. |
| **Sync** | | |
| Sync folder | Vault root | Where the XWiki page tree is recreated. |
| Attachment folder | `assets` | Subfolder next to each pulled note for its attachments; empty uses Obsidian's attachment location. |
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
  connection, publish, pull, import, sync, check). It sends the notes you publish and their attachments, and
  downloads the pages you pull with their attachments. It deletes a page only when you select its deleted note in the
  *Source control* tab, publish and confirm. If you configure OpenProject, it also talks to that server,
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
