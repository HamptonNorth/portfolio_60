# PLAN v0.11.0 — Documentation Subsystem ("Docs")

## Background

A prior Bun + Tauri app + SQLite + SQLite Text search, `~/code/bunstarter` has a markdown-based content system complete with Front Matter support, markdown content editing, search and multiple categories determined by config.json entries. All data is held in directories `./public/pages/category/*.md` files. It is almost a sub-application accessed from the top menu.

We want to lift this section of code with all the functionality. This will provide a Documentation subsystem for portfolio_60.

Simply add a new menu option to the toolbar called "Docs". This will access a "Pages" submenu exactly as `~/code/bunstarter` does.

---

## Source Analysis (bunstarter)

The Pages subsystem in bunstarter consists of these major components:

### What we are lifting

| Component | bunstarter location | Purpose |
|---|---|---|
| **Page config** | `.env` `PAGE_CONFIG` variable | JSON map of category names to styles, parsed by `getPagesConfig()` |
| **Style registry** | `src/style-registry.js` | Registry of markdown CSS styles with metadata (wrapper class, CSS file, fonts) |
| **Markdown CSS files** | `public/styles/md-styles/*.css` | Scoped CSS for each style (github, modest — only these two carried over) |
| **Front matter parser** | `src/server.js` `parseFrontMatter()` | Parses YAML front matter from markdown files |
| **API routes** | `src/server.js` (inline) | 8 endpoints: list, content, raw read/write, upload, media upload, search, reindex, search-meta |
| **FTS search service** | `src/services/pages-search.js` | SQLite FTS5 full-text search with weighted fields and access control |
| **Pages list page** | `public/views/pages-list.html` | Category listing with admin controls (edit, upload, publish) |
| **Page detail page** | `public/views/page-detail.html` | Server-side rendered markdown with dynamic style injection |
| **Search modal** | `src/components/rm-pages-search-modal.js` | LitElement full-screen search with debounce, highlighting, reindex |
| **Nav menu** | `src/components/rm-nav-header-pages.js` | "Content" dropdown with category links + search trigger |
| **Markdown renderer** | `marked` npm package | Converts markdown body to HTML |
| **Code highlighting** | `highlight.js` (CDN) | Syntax highlighting for code blocks |
| **File storage** | `public/pages/{category}/*.md` | Flat-file markdown storage per category |
| **Media storage** | `public/media/{category}/*` | Uploaded images per category |

### Front matter fields supported

```yaml
---
title: Required - page heading
summary: Brief description for list view
created: ISO-8601 date
published: "y" or "n" (default "y")
sticky: "true"/"false" - pins to top of list
style: Override category style
read-mode: "true"/"false" - narrow 720px reading width
lapse: ISO-8601 date - page hidden after this date (e.g. tax year expiry)
---
```

> **Note:** bunstarter also supports a `private` (email-restricted) field. This relies on bunstarter's session/user system. Portfolio 60 has a simpler passphrase-only auth model with no per-user sessions, so `private` will be **omitted**. However, `lapse` (expiry date) **is included** — useful for time-sensitive documents like tax rate tables that become invalid for future tax years. Lapsed pages are hidden from listings and return a "This document has expired" message if accessed directly.

### FTS5 search schema

The search index extracts structured content from markdown (headings, bold, links, blockquotes, code, body text) into separate weighted columns. BM25 ranking with title weighted 10x, description 8x, headings 4-6x, body 1x.

---

## Adaptation Decisions for Portfolio 60

### What changes from bunstarter

