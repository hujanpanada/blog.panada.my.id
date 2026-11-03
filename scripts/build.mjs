#!/usr/bin/env node
// Static blog builder: contents/*.md -> public/
// Writing guide: docs/how-to.md
//
// A post is any .md file in contents/ with frontmatter:
// ---
// title: Halo Dunia
// date: 2026-11-01        (YYYY-MM-DD, newest first)
// description: Ringkasan singkat buat index & meta description
// tags: [catatan, meta]
// draft: true             (optional — skipped & hidden)
// ---
//
// File names are free-form — name them anything. The public URL is NOT the
// file name: the build generates a short slug from the first two words of
// the frontmatter title plus a random 4-digit number:
//   title "Selamat Tinggal, Notion" -> /p/selamat-tinggal-4839
// The mapping is stored in contents/.slugs.json (auto-generated, committed)
// so a URL never changes between builds. You never have to edit it by hand;
// the build only adds an entry the first time it sees a post, and prunes
// entries whose file was deleted.
// Publishing happens simply by the file existing; there is no status field.
// Drafts are just files with `draft: true`, skipped entirely.
//
// Images go in contents/images/* and are copied to public/images/*,
// so reference them as /images/nama-file.png from markdown.
// Referenced images that don't exist fail the build on purpose:
// a typo'd path should break locally, not as a 404 in production.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { Marked } from "marked";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const CONTENTS = path.join(root, "contents");
const IMAGES_SRC = path.join(CONTENTS, "images");
const PUBLIC = path.join(root, "public");
const SITE = {
  title: "Panada & Pukis",
  tagline: "sometimes grounded thoughts",
  description: "Panada & Pukis — sometimes grounded thoughts.",
};

// Slug map: file name -> public slug. Generated once per post, then kept
// stable. See the header comment for the format. This file IS committed.
const SLUG_MAP_PATH = path.join(CONTENTS, ".slugs.json");

// Google Fonts: Newsreader (serif/editorial), Inter (UI), JetBrains Mono
// (metadata & code). display=swap avoids invisible text; if fonts fail,
// system serif/sans/mono fallbacks take over silently.
const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400&display=swap" rel="stylesheet" />`;

// Inline script in <head>: apply the saved/system theme BEFORE first paint
// so there is no light/dark flash. Default follows the OS preference until
// the visitor picks a side; the choice is stored in localStorage.
const THEME_INIT = `<script>
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || (!saved && matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    }
  } catch {}
</script>`;

// Header theme toggle (every page): switch .dark on <html>, persist the
// choice. Crisp SVG icons swap smoothly with CSS dark: variant;
// the button carries an aria-label and visually-hidden text.
const THEME_TOGGLE = `<button type="button" data-theme-toggle aria-label="Aktifkan mode gelap" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-mist-dim transition-colors hover:bg-mist/10 hover:text-deep focus-visible:outline-2 focus-visible:outline-periwinkle dark:text-mist dark:hover:bg-night-soft dark:hover:text-paper-soft" title="Ganti mode tampilan">
  <svg data-theme-icon-sun class="hidden h-4 w-4 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2"></path>
    <path d="M12 20v2"></path>
    <path d="m4.93 4.93 1.41 1.41"></path>
    <path d="m17.66 17.66 1.41 1.41"></path>
    <path d="M2 12h2"></path>
    <path d="M20 12h2"></path>
    <path d="m6.34 17.66-1.41 1.41"></path>
    <path d="m19.07 4.93-1.41 1.41"></path>
  </svg>
  <svg data-theme-icon-moon class="block h-4 w-4 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
  </svg>
  <span class="sr-only" data-theme-text>Aktifkan mode gelap</span>
</button>`;

const THEME_SCRIPT = `<script>
(() => {
  const btn = document.querySelector("[data-theme-toggle]");
  if (!btn) return;
  const text = btn.querySelector("[data-theme-text]");
  const sync = () => {
    const dark = document.documentElement.classList.contains("dark");
    const label = dark ? "Aktifkan mode terang" : "Aktifkan mode gelap";
    btn.setAttribute("aria-label", label);
    if (text) text.textContent = label;
  };
  sync();
  btn.addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
    sync();
  });
})();
</script>`;

