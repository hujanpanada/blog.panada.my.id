# Cara Menulis di Blog Ini

Panduan lengkap menulis & menerbitkan tulisan di blog **Panada & Pukis**.
Semua tulisan adalah file Markdown biasa di folder `contents/` — tidak ada CMS, tidak ada database.

---

## 1. Ringkasan alur

1. Buat file baru di `contents/` — namanya bebas, misalnya `contents/ini-judul-suka-suka-gw.md`.
2. Isi frontmatter + tulis isinya pakai Markdown (lihat contoh di bawah).
3. Jalankan `npm run dev` buat preview, atau `npm run deploy` buat menerbitkan.

```bash
npm install     # sekali saja, di awal
npm run dev     # build + preview lokal (wrangler dev)
npm run deploy  # build + publish ke Cloudflare
```

---

## 2. Nama file bebas, URL dibuatkan otomatis (slug)

Nama file **tidak** menentukan URL. Kamu bebas menamai file suka-suka:

```
contents/ini-judul-suka-suka-gw.md
```

URL dibuatkan otomatis oleh build script dari **2 kata pertama `title`** di frontmatter + **4 angka acak**:

```
title: Selamat Tinggal, Notion   →   /p/selamat-tinggal-4839
title: Halo Dunia                →   /p/halo-dunia-1929
```

Pemetaan nama file → slug disimpan otomatis di `contents/.slugs.json` — **file ini dibuat & dirawat oleh build script, kamu tidak perlu mengisi atau mengeditnya**. File ini ikut ter-commit supaya URL **tidak berubah** antar-build dan antar-mesin — bahkan kalau `title` diedit belakangan. Build mencetak slug baru yang dibuatnya:

```
↪ slug baru: ini-judul-suka-suka-gw.md → /p/selamat-tinggal-4839
```

Catatan:

- Kamu cukup buat file `.md`-nya dan jalanin build; entri slug dibuatkan saat build pertama melihat file itu. File yang dihapus, entrinya ikut dibersihkan otomatis.
- Satu-satunya alasan menyentuh `.slugs.json` adalah kalau kamu **sengaja** mau mengganti URL sebuah tulisan (sunting nilainya, atau hapus entrinya supaya dibuatkan slug baru saat build berikutnya). Selain itu biarkan saja — isinya adalah URL permanen yang mungkin sudah tersebar.

---

## 3. Frontmatter

Setiap file diawali blok metadata di antara `---`:

```md
---
title: Halo Dunia
date: 2026-11-01
description: Ringkasan satu kalimat yang tampil di beranda.
tags: [catatan, meta]
---

Isi tulisan mulai di sini...
```

| Field         | Wajib? | Keterangan                                                                 |
| ------------- | ------ | -------------------------------------------------------------------------- |
| `title`       | Ya     | Judul tulisan.                                                             |
| `date`        | Ya     | Tanggal terbit, format `YYYY-MM-DD`. Urutan di beranda: terbaru di atas.   |
| `description` | Tidak  | Ringkasan 1 kalimat — tampil di beranda, meta description, & lead artikel. |
| `tags`        | Tidak  | Daftar label, tampil sebagai pill. Contoh: `tags: [catatan, meta]`.        |
| `draft`       | Tidak  | `draft: true` → tulisan dilewati total (tidak tampil di mana pun).         |

Tidak ada field status lain: tulisan terbit hanya karena filenya ada dan bukan draft.

---

## 4. Penulisan dasar

### Paragraf & penekanan

```md
Paragraf biasa dipisah baris kosong.

Ada **teks tebal**, *teks miring*, dan `kode sebaris`.
```

### Heading & outline (daftar isi)

```md
## Judul bagian
### Sub-bagian
```

Heading `##` dan `###` otomatis dikumpulkan jadi **Outline** di sidebar kiri halaman artikel (sticky di desktop, bisa dilipat di mobile, dan item aktif mengikuti posisi scroll). Karena outline dibuat dari heading, pakai heading secara berurutan: judul artikel sudah `H1`, jadi isi mulai dari `##`.

### Tautan

```md
[Teks tautan](https://example.com)
```

### Daftar

```md
- Poin pertama
- Poin kedua

1. Langkah satu
2. Langkah dua
```

### Kutipan

```md
> Kutipan tampil dengan garis aksen di kiri.
```

### Kode

Kode sebaris pakai backtick: `` `npm run build` ``. Blok kode pakai tiga backtick + nama bahasa:

````md
```js
const halo = "dunia";
console.log(halo);
```
````

### Tabel

```md
| Kolom A | Kolom B |
| :------ | :------ |
| Isi 1   | Isi 2   |
```

### Garis pemisah

```md
---
```

---

## 5. Gambar

1. Taruh file gambar di `contents/images/`, misalnya `contents/images/foto-pantai.jpg`.
2. Panggil dari Markdown:

```md
![Teks alternatif yang mendeskripsikan gambar](/images/foto-pantai.jpg)
```

Judul pada gambar menjadi caption di bawahnya:

```md
![Foto pantai](/images/foto-pantai.jpg "Senja di pantai, Oktober 2026")
```

Catatan:

- Gambar boleh juga dirujuk relatif: `./images/foto-pantai.jpg` — hasilnya sama.
- Build **sengaja gagal** kalau gambar yang dirujuk tidak ada di `contents/images/`. Ini disengaja: salah ketik nama file ketahuan saat build, bukan jadi gambar rusak setelah terbit.
- Gambar di-serve dari `/images/<nama-file>`.

---

## 6. Contoh post utuh

```md
---
title: Halo Dunia
date: 2026-11-01
description: Tulisan pertama, ditulis pakai Markdown.
tags: [catatan]
---

Paragraf pembuka tulisan.

## Bagian pertama

Isi bagian pertama, dengan [tautan](https://example.com) dan **penekanan**.

> Sebuah kutipan yang relevan.

![Foto pendukung](/images/foto-pantai.jpg "Caption foto")

## Penutup

Paragraf penutup.
```

Simpan dengan nama file bebas, misalnya `contents/halo-dunia-versi-gw.md`. Dari judul "Halo Dunia", tulisan ini terbit di URL `/p/halo-dunia-XXXX` (4 angka acak dibuatkan saat build pertama).

---

## 7. Perintah-perintah

| Perintah         | Fungsi                                        |
| ---------------- | --------------------------------------------- |
| `npm install`    | Install dependensi (sekali saja).             |
| `npm run build`  | Build saja: `contents/*.md` → `public/`.      |
| `npm run dev`    | Build + preview lokal pakai Wrangler.         |
| `npm run deploy` | Build + publish ke Cloudflare.                |

Hasil build masuk ke `public/` (`index.html`, `p/<slug>.html`, `images/`, `404.html`, `styles.css`) dan sudah di-`.gitignore` — jangan edit file di sana manual, selalu edit sumbernya di `contents/`, `scripts/build.mjs`, atau `src/styles.css`.

Nama blog & tagline diatur di konstanta `SITE` di `scripts/build.mjs`.

---

## 8. Kalau build gagal

Pesan error sengaja dibuat jelas, contoh:

- `↪ slug baru: nama-file.md → /p/xxx-0000` — bukan error, tulisan baru saja dibuatkan URL-nya (§2).
- `halo.md: gambar tidak ditemukan: /images/xyz.png (cek contents/images/)` — gambar yang dirujuk tidak ada; perbaiki nama file gambar atau rujukannya (§5).
- `halo.md: frontmatter "title" wajib diisi.` — field wajib di frontmatter belum diisi (§3).
