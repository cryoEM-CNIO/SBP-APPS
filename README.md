# SBP Apps

Web tools for the Structural Biology Programme · CNIO.

Served at: **https://cryoem-cnio.github.io/SBP-APPS/**

---

## Approval workflow

**No one pushes directly to `main`.** The `main` branch is protected.
Every change — whether made by a collaborator or by Claude — must go
through a pull request that an admin reviews and merges.

Claude's steps for every change:

1. Get the current HEAD SHA of `main`.
2. Create a branch named `draft/YYYYMMDD-HHMM-<short-desc>`.
3. Push all changed files to that branch (never to `main`).
4. Open a pull request targeting `main` with a clear title and description.
5. Print the PR URL and stop — do **not** declare the deploy done.

A deploy is only live after an admin merges the PR **and** the served file
has been verified in the browser (see *Cache busting* below).

---

## App preview workflow

For any new app or modification to an existing app, Claude always previews
the result as an artifact in the chat **before** pushing anything to GitHub.
Only after explicit approval does it open a PR.

---

## Adding an app

1. Copy `resources/template/index.html` into `resources/<app-name>/index.html`.
2. Edit the title, favicon letter/colour, `APP_ID`, `APP_TITLE`, and `BUILD`.
3. Preview as an artifact in chat — get approval.
4. Open a PR that includes both the new app file and a new row in `APPS[]`
   in root `index.html`:
   ```js
   { id:"<app-name>", name:"…", desc:"…",
     path:"resources/<app-name>/", icon:"◆", color:"#2563EB", live:true }
   ```
5. Bump `?v=` on the shared-asset links in root `index.html` too.

---

## Modifying an existing app

1. Fetch `resources/<app-name>/index.html` from the repo.
2. Apply the change and preview as an artifact in chat — get approval.
3. Open a PR with the modified file.

---

## Repository structure

```
SBP-APPS/
├── .nojekyll                    ← prevents GitHub Pages from running Jekyll
├── index.html                   ← hub: lists all apps; edit APPS[] to add entries
└── resources/
    ├── shared/
    │   ├── style.css            ← design tokens + all component styles
    │   └── utils.js             ← file reading, CSV parsing, DOM helpers
    ├── template/
    │   └── index.html           ← starting point for new apps
    └── <app-name>/
        └── index.html           ← self-contained; loads its own data per session
```

Shared assets use root-relative paths so they work from any depth:

    /SBP-APPS/resources/shared/style.css
    /SBP-APPS/resources/shared/utils.js

---

## Design system

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

```js
// File reading
const text = await SBP.readFile(file);            // File → string
const b64  = await SBP.readFileAsBase64(file);    // File → data URL

// Parsing
const rows = SBP.parseCSV(text);                  // → [{col: val}]
const rows = SBP.parseTSV(text);                  // TSV variant

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
SBP.esc(str)              // HTML-escape a string
SBP.today()               // "YYYY-MM-DD"
SBP.fd("2026-09-16")      // → "16/09"
```

---

## Cache busting

GitHub Pages caches assets. After any change to `shared/style.css` or
`shared/utils.js`, bump the `?v=` query string on every `<link>` and `<script>`
tag that references them — format `YYYYMMDD-HHMM`. The `BUILD` constant in
each app's `<script>` block serves as the displayed version in the footer.

After merging a PR, an admin must confirm the live URL in the browser before
the deploy is considered done.

---

## Principles

- **No backend.** Apps are static HTML. Data loads from files or public URLs at runtime.
- **No credentials in the repo.** The repo is public — anything committed is public.
- **Nothing stored server-side.** A reload clears all session data (unless the app explicitly uses `SBP.storage`).
- **One file per app.** Keep apps self-contained in their `index.html`.
- **No direct pushes to `main`.** All changes go through a pull request.
- **Artifact preview before push.** Apps are always previewed in the chat and approved before anything is pushed to GitHub.

---

## License

MIT © 2026 Structural Biology Programme, CNIO — see [LICENSE](LICENSE) for the full text.
