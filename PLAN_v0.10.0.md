# Plan v0.10.0 — Embedded Spreadsheet Lists

## Background/Context

There are a number of other schedules or lists that would be useful to include within the portfolio app. Typical examples:

- List of savings outside financial wrappers (NS&I savings, bank deposit accounts, etc.)
- List of gifts for IHT purposes
- List of regular expenditure (support for gifts from income for IHT relief)
- List of other pensions (State pension, annuities, employment pensions)

These lists will be variable. To provide a flexible approach they will be maintained outside the Portfolio 60 system on Google Sheets (or Microsoft Excel Online). The facility to embed spreadsheets in web pages will be used to give the Portfolio 60 user a seamless consolidated financial view.

### Microsoft Excel Embed Support

Investigation confirms that Microsoft Excel Online (via OneDrive / SharePoint) **does** support embedding spreadsheets via iframe, similar to Google Sheets. The process is:

1. Upload the workbook to OneDrive
2. Right-click the file > **Embed** > **Generate**
3. Copy the generated iframe HTML

A typical Microsoft embed iframe looks like:

```html
<iframe width="500" height="300" frameborder="0" scrolling="no"
  src="https://onedrive.live.com/embed?resid=...&authkey=...&em=2&wdAllowInteractivity=True&wdHideGridlines=True&wdHideHeaders=True">
</iframe>
```

Both platforms produce standard iframes and work identically from the embedding perspective. The config will include a `spreadsheet` field (`"google"` or `"microsoft"`) for documentation/identification purposes, though functionally the iframe embedding works the same way for both.

---

## Scope

### 1. Config.json — New `lists` Section

Add a new top-level key `"lists"` to `src/shared/config.json`:

```json
{
  "lists": {
    "_readme": "Embedded spreadsheet lists displayed under the Lists menu. Each entry has a title (shown in the menu), an iframe (the full embed HTML from Google Sheets or Excel Online 'Publish to Web'), and a spreadsheet type for reference.",
    "items": [
      {
        "title": "Non-SIPP Pensions",
        "spreadsheet": "google",
        "iframe": "<iframe src=\"https://docs.google.com/spreadsheets/d/e/2PACX-1vT0tY4WK.../pubhtml?gid=2045542612&amp;single=true&amp;widget=true&amp;headers=false\"></iframe>"
      },
      {
        "title": "IHT Gifts",
        "spreadsheet": "microsoft",
        "iframe": "<iframe src=\"https://onedrive.live.com/embed?resid=...&authkey=...&em=2\"></iframe>"
      }
    ]
  }
}
```

**Fields per item:**
| Field | Type | Description |
|---|---|---|
| `title` | string | Menu label and page heading (e.g. "Non-SIPP Pensions") |
| `spreadsheet` | `"google"` \| `"microsoft"` | Which platform hosts the spreadsheet |
| `iframe` | string | The complete iframe HTML from the provider's "Publish to Web" / "Embed" feature |
| `range` | string (optional) | Cell range to display. Google Sheets: cell range e.g. `A3:F14` (appended as `&range=`). Microsoft Excel: a named range defined in the workbook e.g. `MyTable` (appended as `&Item=`). Leave empty to show the full sheet. |

Users manage this list via the existing **Edit Settings** modal (gear icon > Edit Settings), which already allows direct editing of `config.json`.

### 2. Navbar — New "Lists" Dropdown

Add a **Lists** dropdown menu to the navbar, positioned between **Reports** and the **gear icon**.

Current order: `Home | Set Up v | Portfolio v | Reports | [gear]`
New order: `Home | Set Up v | Portfolio v | Reports | Lists v | [gear]`

The dropdown is **dynamically populated** from `config.json` `lists.items[]`. Each item becomes a menu link. If `lists.items` is empty or missing, the Lists menu displays as greyed-out text (like Reports currently does when it has no content).

Each menu link navigates to: `/pages/list-viewer.html?index=0` (where `index` is the position in the items array).

### 3. API Endpoint — `GET /api/config/lists`

A simple endpoint that returns the `lists.items` array from config.json. This is used by the navbar to populate the dropdown and by the viewer page to load the selected list.

