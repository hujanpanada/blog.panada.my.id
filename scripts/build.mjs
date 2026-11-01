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
// choice. Sun/moon emoji swap with the mode; the button carries an
// aria-label (and visually-hidden text) naming the target mode, so the
// control stays understandable without relying on the glyph alone.
const THEME_TOGGLE = `<button type="button" data-theme-toggle aria-label="Aktifkan mode gelap" class="text-base leading-none decoration-periwinkle decoration-2 underline-offset-4 hover:underline"><span aria-hidden="true" data-theme-icon>☀️</span><span class="sr-only" data-theme-text>Aktifkan mode gelap</span></button>`;

const THEME_SCRIPT = `<script>
(() => {
  const btn = document.querySelector("[data-theme-toggle]");
  if (!btn) return;
  const icon = btn.querySelector("[data-theme-icon]");
  const text = btn.querySelector("[data-theme-text]");
  const sync = () => {
    const dark = document.documentElement.classList.contains("dark");
    // The emoji shows the CURRENT mode (sun = light, moon = dark), while
    // the accessible label still names the mode you switch TO on click.
    if (icon) icon.textContent = dark ? "🌙" : "☀️";
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
  }, { rootMargin: "-96px 0px -65% 0px" });
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
  `<p class="flex flex-wrap gap-2">${tags.map((t) => `<span class="rounded-full border border-periwinkle px-2.5 py-1 font-mono text-[11px] tracking-wide text-deep-light dark:text-periwinkle">${esc(t)}</span>`).join("")}</p>`;

function layout({ title, description, body, isPost = false, outline = null }) {
  const pageTitle = isPost ? `${title} · ${SITE.title}` : SITE.title;
  // On article pages the outline is a second column (Outline / Prose).
  // Everywhere else the single centred column is kept.
  const mainClass = outline
    ? "mx-auto max-w-6xl px-5 py-10 lg:grid lg:grid-cols-[16rem_minmax(0,44rem)] lg:justify-center lg:gap-12"
    : "mx-auto max-w-2xl px-5 py-10";
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
<body>
<header class="border-b border-mist/50 dark:border-deep-light/60">
  <div class="mx-auto flex ${outline ? "max-w-6xl" : "max-w-2xl"} items-center justify-between px-5 py-5">
    <a href="/" class="font-sans text-xl font-semibold tracking-tight text-deep decoration-periwinkle decoration-2 underline-offset-4 hover:underline dark:text-paper-soft">${esc(SITE.title)}</a>
    <nav class="flex items-center gap-5">
      <a href="/" class="font-sans text-sm font-bold tracking-widest text-deep uppercase decoration-periwinkle decoration-2 underline-offset-4 hover:underline dark:text-white">Blog</a>
      <span aria-hidden="true" class="text-mist">|</span>
      ${THEME_TOGGLE}
    </nav>
  </div>
</header>
<main class="${mainClass}">
${body}
</main>
<footer class="border-t border-mist/40 dark:border-deep-light/50">
  <div class="mx-auto flex ${outline ? "max-w-6xl" : "max-w-2xl"} flex-col items-center gap-1 px-5 py-8 text-center">
    <p class="font-serif text-base text-deep-muted dark:text-mist">${esc(SITE.title)} Blog</p>
    <p class="font-mono text-xs text-mist-dim dark:text-mist">© ${new Date().getFullYear()} ${esc(SITE.title)}</p>
  </div>
</footer>
${THEME_SCRIPT}
${outline ? OUTLINE_SCRIPT : ""}
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
  fs.rmSync(path.join(PUBLIC, name), { force: true });
}
for (const dir of ["p", "posts", "images", "favicon"]) {
  fs.rmSync(path.join(PUBLIC, dir), { recursive: true, force: true });
  fs.mkdirSync(path.join(PUBLIC, dir), { recursive: true });
}

// ---------- index ----------
const cards = posts
  .map(
    (p) => `  <article>
    <time datetime="${p.date}" class="font-mono text-xs tracking-wide text-mist-dim dark:text-mist">${p.date}</time>
    <h2 class="mt-3 font-serif text-3xl font-semibold tracking-tight text-deep dark:text-paper-soft">
      <a href="/p/${p.slug}" class="decoration-periwinkle decoration-2 underline-offset-4 hover:underline">${esc(p.title)}</a>
    </h2>
    ${p.description ? `<p class="mt-2 leading-relaxed text-deep-muted dark:text-silver/80">${esc(p.description)}</p>` : ""}
    <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      ${p.tags.length ? tagPills(p.tags) : ""}
      <span class="font-mono text-xs text-mist-dim dark:text-mist">${p.words.toLocaleString("id-ID")} kata · ${p.minutes} mnt baca</span>
    </div>
    <a href="/p/${p.slug}" class="mt-3 inline-block font-mono text-sm font-medium text-deep-light underline decoration-periwinkle decoration-2 underline-offset-4 hover:text-deep dark:text-periwinkle dark:hover:text-paper-soft">Baca tulisan <span aria-hidden="true">→</span></a>
  </article>`,
  )
  .join("\n  <hr class=\"my-10 border-mist/50 dark:border-deep-light/60\" />\n");

fs.writeFileSync(
  path.join(PUBLIC, "index.html"),
  layout({
    title: SITE.title,
    description: SITE.description,
    body: `  <h1 class="font-serif text-5xl font-semibold tracking-tight text-deep dark:text-paper-soft">Halo!</h1>
  <p class="mt-4 font-serif text-xl leading-relaxed text-deep-muted italic dark:text-silver/85">${esc(SITE.tagline)}</p>
  <div class="mt-14">