// Tiny inline script (article pages only): highlight the outline entry for
// the section currently in view. Progressive enhancement — without JS the
// outline is just a plain list of anchor links. ~0.6 KB, no dependencies.
const OUTLINE_SCRIPT = `<script>
(() => {
  const links = [...document.querySelectorAll("[data-outline-link]")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
  const setActive = (id) => {
    for (const a of links) {
      const active = a.hash === "#" + id;
      a.classList.toggle("outline-active", active);
      if (active) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
    const first = [...byId.keys()].find((id) => visible.has(id));
    if (first) setActive(first);
  }, { rootMargin: "-80px 0px -65% 0px" });
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
})();
</script>`;

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const fmtDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") || "section";

const readingStats = (raw) => {
  const text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#>*`_~\[\]()|-]/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.ceil(words / 200)) };
};

const tagPills = (tags) =>
  `<div class="flex flex-wrap gap-1.5">${tags
    .map(
      (t) =>
        `<span class="inline-flex items-center rounded bg-periwinkle/15 px-2 py-0.5 font-mono text-[11px] font-medium text-deep-light dark:bg-periwinkle/10 dark:text-periwinkle">${esc(
          t,
        )}</span>`,
    )
    .join("")}</div>`;

function layout({ title, description, body, isPost = false, hasOutline = false }) {
  const pageTitle = isPost ? `${title} · ${SITE.title}` : SITE.title;
  const containerClass = hasOutline ? "max-w-5xl" : "max-w-2xl";
  const mainClass = hasOutline
    ? "mx-auto max-w-5xl px-6 py-12 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14"
    : "mx-auto max-w-2xl px-6 py-12";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}" />
${THEME_INIT}
${FONT_LINK}
<link rel="stylesheet" href="/styles.css" />
</head>
<body class="min-h-screen flex flex-col justify-between">
<div>
  <header class="border-b border-mist/20 dark:border-night-soft">
    <div class="mx-auto flex ${containerClass} items-center justify-between px-6 py-5">
      <a href="/" class="font-serif text-lg font-medium tracking-tight text-deep transition-colors hover:text-deep-light dark:text-paper-soft dark:hover:text-periwinkle">${esc(SITE.title)}</a>
      <nav class="flex items-center gap-4">
        <a href="/" class="font-sans text-xs font-medium tracking-wide text-mist-dim transition-colors hover:text-deep dark:text-mist dark:hover:text-paper-soft">Tulisan</a>
        ${THEME_TOGGLE}
      </nav>
    </div>
  </header>
  <main class="${mainClass}">
${body}
  </main>
</div>
<footer class="border-t border-mist/20 dark:border-night-soft">
  <div class="mx-auto flex ${containerClass} flex-col sm:flex-row items-center justify-between gap-3 px-6 py-8 text-xs text-mist dark:text-mist/80">
    <p class="font-serif italic text-deep-muted/90 dark:text-silver/70">${esc(SITE.title)} — ${esc(SITE.tagline)}</p>
    <p class="font-mono">© ${new Date().getFullYear()}</p>
  </div>