| Aspect | bunstarter | portfolio_60 adaptation |
|---|---|---|
| **Menu label** | "Content" | "Docs" |
| **Config source** | `.env` `PAGE_CONFIG` | `config.json` `docs` key (consistent with existing Lists config pattern) |
| **Auth model** | Session-based, admin/user roles | Passphrase-only; all authenticated users are effectively admin |
| **Private field** | Supported | Omitted — no per-user access control |
| **Lapse field** | Supported | **Kept** — useful for time-sensitive docs (e.g. tax year rates) |
| **Routes structure** | Inline in server.js | Separate `src/server/routes/docs-routes.js` (follows portfolio_60 pattern) |
| **File storage** | `public/pages/{category}/` | `docs/{category}/` in project root (not inside src/ui) |
| **Media storage** | `public/media/{category}/` | `docs/media/{category}/` |
| **Static file serving** | Via Bun.file() | Same, new `/docs/` static route for media |
| **FTS service** | `src/services/pages-search.js` | `src/server/services/docs-search.js` |
| **Style CSS files** | `public/styles/md-styles/` | `src/ui/css/md-styles/` |
| **Pages HTML** | `public/views/pages-list.html`, `page-detail.html` | `src/ui/pages/docs-list.html`, `docs-page.html` |
| **Pages JS** | Inline in HTML | `src/ui/js/docs-list.js`, `src/ui/js/docs-page.js` |
| **Search component** | `rm-pages-search-modal.js` LitElement | `src/ui/js/components/docs-search-modal.js` LitElement |
| **Nav integration** | Separate `rm-nav-header-pages.js` | Add to existing `app-navbar.js` |
| **Markdown library** | `marked` | `marked` (add as dependency) |
| **Code highlighting** | highlight.js from CDN | Same CDN approach |

| **Sidebar mode** | Supported via `:sidebar` flag | Removed — not needed for portfolio_60 |
| **Auth gate** | Session-based | **No auth gate** — docs routes are unprotected (like scraper routes) |

### What stays the same

- Front matter parsing logic (simple regex-based)
- Style registry concept (reduced to github + modest styles only)
- FTS5 search with weighted columns and BM25 ranking
- File-based storage (markdown files on disk, not in SQLite)
- Upload flow (markdown + media)
- Server-side markdown rendering with style injection
- Filename sanitisation and path traversal protection

---

## Config Structure

Add a `docs` key to `config.json` (following the existing pattern used by Lists):

```json
{
  "docs": {
    "categories": {
      "guide": { "style": "github", "label": "User Guide" },
      "notes": { "style": "modest", "label": "Financial Notes" }
    }
  }
}
```

- `categories` — each key is the folder name under `docs/`, value has `style` (default markdown CSS) and `label` (display name in menu)
- Only two styles available: `github` and `modest`

---

## Implementation Plan

### Phase 1: Foundation (files, config, styles)

**1.1 Add `marked` dependency**
```bash
bun add marked
```

**1.2 Create directory structure**
```
docs/                          # Document storage (gitignored contents, keep .gitkeep)
docs/media/                    # Media uploads
src/ui/css/md-styles/          # Copy github + modest CSS files from bunstarter
src/server/services/           # Already exists
```

**1.3 Copy and adapt style registry**
- Copy `~/code/bunstarter/src/style-registry.js` to `src/server/services/style-registry.js`
- Adapt to portfolio_60 conventions (JSDoc, camelCase functions)
- Strip down to only `github` and `modest` style entries
- Remove sidebar-related logic

**1.4 Copy markdown CSS files**
- Copy only `md-github.css` and `md-modest.css` from `~/code/bunstarter/public/styles/md-styles/` to `src/ui/css/md-styles/`
- No modifications needed — they are self-contained scoped CSS

**1.5 Add docs config support**
- Add `docs` section handling to `src/server/routes/config-routes.js`
- `GET /api/config/docs` — returns categories and available styles
- Read from `config.json` `docs` key

**1.6 Update `.gitignore`**
- Add `docs/` contents (but keep directory via `.gitkeep`)
- Similar pattern to `data/` and `backups/`

### Phase 2: Backend API routes

**2.1 Create front matter parser**
- `src/server/services/docs-frontmatter.js`
- Lift `parseFrontMatter()` and `ensureUnpublishedFrontMatter()` from bunstarter
- Adapt for portfolio_60 (remove private handling, keep lapse)