${cards || '  <p class="text-deep-muted dark:text-silver/80">Belum ada tulisan. Tambah file <code>.md</code> di folder <code>contents/</code> buat mulai.</p>'}
  </div>`,
  }),
);

// ---------- post pages ----------
for (const p of posts) {
  const outlineNav = p.outline.length
    ? `<nav aria-label="Daftar isi artikel" class="mt-8">
        <p class="font-mono text-xs font-medium tracking-widest text-mist-dim uppercase dark:text-mist">Outline</p>
        <ul class="mt-3 space-y-0.5 text-sm">
${p.outline.map((o) => `          <li><a data-outline-link href="#${o.id}" class="outline-link block py-1.5 pr-2 text-deep-muted transition-colors hover:text-deep dark:text-silver/75 dark:hover:text-paper-soft ${o.depth === 3 ? "pl-6" : "pl-3"}">${esc(o.text)}</a></li>`).join("\n")}
        </ul>
      </nav>`
    : "";
  const rail = `<aside class="mb-10 lg:sticky lg:top-24 lg:mb-0 lg:self-start">
    <a href="/" class="font-mono text-sm font-medium text-deep-light underline decoration-periwinkle decoration-2 underline-offset-4 hover:text-deep dark:text-periwinkle dark:hover:text-paper-soft"><span aria-hidden="true">←</span> Semua tulisan</a>
    <dl class="mt-8 space-y-3 font-mono text-[13px] lg:mt-10">
      <div><dt class="text-mist-dim dark:text-mist">Terbit</dt><dd class="mt-0.5 text-deep dark:text-paper-soft"><time datetime="${p.date}">${p.date} · ${fmtDate(p.date)}</time></dd></div>
      <div><dt class="text-mist-dim dark:text-mist">Jumlah kata</dt><dd class="mt-0.5 text-deep dark:text-paper-soft">${p.words.toLocaleString("id-ID")} kata</dd></div>
      <div><dt class="text-mist-dim dark:text-mist">Waktu baca</dt><dd class="mt-0.5 text-deep dark:text-paper-soft">${p.minutes} mnt · ~66–75 karakter/baris</dd></div>
    </dl>
    ${outlineNav ? `<details class="mt-10 lg:hidden"><summary class="cursor-pointer font-mono text-xs font-medium tracking-widest text-mist-dim uppercase dark:text-mist">Outline artikel</summary>${outlineNav}</details><div class="hidden lg:block">${outlineNav}</div>` : ""}
  </aside>`;
  fs.writeFileSync(
    path.join(PUBLIC, "p", p.slug + ".html"),
    layout({
      title: p.title,
      description: p.description || SITE.description,
      isPost: true,
      outline: p.outline,
      body: `${rail}
  <article>
    ${p.tags.length ? tagPills(p.tags) : ""}
    <h1 class="mt-4 font-serif text-4xl leading-tight font-semibold tracking-tight text-deep sm:text-5xl dark:text-paper-soft">${esc(p.title)}</h1>
    <p class="mt-3 font-mono text-[13px] text-mist-dim dark:text-mist"><time datetime="${p.date}">${fmtDate(p.date)}</time> · ${p.minutes} mnt baca</p>
    ${p.description ? `<p class="mt-5 border-l-2 border-periwinkle pl-4 font-serif text-xl leading-relaxed text-deep-muted italic dark:text-silver/85">${esc(p.description)}</p>` : ""}
    <div class="article-prose prose mt-10 max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-pre:rounded-xl prose-img:mx-auto prose-img:rounded-xl">
${p.html}
    </div>
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
    body: `  <div class="py-16 text-center">
    <p class="font-mono text-sm tracking-widest text-mist-dim uppercase dark:text-mist">Error 404</p>
    <h1 class="mt-4 font-serif text-4xl font-semibold tracking-tight text-deep dark:text-paper-soft">404 — Nyasar?</h1>
    <p class="mt-3 text-deep-muted dark:text-silver/80">Halaman yang kamu cari tidak ada (atau sudah dimakan).</p>
    <a href="/" class="mt-6 inline-block rounded-full bg-deep px-5 py-2.5 text-sm font-medium text-paper-soft hover:bg-deep-light dark:bg-periwinkle dark:text-ink dark:hover:bg-paper-soft"><span aria-hidden="true">←</span> Balik ke beranda</a>
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