</footer>
${THEME_SCRIPT}
${hasOutline ? OUTLINE_SCRIPT : ""}
</body>
</html>
`;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// ---------- read posts ----------
if (!fs.existsSync(CONTENTS)) fail(`Folder ${CONTENTS} tidak ada.`);
const availableImages = fs.existsSync(IMAGES_SRC)
  ? new Set(fs.readdirSync(IMAGES_SRC).filter((f) => !f.startsWith(".")))
  : new Set();

// Slugs are generated from the post title (first two words + random 4
// digits) and persisted in contents/.slugs.json, keyed by file name. The
// file is fully managed by the build: it is only (re)written when a new
// post appears or one is deleted, never touched otherwise, so normal
// builds leave git clean. A URL is therefore stable forever, even if the
// title is edited later — the map wins.
function loadSlugMap() {
  try {
    return JSON.parse(fs.readFileSync(SLUG_MAP_PATH, "utf8"));
  } catch {
    return {};
  }
}
const slugMap = loadSlugMap();
let slugMapDirty = false;

function slugFor(file, title) {
  if (slugMap[file]) return slugMap[file];
  const words = slugify(title).split("-").filter(Boolean).slice(0, 2);
  const base = words.length ? words.join("-") : "post";
  let slug;
  do {
    slug = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (Object.values(slugMap).includes(slug));
  slugMap[file] = slug;
  slugMapDirty = true;
  console.log(`  ↪ slug baru: ${file} → /p/${slug}`);
  return slug;
}

const posts = [];
for (const file of fs.readdirSync(CONTENTS).filter((f) => f.endsWith(".md"))) {
  const { data, content } = matter(fs.readFileSync(path.join(CONTENTS, file), "utf8"));

  // Fresh Marked instance per post so the image renderer closure can fail
  // with the right filename, and overrides don't stack on a shared singleton.
  // heading() also collects the outline (PRD: sticky TOC from H2/H3).
  const outline = [];
  const usedIds = new Set();
  const parser = new Marked();
  parser.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        if (depth !== 2 && depth !== 3) return `<h${depth}>${inner}</h${depth}>`;
        const plain = text.replace(/<[^>]+>/g, "").trim();
        let id = slugify(plain);
        if (usedIds.has(id)) {
          let n = 2;
          while (usedIds.has(`${id}-${n}`)) n++;
          id = `${id}-${n}`;
        }
        usedIds.add(id);
        outline.push({ depth, id, text: plain });
        return `<h${depth} id="${id}">${inner}</h${depth}>`;
      },
      image({ href, title, text }) {
        const alt = esc(text);
        const caption = title && title !== text ? title : null;
        let src = href;
        if (src.startsWith("./images/") || src.startsWith("images/")) {
          src = "/images/" + src.replace(/^\.?\/?images\//, "");
        }
        if (src.startsWith("/images/")) {
          const name = decodeURIComponent(src.slice("/images/".length));
          if (!availableImages.has(name)) {
            fail(`${file}: gambar tidak ditemukan: ${src} (cek contents/images/)`);
          }
        }
        const img = `<img src="${esc(src)}" alt="${alt}" loading="lazy" class="rounded-xl" />`;
        return caption
          ? `<figure>${img}<figcaption class="text-center">${esc(caption)}</figcaption></figure>`
          : img;
      },
    },
  });
  const html = parser.parse(content);

  if (data.draft) continue;
  for (const field of ["title", "date"]) {
    if (!data[field]) fail(`${file}: frontmatter "${field}" wajib diisi.`);
  }
  const slug = slugFor(file, String(data.title));
  posts.push({
    slug,
    title: String(data.title),
    date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date),
    description: String(data.description ?? ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    html,
    outline,
    raw: content.trim(),
    words: readingStats(content).words,
    minutes: readingStats(content).minutes,
  });
}
posts.sort((a, b) => b.date.localeCompare(a.date));

// ---------- clean generated output ----------
// Everything under public/ is generated by this build.
for (const name of ["index.html", "404.html", "styles.css"]) {
  try {
    fs.rmSync(path.join(PUBLIC, name), { force: true });
  } catch {}
}
for (const dir of ["p", "posts", "images", "favicon"]) {
  try {
    fs.rmSync(path.join(PUBLIC, dir), { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(path.join(PUBLIC, dir), { recursive: true });
}

// ---------- index ----------
const cards = posts
  .map(
    (p) => `    <article class="group relative py-7 first:pt-2 last:pb-2">
      <div class="flex items-center gap-2 font-mono text-xs text-mist-dim dark:text-mist">
        <time datetime="${p.date}">${fmtDate(p.date)}</time>
        <span aria-hidden="true" class="text-mist/40 dark:text-mist/30">·</span>
        <span>${p.minutes} mnt baca</span>
      </div>
      <h2 class="mt-2 font-serif text-2xl font-medium tracking-tight text-deep transition-colors duration-150 group-hover:text-deep-light dark:text-paper-soft dark:group-hover:text-periwinkle">
        <a href="/p/${p.slug}">
          <span class="absolute -inset-x-3 -inset-y-2 rounded-lg transition-colors group-hover:bg-mist/5 dark:group-hover:bg-night-soft/40 sm:-inset-x-4"></span>
          <span class="relative">${esc(p.title)}</span>
        </a>
      </h2>
      ${p.description ? `<p class="relative mt-2 font-sans text-sm leading-relaxed text-deep-muted dark:text-silver/80">${esc(p.description)}</p>` : ""}
      ${p.tags.length ? `<div class="relative mt-3">${tagPills(p.tags)}</div>` : ""}
    </article>`,
  )
  .join("\n");

fs.writeFileSync(
  path.join(PUBLIC, "index.html"),
  layout({
    title: SITE.title,
    description: SITE.description,
    body: `  <section class="pb-10 pt-2">
    <h1 class="font-serif text-3xl font-medium tracking-tight text-deep sm:text-4xl dark:text-paper-soft">
      ${esc(SITE.title)}
    </h1>
    <p class="mt-2 font-serif text-lg leading-relaxed text-deep-muted italic dark:text-silver/80">
      ${esc(SITE.tagline)}
    </p>
  </section>
  <section>
    <div class="mb-2 flex items-center justify-between border-b border-mist/20 pb-3 dark:border-night-soft">
      <span class="font-mono text-xs font-medium tracking-wide text-mist-dim dark:text-mist">Semua tulisan</span>
      <span class="font-mono text-xs text-mist-dim/80 dark:text-mist/70">${posts.length} catatan</span>
    </div>
    <div class="divide-y divide-mist/15 dark:divide-night-soft">