**2.2 Create docs routes**
- `src/server/routes/docs-routes.js` following existing Router pattern
- Endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/docs/config` | Get categories + styles config |
| GET | `/api/docs/list/:category` | List pages in category |
| GET | `/api/docs/content/:category/:slug` | Get rendered HTML + meta + style |
| GET | `/api/docs/raw/:category/:slug` | Get raw markdown for editing |
| PUT | `/api/docs/raw/:category/:slug` | Save edited markdown |
| POST | `/api/docs/upload/:category` | Upload new markdown file |
| POST | `/api/docs/media/:category` | Upload image file |
| DELETE | `/api/docs/:category/:slug` | Delete a page |
| GET | `/api/docs/search?q=term` | Full-text search |
| POST | `/api/docs/reindex` | Rebuild search index |
| GET | `/api/docs/search-meta` | Search index metadata |

**2.3 Create FTS search service**
- `src/server/services/docs-search.js`
- Lift from `~/code/bunstarter/src/services/pages-search.js`
- Adapt: remove private filtering, keep lapse filtering (hide expired docs from search results), use portfolio_60 DB connection pattern
- FTS5 table: `docs_search` (avoid collision with any future tables)
- Auto-index on first access + manual reindex endpoint

**2.4 Wire routes into server**
- Import `handleDocsRoute` in `src/server/index.js`
- Add route matching for `/api/docs/` paths
- Add static file route for `/css/md-styles/` (style CSS files)
- Add static file route for `/docs/media/` (uploaded images)
- **No auth gate** — docs routes are unprotected (add to auth middleware exclusion list alongside scraper routes)

### Phase 3: Frontend — pages list view

**3.1 Create docs list page**
- `src/ui/pages/docs-list.html` — HTML template
- `src/ui/js/docs-list.js` — page logic

Features (lifted from bunstarter `pages-list.html`):
- Display all pages in selected category as card list
- Sort: sticky pages first, then by created date descending
- Each card shows: title, summary, created date
- Click card → navigate to `docs-page.html?category=X&slug=Y`
- **Admin controls** (all users in portfolio_60):
  - Edit button → opens markdown editor modal
  - Delete button → confirmation dialog then DELETE API call
  - Publish/unpublish toggle
  - Upload modal (drag-and-drop or file picker for .md files)
  - Media upload within editor
- Load-more pagination (15 items at a time)
- Empty state message when category has no pages

**3.2 Create docs page detail view**
- `src/ui/pages/docs-page.html` — HTML template
- `src/ui/js/docs-page.js` — page logic

Features (lifted from bunstarter `page-detail.html`):
- Render markdown content with selected style CSS
- Dynamic style CSS injection (preload + stylesheet swap)
- Font loading for styles that need Google Fonts
- Read-mode support (720px centred width)
- Code block copy buttons
- Edit button → navigate back to list with editor open, or inline edit modal
- Back to category list link
- Code syntax highlighting via highlight.js CDN

### Phase 4: Frontend — search and navigation

**4.1 Create search modal component**
- `src/ui/js/components/docs-search-modal.js` — LitElement component
- Lift from bunstarter `rm-pages-search-modal.js`
- Adapt: remove admin/user role distinction, remove private filtering, keep lapse filtering
- Features:
  - Full-screen modal overlay
  - Search input with debounce (250ms)
  - Minimum 3-character query
  - Results with title, category, snippet with `<mark>` highlighting
  - Click result → navigate to docs-page
  - Reindex button
  - Last indexed timestamp display
  - Escape key to close

**4.2 Add "Docs" menu to navbar**
- Modify `src/ui/js/components/app-navbar.js`
- Add "Docs" dropdown between "Reports" and "Lists" (or after "Lists")
- Dropdown items:
  - One link per configured category: `/pages/docs-list.html?category=X` with label from config
  - Separator
  - "Search Docs" button → opens search modal
- Fetch categories from `/api/docs/config` on component load (same pattern as Lists)
- Only show "Docs" menu if categories are configured

**4.3 Update active nav highlighting**
- Update `highlightActiveNav()` in `app.js` to handle docs pages

### Phase 5: Database migration and indexing

**5.1 Add FTS migration**
- Add migration (next sequence number) in `src/server/db/connection.js`
- Creates `docs_search` FTS5 virtual table and `docs_search_meta` table
- Runs automatically on server start like all other migrations

**5.2 Auto-index on startup**
- On server start, if `docs_search_meta` has no `lastIndexed` entry, trigger a full reindex
- Subsequent reindexes are manual via the search modal button or API

### Phase 6: Testing

**6.1 Unit tests**
- `tests/unit/docs-routes.test.js` — API endpoint tests (CRUD, upload, search)
- `tests/unit/docs-search.test.js` — FTS indexing and search tests
- `tests/unit/docs-frontmatter.test.js` — Front matter parsing tests
- Use unique test ports (1445, 1446, 1447)

**6.2 Manual testing checklist**
- Create categories in config.json
- Upload markdown files via UI
- View rendered pages with different styles
- Edit and save pages
- Search across categories
- Delete pages
- Upload media and reference in markdown
- Verify front matter fields (title, summary, created, published, sticky, style, read-mode)
- Verify code highlighting works

---

## File Inventory

### New files to create

| File | Source | Notes |
|---|---|---|
| `src/server/routes/docs-routes.js` | Adapted from bunstarter `server.js` inline routes | All docs API endpoints |
| `src/server/services/docs-search.js` | Adapted from bunstarter `pages-search.js` | FTS5 search service |
| `src/server/services/docs-frontmatter.js` | Adapted from bunstarter `server.js` | Front matter parser |
| `src/server/services/style-registry.js` | Adapted from bunstarter `style-registry.js` | Style config registry |
| `src/ui/pages/docs-list.html` | Adapted from bunstarter `pages-list.html` | Category page listing |
| `src/ui/pages/docs-page.html` | Adapted from bunstarter `page-detail.html` | Single page view |
| `src/ui/js/docs-list.js` | Adapted from bunstarter (inline in HTML) | List page logic |
| `src/ui/js/docs-page.js` | Adapted from bunstarter (inline in HTML) | Detail page logic |
| `src/ui/js/components/docs-search-modal.js` | Adapted from bunstarter `rm-pages-search-modal.js` | Search component |
| `src/ui/css/md-styles/md-github.css` | Direct copy from bunstarter | GitHub markdown style CSS |
| `src/ui/css/md-styles/md-modest.css` | Direct copy from bunstarter | Modest markdown style CSS |
| `tests/unit/docs-routes.test.js` | New | API tests |
| `tests/unit/docs-search.test.js` | New | Search tests |
| `tests/unit/docs-frontmatter.test.js` | New | Parser tests |
| `docs/.gitkeep` | New | Keep empty directory |
| `docs/media/.gitkeep` | New | Keep empty media directory |

### Existing files to modify

| File | Change |
|---|---|
| `src/server/index.js` | Import docs routes, add `/api/docs/` routing, add `/css/md-styles/` and `/docs/media/` static serving |
| `src/ui/js/components/app-navbar.js` | Add "Docs" dropdown menu with dynamic categories + search |
| `src/server/db/connection.js` | Add migration for `docs_search` FTS5 table |
| `src/shared/constants.js` | Add `DOCS_DIR` constant |
| `package.json` | Add `marked` dependency (via `bun add`) |
| `.gitignore` | Add `docs/` content exclusion pattern |
| `src/ui/js/app.js` | Update `highlightActiveNav()` for docs pages |

---

## Resolved Decisions

| Decision | Resolution |
|---|---|
| **Styles** | Only `github` and `modest` — two CSS files, two registry entries |
| **Initial categories** | `guide` (User Guide) and `notes` (Financial Notes) |
| **Sidebar mode** | Removed — not needed |
| **Delete** | Yes — DELETE endpoint included |
| **Auth gate** | **No auth gate** — docs routes are unprotected (like scraper routes) |
| **Lapse field** | **Kept** — useful for tax year documents that expire |
| **Private field** | Omitted — no per-user sessions |
| **Version bump** | Bump `APP_VERSION` to `0.11.0` at the start of implementation |
