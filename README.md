# SBP Apps

Web tools for the Structural Biology Programme · CNIO.

Served at: **https://cryoem-cnio.github.io/SBP-APPS/**

---

## Approval workflow

**No one pushes directly to `main`.** The `main` branch is protected.
Every change — whether made by a collaborator or by Claude — must go
through a pull request that Rafa reviews and merges.

Claude's steps for every change:

1. Get the current HEAD SHA of `main`.
2. Create a branch named `draft/YYYYMMDD-HHMM-<short-desc>`.
3. Push all changed files to that branch (never to `main`).
4. Open a pull request targeting `main` with a clear title and description.
5. Print the PR URL and stop — do **not** declare the deploy done.

A deploy is only live after Rafa merges the PR **and** the served file
has been verified (see *Cache busting* below).

---


## Drafts (staging previews)

New apps land in `resources/drafts/` first for live testing before being
published in the hub.

**Two-PR workflow:**

```
PR 1 — draft
  resources/drafts/<app-name>/index.html  (not in hub, accessible by URL)
  Preview: https://cryoem-cnio.github.io/SBP-APPS/resources/drafts/<app-name>/

PR 2 — promote (once happy)
  resources/<app-name>/index.html         (moved out of drafts)
  APPS[] entry added to root index.html   (now visible in hub)
```

Apps in `resources/drafts/` are live on GitHub Pages but intentionally
unlisted — share the URL to test, nobody else will stumble on it.

## Adding an app

1. **Copy** the `template/` folder and rename it (lowercase, no spaces — e.g. `particle-picker/`).
2. **Edit** `template/index.html`:
   - Change `<title>`, the favicon letter/colour, `APP_ID`, `APP_TITLE`, and `BUILD`.
   - Write your app logic in the `<script>` block.
3. **Register** it in the root `index.html` — add a row to the `APPS` array:
   ```js
   { id:"particle-picker", name:"Particle Picker", desc:"Review and filter particles from a STAR file",
     path:"particle-picker/", icon:"◉", color:"#16A34A", live:true }
   ```
4. **Bump** the `?v=` cache-buster on the `<link>` and `<script>` tags that you changed.
5. **Open a PR** via the approval workflow above — do not push directly to `main`.

---

## Repository structure

```
SBP-APPS/
├── .nojekyll            ← prevents GitHub Pages from running Jekyll
├── index.html           ← hub: lists all apps; edit APPS[] to add entries
├── shared/
│   ├── style.css        ← design tokens + all component styles
│   └── utils.js         ← file reading, CSV parsing, DOM helpers
└── <app-name>/
    └── index.html       ← self-contained; loads its own data per session
```

Apps live in their own folder. Each one is a single `index.html` — add
subfolders or more files only if the app really needs them.

---

## Design system

Apps link to `../shared/style.css`. Useful classes:

| Class | What it does |
|---|---|
| `.wrap` | Centred content column, responsive |
| `.hdr` | Top header bar |
| `.card` | Content card with coloured left border |
| `.btn`, `.btn-p`, `.btn-danger` | Buttons |
| `.chip` | Small label; `.chip.good/.bad/.warn/.accent` for colour variants |
| `.tag` | Pill-shaped coloured label |
| `.tbl`, `.tbl-wrap` | Responsive table |
| `.dropzone` | Drag-and-drop file area |
| `.banner.good/.warn/.danger` | Full-width status banner |
| `.ebox` | Error message box |
| `.err` | Inline error text |
| `.load`, `.spin` | Loading indicator |
| `.overlay` + `.modal` | Overlay modal |
| `.cols` | Responsive multi-column grid |

All colours are CSS custom properties (`--accent`, `--danger`, etc.) defined
in `:root`. Light and dark mode are handled automatically via
`@media (prefers-color-scheme: dark)`.

---

## Shared utilities (`SBP.*`)

Load with `<script src="../shared/utils.js?v=…"></script>`.

```js
// File reading
const text = await SBP.readFile(file);            // File → string
const b64  = await SBP.readFileAsBase64(file);    // File → data URL

// Parsing
const rows = SBP.parseCSV(text);                  // → [{col: val}]
const rows = SBP.parseTSV(text);                  // TSV variant
const rows = SBP.parseCSV(text, {header:false});  // → [[val, val]]

// Downloads
SBP.downloadText("out.txt", text);
SBP.downloadCSV("results.csv", rows);

// Drop zone
SBP.dropzone(el, { accept:".csv", onFiles: files => handleFiles(files) });

// DOM
SBP.el("id")                 // getElementById
SBP.on(el, "click", fn)      // addEventListener

// localStorage (namespaced)
const store = SBP.storage("my-app:prefs");
store.set({ zoom: 1.5 });
store.get();   // → { zoom: 1.5 }
store.del();

// Misc
SBP.esc(str)    // HTML-escape a string
SBP.today()     // "YYYY-MM-DD"
SBP.fd("2026-09-16")  // → "16/09"
```

---

## Cache busting

GitHub Pages caches assets. After any change to `shared/style.css` or
`shared/utils.js`, bump the `?v=` query string on every `<link>` and `<script>`
tag that references them — typically `YYYYMMDD-HHMM`. The `BUILD` constant in
each app's `<script>` block serves as the displayed version in the footer.

After merging a PR, always fetch the live URL to confirm the new content
is actually being served before declaring the deploy done.

---

## Principles

- **No backend.** Apps are static HTML. Data loads from files or public URLs at runtime.
- **No credentials in the repo.** If an app needs a token, the user enters it and it stays in their browser (`localStorage`).
- **Nothing stored server-side.** A reload clears all session data (unless the app explicitly uses `SBP.storage`).
- **One file per app.** Keep apps self-contained in their `index.html`.
  Only add extra files if complexity genuinely demands it.
- **No direct pushes to `main`.** All changes go through a pull request (see *Approval workflow* above).

---

## License

MIT © 2026 Structural Biology Programme, CNIO — see [LICENSE](LICENSE) for the full text.