${cards || '      <p class="py-8 text-sm text-deep-muted dark:text-silver/80">Belum ada tulisan. Tambah file <code>.md</code> di folder <code>contents/</code> buat mulai.</p>'}
    </div>
  </section>`,
  }),
);

// ---------- post pages ----------
for (const p of posts) {
  const hasOutline = p.outline.length > 0;
  const outlineNav = hasOutline
    ? `<nav aria-label="Daftar isi artikel" class="mt-6 border-l border-mist/20 pl-3 dark:border-night-soft">
        <p class="font-mono text-xs font-medium tracking-wider text-mist-dim uppercase dark:text-mist">Daftar Isi</p>
        <ul class="mt-3 space-y-1 text-xs">
${p.outline.map((o) => `          <li><a data-outline-link href="#${o.id}" class="outline-link block py-1 pr-2 text-deep-muted transition-colors hover:text-deep dark:text-silver/75 dark:hover:text-paper-soft ${o.depth === 3 ? "pl-3" : ""}">${esc(o.text)}</a></li>`).join("\n")}
        </ul>
      </nav>`
    : "";

  const rail = hasOutline
    ? `<aside class="mb-10 lg:sticky lg:top-20 lg:mb-0 lg:self-start">
    <a href="/" class="group inline-flex items-center gap-1.5 font-mono text-xs font-medium text-deep-light transition-colors hover:text-deep dark:text-periwinkle dark:hover:text-paper-soft">
      <span aria-hidden="true" class="transition-transform group-hover:-translate-x-0.5">←</span>
      <span>Semua tulisan</span>
    </a>
    <div class="mt-6 hidden lg:block">
      ${outlineNav}
    </div>
    <details class="mt-6 lg:hidden">
      <summary class="cursor-pointer font-mono text-xs font-medium text-mist-dim dark:text-mist">Daftar isi artikel</summary>
      ${outlineNav}
    </details>
  </aside>`
    : `<div class="mb-8">
    <a href="/" class="group inline-flex items-center gap-1.5 font-mono text-xs font-medium text-deep-light transition-colors hover:text-deep dark:text-periwinkle dark:hover:text-paper-soft">
      <span aria-hidden="true" class="transition-transform group-hover:-translate-x-0.5">←</span>
      <span>Semua tulisan</span>
    </a>
  </div>`;

  fs.writeFileSync(
    path.join(PUBLIC, "p", p.slug + ".html"),
    layout({
      title: p.title,
      description: p.description || SITE.description,
      isPost: true,
      hasOutline,
      body: `${rail}
  <article>
    <header class="mb-10">
      <div class="flex flex-wrap items-center gap-2 font-mono text-xs text-mist-dim dark:text-mist">
        <time datetime="${p.date}">${fmtDate(p.date)}</time>
        <span aria-hidden="true" class="text-mist/40 dark:text-mist/30">·</span>
        <span>${p.minutes} mnt baca</span>
        <span aria-hidden="true" class="text-mist/40 dark:text-mist/30">·</span>
        <span>${p.words.toLocaleString("id-ID")} kata</span>
      </div>
      <h1 class="mt-3 font-serif text-3xl font-medium tracking-tight text-deep sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15] dark:text-paper-soft">${esc(p.title)}</h1>
      ${p.tags.length ? `<div class="mt-4">${tagPills(p.tags)}</div>` : ""}
      ${p.description ? `<p class="mt-6 border-l-2 border-periwinkle py-1 pl-4 font-serif text-lg leading-relaxed text-deep-muted italic dark:text-silver/85">${esc(p.description)}</p>` : ""}
    </header>
    <div class="article-prose prose max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-pre:rounded-xl prose-img:mx-auto prose-img:rounded-xl">