**Response:**
```json
{
  "items": [
    { "title": "Non-SIPP Pensions", "spreadsheet": "google", "iframe": "<iframe ...>" },
    { "title": "IHT Gifts", "spreadsheet": "microsoft", "iframe": "<iframe ...>" }
  ]
}
```

This endpoint is **behind the auth gate** (same as other UI-serving routes).

### 4. List Viewer Page — `src/ui/pages/list-viewer.html`

A new HTML page following the standard page template (same structure as home page, users page, etc.):

```
<app-navbar>
<main>
  <h2>{{ title from config }}</h2>
  <div id="iframe-container">
    {{ embedded iframe, resized to fill available space }}
  </div>
</main>
<app-footer>
```

**Behaviour:**
- Reads the `index` query parameter from the URL
- Fetches `/api/config/lists` to get the items array
- Extracts the item at the given index
- Sets the page `<h2>` heading to the item's `title`
- Sets the document `<title>` to `Portfolio 60 — {{ title }}`
- Parses the `iframe` string to extract the `src` URL
- Renders the iframe inside a responsive container using the 16:9 aspect ratio technique:
  ```css
  .responsive-sheet-container {
      position: relative;
      overflow: hidden;
      padding-top: 56.25%; /* 16:9 Aspect Ratio */
  }
  .responsive-sheet-container iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: 0;
  }
  ```
- If the index is out of range or items are empty, shows an error message

**Security note:** The iframe `src` is validated to ensure it starts with an allowed domain (`docs.google.com` or `onedrive.live.com` / `*.sharepoint.com`) before rendering into the page. This prevents arbitrary iframe injection if someone manually edits the config with a malicious URL.

### 5. List Viewer JavaScript — `src/ui/js/list-viewer.js`

Page-specific JavaScript that:
- Parses the `?index=` query parameter
- Calls `apiRequest('/api/config/lists')` (using the existing shared helper)
- Validates the index and renders the heading + iframe
- Handles error states (no lists configured, invalid index)

---

## Implementation Steps

### Step 1: Add `lists` section to config.json
- Add the `lists` key with `_readme` and `items` array
- Pre-populate with the example Non-SIPP Pensions Google Sheets entry from the requirements

### Step 2: Add API endpoint `GET /api/config/lists`
- Add to the existing config routes (`src/server/routes/config-routes.js`)
- Read config.json, return `{ items: config.lists?.items || [] }`

### Step 3: Update navbar with Lists dropdown
- Edit `src/ui/js/components/app-navbar.js`
- Add the Lists `<li>` between Reports and the gear icon
- On `firstUpdated()`, fetch `/api/config/lists` and dynamically populate the dropdown links
- If no items, render as greyed-out "Lists" text (matching the Reports placeholder style)
- Active nav highlighting for list-viewer pages

### Step 4: Create the list viewer page
- Create `src/ui/pages/list-viewer.html` following the standard page template
- Create `src/ui/js/list-viewer.js` with the page logic

### Step 5: Add static file route for the new page
- The existing static file handler in `src/server/index.js` already serves anything under `/pages/*.html`, so no route changes needed — verify this.

### Step 6: Manual testing
- Add a test Google Sheets embed to config via Edit Settings
- Verify the Lists menu appears and populates
- Verify clicking a list opens the viewer with the correct heading and embedded sheet
- Verify empty state (no lists configured) shows greyed-out menu
- Test with a Microsoft Excel Online embed iframe

---

## Files Changed

| File | Change |
|---|---|
| `src/shared/config.json` | Add `lists` section |
| `src/server/routes/config-routes.js` | Add `GET /api/config/lists` endpoint |
| `src/ui/js/components/app-navbar.js` | Add Lists dropdown, dynamic population |
| `src/ui/pages/list-viewer.html` | New page (standard template) |
| `src/ui/js/list-viewer.js` | New page script |

No database changes. No new dependencies. No test port allocation needed (no server-spawning tests for this feature — it's config-driven UI).

---

## Decisions (Confirmed)

1. **Sample data**: Pre-populate config.json with the example Non-SIPP Pensions Google Sheets entry from the requirements.
2. **Iframe sizing**: Use the responsive 16:9 aspect ratio container technique (`padding-top: 56.25%` with absolute-positioned iframe).
3. **Domain allowlist**: `docs.google.com` and `onedrive.live.com` / `*.sharepoint.com` — these two cover all use cases.
