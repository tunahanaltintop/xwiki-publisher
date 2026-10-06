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
- Works with the [Folder notes](https://github.com/LostPaul/obsidian-folder-notes) plugin: XWiki pages that have
  children become folder notes, so selecting a folder shows the parent page's content.
- A **side panel** with every action, the note's target page, its sync state and recent activity.
- The access token is kept in Obsidian's **secret storage**, never in the plugin's data file.

## Requirements

- Obsidian **1.11.4** or later (desktop and mobile).
- An XWiki instance reachable over **HTTPS** with:
  - the **Markdown Syntax 1.2** extension installed (syntax id `markdown/1.2`);
  - an authenticator that accepts an **access token** (for example a bearer token issued by the OpenID Connect
    Provider extension) on both REST (`/rest/…`) and page (`/bin/…`) URLs;
  - an XWiki **account** with *view* right on the spaces you pull and *edit* right on the spaces you publish to.

The XWiki administrator checklist, with commands to verify each point, is in
[docs/XWIKI_SETUP.md](docs/XWIKI_SETUP.md) (Turkish).

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

## Usage

Open the side panel with the **Open XWiki panel** ribbon icon or the **XWiki Publisher: Open panel** command. It
shows, for the current note, the XWiki page it maps to, whether it is in sync, and buttons for every action.

| Action | Where | What it does |
| --- | --- | --- |
| Publish current note | Panel, command palette, file menu | Creates or updates the note's XWiki page and uploads its attachments. |
| Pull current note from XWiki | Panel, command palette, file menu | Updates the note from its XWiki page. |
| Check XWiki | Panel | Tells whether the page changed on XWiki since the last sync. |
| Import page from XWiki | Panel, command palette | Imports one page given by URL or reference (`Space.Page`). |
| Sync space from XWiki | Panel, command palette | Pulls a page and every page below it, given by URL or space reference. |
| Open published page in browser | Panel, command palette | Opens the page saved in the note's `xwiki-url` property. |

Only one XWiki operation runs at a time. A running space sync shows its progress in the panel and can be cancelled.

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
| Frontmatter, `%%comments%%` | Removed |
| `![[image.png]]`, `![](image.png)` | Image pointing at the uploaded attachment |
| `![[file.pdf]]`, `[label](file.pdf)` | Link to the uploaded attachment |
| `[[Note]]`, `[[Note#Heading\|alias]]` | Link to the page the note is (or will be) published to |
| `![[Note]]` (transclusion) | Link to the note's page; XWiki has no transclusion |
| XWiki macros (`{{toc/}}`, `{{info}}…{{/info}}`) | Unchanged: Markdown 1.2 runs them like XWiki syntax does |
| Empty table cells | Filled with a non-breaking space (`&nbsp;`), so XWiki keeps the columns |
| Unresolved `[[links]]` | Plain text |
| Code blocks and inline code | Unchanged |

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
- Attachments are downloaded again only when their XWiki version changed. Files you published from the vault are
  reused when the page is pulled, not downloaded as a copy, and they stay where you keep them.
- Inside a dedicated **Sync folder**, folders mirror XWiki spaces from the wiki root: a new note in `XWiki/Team/` is
  published below `Team`, not below the default space.

### Folder notes

In XWiki a page can have content *and* child pages. In the vault, its children live in a folder, and the page itself
becomes that folder's **folder note**. With the [Folder notes](https://github.com/LostPaul/obsidian-folder-notes)
plugin by Lost Paul ([documentation](https://lostpaul.github.io/obsidian-folder-notes/)) installed, selecting the
folder opens the page's content.

| Setting | Default | Meaning |
| --- | --- | --- |
| Folder note location | Inside the folder | `Projects/Projects.md` (inside) or `Projects.md` next to `Projects/`. |
| Folder note name | `{{folder_name}}` | File name of folder notes, as in Folder notes. |

The defaults match the Folder notes defaults. If you changed Folder notes' *Storage location* or *Folder note name*,
select **Use Folder notes settings → Copy** in **Settings → XWiki Publisher**; the settings page also warns when the
two plugins disagree. Notes already pulled from XWiki move to the new layout on the next sync. Folder notes' *vault
folder* storage location and non-Markdown folder note types (canvas, base) are not supported.

Folder notes are also respected when publishing:

- A folder note is published as its folder's page (`Docs.Projects.WebHome` for `Projects/Projects.md`), not as a page
  below it, and its title is the folder name unless `xwiki-title` is set.
- A note created inside a folder whose folder note was pulled from XWiki is published below that page.

Folder notes is an independent plugin; XWiki Publisher works without it, the folder notes are then regular notes.

### Conflicts

After each publish or pull, the plugin remembers the page version and a fingerprint of the note's body. Editing the
note's properties, or links that Obsidian rewrites when the plugin moves a file, do not count as local changes.

- **Pull**: when the note and the page both changed, you choose between *Keep both* and *Overwrite local note*.
  **Sync** keeps your note and writes the XWiki version next to it as `<Note> (XWiki conflict).md`.
- **Publish**: when the page changed on XWiki since the last sync, you are asked before it is overwritten.

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
| **Publishing** | | |
| Default space | `Obsidian` | Space for notes without a location of their own; dot separated for nested spaces. |
| Mirror folder structure | On | Publish notes below the default space following their folders. |
| Create folder pages | On | Create an empty page for each mirrored folder that has none. |
| Use nested pages | On | Nested pages (`Space.Note.WebHome`) instead of terminal pages (`Space.Note`). |
| Markdown syntax | `markdown/1.2` | Syntax id the pages are saved with. |
| Upload attachments | On | Upload embedded images and linked files. |
| Save page URL in note | On | Write `xwiki-url` to the note. |
| **Sync** | | |
| Sync folder | Vault root | Where the XWiki page tree is recreated. |
| Attachment folder | `assets` | Subfolder next to each pulled note for its attachments; empty uses Obsidian's attachment location. |
| Keep XWiki macros | Off | Convert XWiki syntax pages from their source and keep their macros. |
| **Folder notes** | | |
| Folder note location | Inside the folder | Inside (`X/X.md`) or next to the folder (`X.md`). |
| Folder note name | `{{folder_name}}` | File name template of folder notes. |
| Use Folder notes settings | – | Copies both settings from the Folder notes plugin. |

## Limitations

- Obsidian-only syntax such as highlights (`==text==`), callouts, block references and embedded notes has no XWiki
  Markdown equivalent and is published as plain text or links.
- Converting a non-Markdown page is lossy. By default macros are kept as their rendered output (for example links),
  and publishing such a note replaces the page's macros with that output. With **Keep XWiki macros** on, macros are
  kept, but formatting without a Markdown equivalent (underline, CSS classes, `(% %)` parameters) is lost. The plugin
  asks for confirmation before publishing over a page that is not written in Markdown.
- Kept macros run on XWiki only if the macro's extension is installed there.
- Deleting a note or a page is not synced: delete it on the other side yourself.
- Pages are found through `/bin/view/…` and `/bin/download/…` URLs below the configured XWiki URL. Instances with a
  different URL scheme are not supported.
- Space sync lists spaces through the REST API and falls back to XWiki's search index, which is updated with a short
  delay after pages are saved.

## Privacy, network use and accounts

- **Network use**: the plugin only talks to the XWiki server you configure, and only when you run an action (test
  connection, publish, pull, import, sync, check). It sends the notes you publish and their attachments, and
  downloads the pages you pull with their attachments.
- **Account**: an XWiki account and an access token for it are required.
- **No telemetry**: the plugin collects no usage data and contacts no other service.
- **Files**: the plugin only reads and writes files inside your vault. It never lists the vault's files: it only
  opens notes it published or pulled, the notes you act on, and the files they link to.
- **Token**: stored in Obsidian's secret storage and sent only to the configured XWiki URL. Use HTTPS; with plain
  HTTP the token travels unencrypted, and the plugin warns about it.

## Development

```bash
npm install
npm run dev     # watch build; copies the build to OBSIDIAN_PLUGIN_DIR from .env when set
npm run build   # type check and production build
npm run lint    # Obsidian's official ESLint rules
npm test        # unit tests
```

To try a build, copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/xwiki-publisher/`, or
copy `.env.example` to `.env` and point `OBSIDIAN_PLUGIN_DIR` at that folder.

Release and submission steps are described in [docs/SUBMISSION.md](docs/SUBMISSION.md) (Turkish).

## License

[MIT](LICENSE)