${p.html}
    </div>
    <footer class="mt-16 border-t border-mist/20 pt-8 dark:border-night-soft">
      <div class="flex items-center justify-between">
        <a href="/" class="group inline-flex items-center gap-1.5 font-mono text-xs font-medium text-deep-light transition-colors hover:text-deep dark:text-periwinkle dark:hover:text-paper-soft">
          <span aria-hidden="true" class="transition-transform group-hover:-translate-x-0.5">←</span>
          <span>Kembali ke beranda</span>
        </a>
        <span class="font-serif text-xs italic text-mist-dim dark:text-mist">${esc(SITE.title)}</span>
      </div>
    </footer>
  </article>`,
    }),
  );
}

// ---------- 404 ----------
fs.writeFileSync(
  path.join(PUBLIC, "404.html"),
  layout({
    title: "404",
    description: "Halaman tidak ditemukan",
    hasOutline: false,
    body: `  <div class="py-20 text-center">
    <p class="font-mono text-xs tracking-widest text-mist-dim uppercase dark:text-mist">404</p>
    <h1 class="mt-3 font-serif text-3xl sm:text-4xl font-medium tracking-tight text-deep dark:text-paper-soft">Halaman tidak ditemukan</h1>
    <p class="mt-3 text-sm leading-relaxed text-deep-muted dark:text-silver/80">Halaman yang kamu cari mungkin sudah berpindah atau belum ditulis.</p>
    <div class="mt-8">
      <a href="/" class="group inline-flex items-center gap-2 rounded-lg border border-mist/30 px-4 py-2 font-mono text-xs font-medium text-deep transition-colors hover:border-periwinkle hover:text-deep-light dark:border-night-soft dark:text-silver dark:hover:border-periwinkle dark:hover:text-paper-soft">
        <span aria-hidden="true" class="transition-transform group-hover:-translate-x-0.5">←</span>
        <span>Kembali ke beranda</span>
      </a>
    </div>
  </div>`,
  }),
);

// ---------- slug map ----------
// Prune entries whose file is gone, then persist only if changed.
for (const file of Object.keys(slugMap)) {
  if (!fs.existsSync(path.join(CONTENTS, file))) {
    delete slugMap[file];
    slugMapDirty = true;
  }
}
if (slugMapDirty) {
  fs.writeFileSync(SLUG_MAP_PATH, JSON.stringify(slugMap, null, 2) + "\n");
  console.log(`  ↪ contents/.slugs.json diperbarui`);
}

// ---------- images ----------
for (const name of availableImages) {
  fs.copyFileSync(path.join(IMAGES_SRC, name), path.join(PUBLIC, "images", name));
}

console.log(`✓ Build selesai: ${posts.length} post, ${availableImages.size} gambar → public/`);
