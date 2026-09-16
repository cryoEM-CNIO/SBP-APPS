/* ─────────────────────────────────────────────────────────────────────────────
   SBP.utils — lightweight helpers for all SBP Apps.

   Usage:
     <script src="../shared/utils.js?v=…"></script>
     const text = await SBP.readFile(file);
     const rows = SBP.parseCSV(text);

   Provides:
     SBP.esc(str)                       → HTML-escaped string
     SBP.today()                        → "YYYY-MM-DD"
     SBP.fd(isoDateStr)                 → "DD/MM"
     SBP.readFile(File)                 → Promise<string>
     SBP.readFileAsBase64(File)         → Promise<string>
     SBP.parseCSV(text, opts)           → array of objects (header=true) or arrays
     SBP.parseTSV(text, opts)           → same, tab-separated
     SBP.downloadText(filename, text)   → triggers a browser download
     SBP.downloadCSV(filename, rows)    → download rows as CSV
     SBP.el(id)                         → document.getElementById(id)
     SBP.make(tag, attrs, ...children)  → creates an element
     SBP.on(el, event, handler)         → addEventListener shorthand
     SBP.storage(key)                   → namespaced localStorage { get, set, del }
   ───────────────────────────────────────────────────────────────────────────── */
"use strict";

window.SBP = (function () {

  // ── String / date helpers ─────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function today() {
    const d = new Date();
    return d.getFullYear()
      + "-" + String(d.getMonth() + 1).padStart(2, "0")
      + "-" + String(d.getDate()).padStart(2, "0");
  }

  /** "YYYY-MM-DD" → "DD/MM" */
  function fd(d) {
    if (!d) return "";
    const p = String(d).slice(0, 10).split("-");
    return p[2] + "/" + p[1];
  }

  /** "HH:MM" from a Date */
  function hhmm(d) {
    return d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
  }

  // ── File reading ──────────────────────────────────────────────────────────

  /** Read a File object as UTF-8 text. Returns Promise<string>. */
  function readFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.onerror = () => rej(new Error("Could not read file: " + file.name));
      r.readAsText(file, "UTF-8");
    });
  }

  /** Read a File as a base64 data URL. Returns Promise<string>. */
  function readFileAsBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.onerror = () => rej(new Error("Could not read file: " + file.name));
      r.readAsDataURL(file);
    });
  }

  // ── CSV / TSV parsing ─────────────────────────────────────────────────────

  /**
   * Parse CSV text.
   * opts.header  (default true)  — first row is headers → returns [{col:val}]
   * opts.sep     (default ",")   — field separator
   * opts.trim    (default true)  — trim whitespace from values
   */
  function parseCSV(text, opts) {
    return _parseSep(text, Object.assign({ sep: "," }, opts));
  }

  /** Same as parseCSV but defaults to tab separator. */
  function parseTSV(text, opts) {
    return _parseSep(text, Object.assign({ sep: "\t" }, opts));
  }

  function _parseSep(text, { header = true, sep = ",", trim = true } = {}) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const rows = [];
    let headers = null;

    for (const raw of lines) {
      if (!raw.trim()) continue;
      const cells = _parseLine(raw, sep, trim);
      if (header && !headers) { headers = cells; continue; }
      if (header) {
        const o = {};
        headers.forEach((h, i) => { o[h] = cells[i] ?? ""; });
        rows.push(o);
      } else {
        rows.push(cells);
      }
    }
    return rows;
  }

  function _parseLine(line, sep, trim) {
    const cells = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        // handle escaped quotes ""
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (c === sep && !inQ) { cells.push(trim ? cur.trim() : cur); cur = ""; continue; }
      cur += c;
    }
    cells.push(trim ? cur.trim() : cur);
    return cells;
  }

  // ── Downloads ─────────────────────────────────────────────────────────────

  function downloadText(filename, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/plain;charset=utf-8" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /**
   * Download an array of objects (or arrays) as CSV.
   * If rows are objects, keys of the first row become the header.
   */
  function downloadCSV(filename, rows) {
    if (!rows.length) return;
    const isObj = !Array.isArray(rows[0]);
    const headers = isObj ? Object.keys(rows[0]) : null;
    const csv = (headers ? [headers.map(_csvCell).join(",") + "\n"] : [])
      .concat(rows.map(r => (isObj ? headers.map(h => r[h]) : r).map(_csvCell).join(",") + "\n"))
      .join("");
    downloadText(filename, csv, "text/csv;charset=utf-8");
  }

  function _csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  const el = id => document.getElementById(id);

  function make(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "style") Object.assign(node.style, v);
        else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function on(elOrId, event, handler) {
    const target = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
    if (target) target.addEventListener(event, handler);
    return target;
  }

  // ── Drop zone ─────────────────────────────────────────────────────────────

  /**
   * Attach drag-and-drop + click-to-browse to a .dropzone element.
   * opts.accept  — MIME types or extensions passed to <input type=file>
   * opts.multiple — allow multiple files (default false)
   * opts.onFiles(FileList) — called with the selected/dropped files
   */
  function dropzone(el, opts) {
    const { accept = "", multiple = false, onFiles } = opts || {};
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = accept; inp.multiple = multiple;
    inp.style.display = "none";
    el.appendChild(inp);

    el.addEventListener("click", () => inp.click());
    inp.addEventListener("change", () => onFiles && onFiles(inp.files));
    el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", e => {
      e.preventDefault(); el.classList.remove("over");
      if (onFiles) onFiles(e.dataTransfer.files);
    });
    return el;
  }

  // ── localStorage (namespaced) ─────────────────────────────────────────────

  /**
   * Returns a { get, set, del } object for a namespaced localStorage key.
   * Usage: const store = SBP.storage("my-app:state");
   *        store.set({foo:1}); store.get(); // {foo:1}
   */
  function storage(key) {
    return {
      get()      { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
      set(value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
      del()      { try { localStorage.removeItem(key); } catch {} }
    };
  }

  // ── Icon SVGs (inline, no external dependency) ────────────────────────────
  const ICON = {
    upload: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    refresh:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    check:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    x:        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    warn:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    back:     `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    load:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    ext:      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  };

  // ── Public API ────────────────────────────────────────────────────────────
  return { esc, today, fd, hhmm, readFile, readFileAsBase64,
           parseCSV, parseTSV, downloadText, downloadCSV,
           el, make, on, dropzone, storage, ICON };

})();
