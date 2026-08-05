# Arsitektur Keuangan Pesona SuperApp

**Status:** Draf untuk persetujuan — memuat pertanyaan terbuka untuk penasihat hukum dan pajak
**Tanggal:** 3 Agustus 2026
**Penyusun:** Ulpermadi Ibrahim
**Dokumen induk:** [`ARSITEKTUR-PESONA-SUPERAPP.md`](ARSITEKTUR-PESONA-SUPERAPP.md)

> Dokumen ini menuangkan hasil pembahasan 2–3 Agustus 2026. Ia memuat rancangan yang **belum tervalidasi secara hukum**. Bagian §13 berisi pertanyaan yang harus dijawab penasihat profesional sebelum modul Payment dan Escrow dikunci.

---

## 1. Ringkasan keputusan

| # | Keputusan | Pilihan |
|---|---|---|
| K-01 | Badan penyelenggara | Koperasi, bertindak sebagai **agen** (bukan prinsipal) |
| K-02 | Keanggotaan konsumen | **Pilihan** — bisa memakai layanan tanpa jadi anggota |
| K-03 | Keanggotaan mitra | **Wajib**, rampung sebelum pencairan pertama |
| K-04 | Instrumen pembayaran konsumen | **QRIS dinamis atas nama Pesona** |
| K-05 | Dompet konsumen non-anggota | **Tidak ada** — bayar per transaksi |
| K-06 | Dompet mitra | **Simpanan sukarela** anggota koperasi |
| K-07 | Struktur rekening | **Tiga rekening bank terpisah** |
| K-08 | Penyapuan komisi | **Batch akhir hari**, bukan per transaksi |
| K-09 | Akuisitor QRIS | **Dapat dicolok-lepas** — PG atau bank langsung |
| K-10 | Akses manusia ke rekening escrow | **Tidak ada** — hanya endpoint terprogram |

---

## 2. Model peran dan keanggotaan

Berbeda dari Garuda yang berjenjang (anggota dulu, baru boleh jadi mitra), Pesona memakai model **sejajar**.

| Peran | Keanggotaan | Dompet | Cara membayar / dibayar |
|---|---|---|---|
| Konsumen non-anggota | Tidak | Tidak ada | Bayar per transaksi via QRIS |
| Konsumen anggota | Ya, sukarela | Simpanan sukarela | Bayar dari saldo atau QRIS |
| Driver | **Wajib** | Simpanan sukarela | Dibayar ke simpanan, tarik ke rekening sendiri |
| Merchant | **Wajib** | Simpanan sukarela | Sama |

**Titik wajib keanggotaan mitra digeser**: pendaftaran dan verifikasi dulu, boleh mulai bekerja, keanggotaan rampung **sebelum pencairan pertama**. Uang tidak bergerak sebelum status hukum jelas, tetapi friksi tidak diletakkan di layar pertama tempat akuisisi supply paling rapuh.

---

## 3. Struktur rekening

Tiga rekening bank terpisah. Pemisahan ini bukan kerapian pembukuan — ia yang menopang argumen hukumnya.

| Rekening | Isi | Akses manusia | QRIS menempel |
|---|---|---|---|
| **R1 — Kolekting/Escrow** | Dana konsumen masuk, dana tertahan, simpanan anggota, komisi belum disapu | **Tidak ada** | **Ya** |
| **R2 — Cash Pool** | Modal buffer untuk menalangi selisih waktu setelmen | Terbatas, terprogram | Tidak |
| **R3 — Operasional** | Kas usaha Pesona setelah komisi disapu | Normal | Tidak |

### Kenapa harus terpisah

Kalau modal buffer Pesona duduk di rekening yang sama dengan dana anggota:

- Perlindungan atas dana anggota kabur bila Pesona punya sengketa atau tagihan kreditur
- Rekonsiliasi jadi ambigu — saldo itu milik anggota atau milik Pesona
- Klaim "mitra dibayar dari kas Pesona sendiri" hanya jadi ayat jurnal, bukan bukti

Dengan rekening terpisah, transfer R2 → R1 meninggalkan **jejak mutasi bank yang nyata**. Itu bukti yang bisa ditunjukkan, bukan argumen yang harus dipercaya.

### Kontrol pada R1

1. Tidak ada admin, pengurus, atau staf yang berhak bertransaksi terhadap R1
2. Hanya dua jalur masuk: setelmen QRIS, dan topup anggota via VA
3. Hanya tiga jalur keluar:
   - Penarikan anggota → **hanya ke rekening atas nama anggota sendiri**, dicocokkan dengan KYC
   - Refund → **hanya ke sumber pembayaran asal**, tidak pernah ke rekening lain
   - Penyapuan komisi EOD → ke R3, hanya bila invariant rekonsiliasi nol
4. Seluruh mutasi lewat endpoint terprogram yang teruji, tercatat, dan tidak dapat dilewati

---

## 4. Alur dana

### 4.1 Alur normal — order selesai

```
1. Konsumen menekan bayar
   └─> QRIS dinamis Pesona terbit (masa berlaku 10–15 menit)
   └─> Deeplink membuka aplikasi pembayaran konsumen

2. Konsumen membayar
   └─> Dana masuk R1, DIPOTONG MDR oleh akuisitor
   └─> Dibukukan sebagai DANA TERTAHAN, buku pembantu per nomor order
   └─> JRN-P01

3. Order di-dispatch, driver menjemput, mengantar

4. Driver tap sampai
   └─> Dana Tertahan dipecah: simpanan driver + komisi terutang
   └─> JRN-P02

5. Akhir hari
   └─> Rekonsiliasi mengunci → komisi disapu R1 ke R3
   └─> JRN-P05, JRN-P06

6. Driver menarik kapan saja
   └─> R1 ke rekening pribadi driver, nama wajib cocok KYC
   └─> JRN-P08
```

**Pembayaran mendahului dispatch.** Ini bukan pilihan — QRIS dinamis dan deeplink kedaluwarsa dalam 10–15 menit. Kalau pembayaran diletakkan setelah driver ditemukan, QR bisa mati saat menunggu driver menerima order.

### 4.2 Peran Cash Pool (R2)

R2 hanya dibutuhkan bila **setelmen akuisitor tertunda**.

| Kecepatan setelmen | Kebutuhan R2 |
|---|---|
| Seketika / hari yang sama (bank langsung) | **Mendekati nol** |
| T+1 | ± 1× bagian mitra harian |
| T+2 (umum pada PG) | ± 2× bagian mitra harian |

Perkiraan pada T+2, bagian mitra 85%:

| GMV harian | Modal R2 |
|---|---|
| Rp 100 juta | ± Rp 170 juta |
| Rp 500 juta | ± Rp 850 juta |
| Rp 1 miliar | ± Rp 1,7 miliar |

Modal ini **mengendap dan tumbuh seiring pertumbuhan**. Karena itu kecepatan setelmen akuisitor bukan soal teknis semata — ia menentukan berapa miliar yang harus Anda parkir.

---

## 5. Bagan akun

| Kode | Nama | Jenis |
|---|---|---|
| 1-1101 | Bank R1 — Kolekting/Escrow | Aset |
| 1-1102 | Bank R2 — Cash Pool | Aset |
| 1-1103 | Bank R3 — Operasional | Aset |
| 2-2101 | Simpanan Sukarela Anggota | Liabilitas — buku pembantu per anggota |
| 2-2102 | Dana Tertahan — Order Berjalan | Liabilitas — buku pembantu per order |
| 2-2103 | Komisi Terutang (belum disapu) | Liabilitas |
| 2-2104 | Utang Refund | Liabilitas — buku pembantu per order |
| 2-2201 | PPN Keluaran | Liabilitas |
| 4-4101 | Pendapatan Komisi | Pendapatan |
| 4-4102 | Pendapatan Biaya Pembatalan | Pendapatan |
| 5-5101 | Beban MDR | Beban |
| 5-5102 | Beban Pencairan | Beban |

**Buku pembantu wajib.** Tanpa buku pembantu per order pada 2-2102, Anda tidak akan bisa menjawab pertanyaan pertama pemeriksa: *"dana Rp sekian di escrow ini milik siapa saja."*

---

## 6. Jurnal standar

Asumsi contoh: tarif Rp 50.000, komisi Pesona 15%, MDR 0,7%, PPN 11%.

> **Tarif PPN wajib dikonfirmasi ke konsultan pajak.** Angka 11% dipakai sebagai contoh, bukan sebagai acuan.

### Kunci yang membuat semuanya mengunci

Akuisitor menyetorkan **sudah dipotong MDR**. Kalau kewajiban dicatat sebesar nilai kotor, saldo bank akan selalu kurang dari total kewajiban dan rekonsiliasi tidak akan pernah nol.

Jalan keluarnya: **catat kewajiban sebesar yang benar-benar diterima**, dan biarkan MDR mengurangi komisi Pesona — bukan hak mitra.

- Diterima di R1: 50.000 − 350 = **49.650**
- Hak driver (85% dari tarif kotor): **42.500**
- Komisi Pesona setelah menyerap MDR: 7.500 − 350 = **7.150**

### JRN-P01 — Konsumen membayar

| | Debit | Kredit |
|---|---|---|
| 1-1101 Bank R1 | 49.650 | |
| 2-2102 Dana Tertahan — Order#123 | | 49.650 |

### JRN-P02 — Driver tap sampai

| | Debit | Kredit |
|---|---|---|
| 2-2102 Dana Tertahan — Order#123 | 49.650 | |
| 2-2101 Simpanan Sukarela — Driver A | | 42.500 |
| 2-2103 Komisi Terutang | | 7.150 |

### JRN-P03 — Order batal sebelum dispatch, refund penuh

| | Debit | Kredit |
|---|---|---|
| 2-2102 Dana Tertahan — Order#123 | 49.650 | |
| 2-2104 Utang Refund — Order#123 | | 49.650 |

Saat refund berhasil dieksekusi akuisitor:

| | Debit | Kredit |
|---|---|---|
| 2-2104 Utang Refund — Order#123 | 49.650 | |
| 1-1101 Bank R1 | | 49.650 |

**Catatan:** MDR umumnya tidak dikembalikan akuisitor. Selisih Rp 350 menjadi beban Pesona dan harus ditalangi dari R2 agar invariant tetap nol. Ini biaya nyata dari setiap pembatalan — masukkan ke perhitungan kebijakan pembatalan.

### JRN-P04 — Batal setelah driver berjalan, refund sebagian

Biaya pembatalan Rp 10.000, dibagi driver Rp 8.000 dan Pesona Rp 2.000.

| | Debit | Kredit |
|---|---|---|
| 2-2102 Dana Tertahan — Order#123 | 49.650 | |
| 2-2101 Simpanan Sukarela — Driver A | | 8.000 |
| 2-2103 Komisi Terutang — Order#123:cancellation | | 2.000 |
| 2-2104 Utang Refund — Order#123 | | 39.650 |

> **Koreksi 4 Agustus 2026.** Versi pertama dokumen ini mengkreditkan bagian Pesona langsung ke **4-4102 Pendapatan Biaya Pembatalan**. Itu keliru dan membuat invariant §7 timpang sebesar biaya tersebut.
>
> Sebabnya: uangnya masih berada di R1 sampai disapu pada akhir hari, tetapi 4-4102 adalah akun pendapatan yang tidak masuk sisi liabilitas invariant. Nilainya keluar dari perhitungan kewajiban sementara kasnya belum keluar dari bank — selisihnya persis sebesar biaya pembatalan.
>
> Perbaikannya mengikuti pola yang sudah benar di JRN-P02: bagian Pesona masuk **2-2103 Komisi Terutang**, dan pendapatan baru diakui di JRN-P06 setelah kas berpindah ke R3. Ditemukan lewat verifikasi aritmetika yang dijalankan terpisah dari kode.

### JRN-P05 — Penyapuan komisi akhir hari

Hanya boleh dijalankan **setelah invariant §7 terbukti nol**.

| | Debit | Kredit |
|---|---|---|
| 2-2103 Komisi Terutang | Σ hari itu | |
| 1-1101 Bank R1 | | Σ hari itu |

### JRN-P06 — Pengakuan di buku operasional

Atas contoh satu order, komisi Rp 7.150:

| | Debit | Kredit |
|---|---|---|
| 1-1103 Bank R3 | 7.150 | |
| 5-5101 Beban MDR | 350 | |
| 4-4101 Pendapatan Komisi | | 6.757 |
| 2-2201 PPN Keluaran | | 743 |

DPP = 100/111 × 7.500 = 6.757. PPN = 743. MDR diakui sebagai beban tersendiri agar terlihat di laporan laba rugi, bukan tersembunyi di dalam pendapatan neto.

**Opsi alternatif PPN** — dibebankan ke mitra, bukan diserap: komisi menjadi Rp 7.500 + PPN Rp 825 = Rp 8.325 dipotong dari hak driver. Pendapatan Pesona tetap bulat, PPN jelas titipan. Lebih bersih untuk pembukuan, lebih berat dijelaskan ke mitra. **Pilihan ini harus diputuskan bersama konsultan pajak sebelum jurnal pertama dibuat**, karena mengubahnya di belakang berarti membetulkan seluruh riwayat.

### JRN-P07 — Anggota topup simpanan via VA

| | Debit | Kredit |
|---|---|---|
| 1-1101 Bank R1 | Nominal | |
| 2-2101 Simpanan Sukarela — Anggota X | | Nominal |

### JRN-P08 — Anggota menarik simpanan

| | Debit | Kredit |
|---|---|---|
| 2-2101 Simpanan Sukarela — Anggota X | Nominal | |
| 1-1101 Bank R1 | | Nominal − biaya |
| 5-5102 Beban Pencairan | | biaya |

Kebijakan siapa menanggung biaya pencairan harus ditetapkan. Bila dibebankan ke anggota, potong dari nominal; bila diserap Pesona, talangi dari R2.

### JRN-P09 — Injeksi buffer dari Cash Pool

| | Debit | Kredit |
|---|---|---|
| 1-1101 Bank R1 | Nominal | |
| 1-1102 Bank R2 | | Nominal |

Dipakai untuk menalangi selisih setelmen dan menutup MDR atas transaksi yang di-refund.

---

## 7. Invariant rekonsiliasi

Satu persamaan yang harus benar setiap hari, tanpa toleransi:

```
Saldo Bank R1  =  Σ Simpanan Sukarela Anggota      (2-2101)
                + Σ Dana Tertahan Order Berjalan   (2-2102)
                + Komisi Terutang Belum Disapu     (2-2103)
                + Utang Refund Belum Dieksekusi    (2-2104)
```

**Ini gerbang, bukan laporan.**

| Kondisi | Tindakan sistem |
|---|---|
| Selisih = 0 | Penyapuan komisi boleh jalan |
| Selisih ≠ 0, berapa pun nilainya | **Bekukan penarikan**, hentikan penyapuan, panggil manusia |

Toleransi nol. Selisih satu rupiah pada sistem finansial bukan pembulatan — ia gejala cacat logika yang akan membesar.

Rekonsiliasi kedua yang juga wajib: **saldo bank menurut mutasi bank** dibandingkan **saldo bank menurut buku**. Perbedaan menunjukkan transaksi yang tidak tercatat, dan itu lebih berbahaya daripada selisih alokasi.

---

## 8. Jalur refund

### Mekanisme QRIS

QRIS dirancang agar merchant **tidak pernah menerima nomor akun pembayar**. Yang diterima hanya **nomor referensi transaksi** — RRN dan ID transaksi akuisitor.

Refund dilakukan dengan **refund by reference**: perintah dikirim ke akuisitor menyebut transaksi aslinya, akuisitor merutekan balik lewat jaringan QRIS ke penerbit, penerbit yang mengkredit saldo konsumen.

**Konsekuensi rancangan:** tidak perlu — dan tidak boleh — menyimpan identitas dompet konsumen. Cukup simpan nomor referensi, nominal, waktu, dan status.

### Kontrol

Refund tidak menembus aturan lingkaran tertutup R1:

1. Hanya kembali ke **sumber pembayaran asal**
2. **Tidak pernah** ke rekening atau instrumen lain
3. **Tidak pernah** melebihi nominal transaksi asli
4. Dieksekusi lewat endpoint terprogram, tercatat, dengan buku pembantu per order

### Yang harus divalidasi ke akuisitor

| Pertanyaan | Kenapa penting |
|---|---|
| API refund tersedia, atau manual lewat helpdesk? | Manual mustahil di volume ride-hailing |
| Mendukung refund sebagian? | Wajib untuk JRN-P04 |
| Berapa lama jendela refund? | Sebagian akuisitor membatasi H+7 atau H+30 |
| Berapa lama dana sampai ke konsumen? | Sering 1–7 hari kerja, bukan seketika |
| MDR dikembalikan saat refund? | Menentukan besaran talangan R2 |

Butir keempat berkonsekuensi produk: konsumen membatalkan, uang baru kembali beberapa hari kemudian. **Ini wajib ditampilkan di layar pembatalan**, bukan ditemukan sendiri oleh konsumen — inilah sumber sengketa yang paling mudah dicegah.

---

## 9. Disiplin batch dan EOD

Idempotency guard adalah syarat minimum, bukan pengaman lengkap.

| Kontrol | Alasan |
|---|---|
| **Registri eksekusi** — tiap jalannya batch punya ID, jendela waktu, status, jumlah baris | Tanpa ini tidak bisa dibuktikan batch tanggal tertentu pernah jalan dan berhasil |
| **Jangan retry buta pada status ambigu** — query status dulu, baru putuskan | Transfer yang timeout tidak berarti gagal. Mengulangi bisa berarti membayar dua kali. Idempotency key tidak menolong bila kuncinya dibuat ulang saat retry |
| **Rekonsiliasi mendahului penyapuan** | JRN-P05 hanya jalan bila invariant §7 nol |
| **Dead-letter yang ditagih** | Baris gagal tidak boleh lewat diam-diam; harus ada yang menagihnya keesokan hari |
| **Alarm ke manusia** | Selisih rekonsiliasi bukan untuk dicatat, tapi untuk membangunkan orang |

Garuda sudah memiliki mesin EOD, rekonsiliasi, dan `idem-potensi.ts`. Ini perluasan disiplin yang berjalan, bukan hal baru.

---

## 10. Modul 13 — Escrow & Settlement

Modul baru di luar dua belas modul dokumen induk. Ditempatkan di `core-api`.

| Tanggung jawab | |
|---|---|
| Menerbitkan QRIS dinamis dan menangkap notifikasi pembayaran | |
| Mengelola siklus Dana Tertahan per order — terbentuk, dialokasikan, di-refund | |
| Menjalankan alokasi saat order selesai (JRN-P02) | |
| Menjalankan jalur refund penuh dan sebagian (JRN-P03, JRN-P04) | |
| Menjalankan penyapuan komisi EOD, dengan gerbang rekonsiliasi (JRN-P05) | |
| Memelihara invariant §7 dan memicu pembekuan bila timpang | |
| Mengelola eksposur dan pengisian ulang R2 | |
| **Menyembunyikan akuisitor di balik antarmuka** — PG atau bank langsung dapat ditukar tanpa menyentuh modul lain | |

Butir terakhir bukan kemewahan arsitektur. Ia yang memungkinkan Anda meluncur dengan PG lalu berpindah ke bank langsung sebagai optimasi biaya — tanpa membedah modul Order, Dispatch, atau Identity.

**Modul 14 — Communication** (chat mitra-konsumen dan panggilan suara) tetap dicatat untuk Fase 2, belum dirinci.

---

## 11. Kontrol keamanan dana

| Kontrol | Status rancangan |
|---|---|
| Pemisahan dana anggota dari kas operasional | Tiga rekening, §3 |
| Nihil akses manusia ke R1 | Ditetapkan, §3 |
| Penarikan hanya ke rekening atas nama anggota | Ditetapkan — perlu API validasi nama rekening |
| Refund hanya ke sumber asal | Ditetapkan, §8 |
| Rekonsiliasi harian sebagai gerbang | Ditetapkan, §7 |
| Buku pembantu per order dan per anggota | Ditetapkan, §5 |

### Pencocokan nama rekening — lebih sulit daripada kelihatannya

Nama di rekening bank sering disingkat, nama tengah hilang, ejaan berbeda. Pencocokan persis akan menolak banyak anggota yang sah; pencocokan longgar membuka celah rekening penampung.

Rancangan yang disarankan:

1. Pakai **API validasi rekening** dari akuisitor yang mengembalikan nama pemilik dari bank
2. Tetapkan ambang kemiripan; di atas ambang lolos otomatis
3. Di bawah ambang masuk **jalur peninjauan manual**, dan peninjauan itu **wajib tercatat siapa yang menyetujui**
4. Rekening tujuan yang sudah tervalidasi dikunci; penggantian memerlukan verifikasi ulang

---

## 12. Yang belum dirancang dan harus diputuskan

| # | Hal | Kenapa mendesak |
|---|---|---|
| 1 | Anggota berhenti — pengembalian saldo simpanan | Garuda punya alur resignation; saldo harus punya jalur keluar yang pasti |
| 2 | Saldo mengendap lama / tidak terklaim | Kebijakan harus di AD/ART sejak awal, bukan saat masalahnya muncul |
| 3 | Apakah simpanan sukarela berimbal hasil | Menentukan sifat produk dan perpajakannya |
| 4 | Kebijakan penarikan — minimum, frekuensi, penanggung biaya | Memengaruhi margin dan eksposur R2 |
| 5 | Jeda sebelum saldo boleh ditarik | Memangkas risiko bila setelmen akuisitor bermasalah; berlawanan dengan kepentingan mitra |
| 6 | Kebijakan biaya pembatalan | Setiap pembatalan menyisakan MDR yang tidak kembali |

---

## 13. Pertanyaan untuk penasihat profesional

> Mintalah **pendapat hukum tertulis**, bukan konsultasi lisan. Bila kelak ada pemeriksaan, dokumen itu yang menunjukkan itikad baik.
>
> Cari penasihat yang menangani **koperasi dan fintech sekaligus** — bukan salah satu.

### Kepada penasihat hukum

1. Bolehkah koperasi bertindak sebagai **agen penagih** untuk anggotanya, dengan pembayar mayoritas non-anggota, pada volume jutaan transaksi?
2. Adakah batasan volume transaksi koperasi dengan non-anggota yang dilampaui oleh model ini?
3. Apakah menerbitkan QRIS atas nama koperasi untuk menagihkan jasa anggota memerlukan izin sebagai penyelenggara jasa pembayaran?
4. Apakah pencatatan penghasilan mitra sebagai simpanan sukarela sah bila kreditnya otomatis, berdasarkan persetujuan di perjanjian keanggotaan?
5. Apakah menahan dana milik konsumen non-anggota di R1 selama order berlangsung dapat dipersoalkan?
6. Rumusan apa yang harus dituangkan di AD/ART agar kegiatan ini berada dalam lingkup usaha koperasi?
7. Apakah keanggotaan yang dirampungkan sebelum pencairan pertama sudah memadai sebagai dasar hubungan kemitraan?

### Kepada konsultan pajak

8. Model **agen** atau **prinsipal** — mana yang tepat, dan apa konsekuensi PPN masing-masing?
9. PPN diserap dari komisi (JRN-P06) atau dibebankan ke mitra? **Harus diputuskan sebelum jurnal pertama.**
10. Kapan status PKP menjadi wajib, dan bagaimana transisinya? *Catatan: status non-PKP tidak akan bertahan pada sasaran 10 juta pengguna — rancang pembukuan seolah sudah PKP sejak awal.*
11. Perlakuan pajak atas simpanan sukarela dan atas SHU mitra.

### Argumen untuk dibawa ke konsultasi

| Mendukung | Mempersoalkan |
|---|---|
| Menghimpun dan menyalurkan hasil usaha anggota adalah fungsi klasik koperasi | Volume dan frekuensi jauh melampaui koperasi pemasaran konvensional |
| Koperasi pemasaran sudah lama menagihkan penjualan anggota kepada pembeli non-anggota | Pembayar mayoritas non-anggota, dapat dibaca sebagai usaha utama dengan non-anggota |
| Dana klien terpisah, tanpa akses manusia, penarikan terkunci ke rekening atas nama sendiri | Secara ekonomi menyerupai penyelenggara jasa pembayaran |
| Kontrol APU-PPT lebih ketat daripada banyak penyelenggara berizin | Ada batasan transaksi dengan non-anggota dalam hukum perkoperasian |

---

## 14. Lampiran — validasi ke bank atau akuisitor

Lima pertanyaan ini menentukan apakah jalur bank langsung layak, dan berapa modal kerja yang harus diparkir. **Minta bukti nyata dan sandbox, bukan brosur.**

| # | Pertanyaan | Konsekuensi bila jawabannya buruk |
|---|---|---|
| 1 | **Notifikasi real-time per transaksi QRIS** — webhook, atau hanya inquiry mutasi berkala? | Bila hanya berkala, jalur bank langsung **gugur** untuk ride-hailing. Konsumen tidak menunggu 15 menit untuk dispatch |
| 2 | Kecepatan setelmen ke rekening merchant | Menentukan modal R2: nol bila seketika, miliaran bila T+2 |
| 3 | Kapasitas penerbitan QRIS dinamis — berapa per detik, ada rate limit? | Jam sibuk membutuhkan ribuan per menit |
| 4 | Dukungan **deeplink** untuk pembayaran satu perangkat | Tanpa ini kembali ke "silakan scan QR" — buruk untuk checkout di HP |
| 5 | API refund, refund sebagian, jendela waktu | Lihat §8 |

Jawaban atas nomor 1 dan 2 menentukan arah, dan bisa didapat dalam hitungan hari — jauh sebelum modul Payment dikunci.

---

## Riwayat perubahan

| Tanggal | Perubahan |
|---|---|
| 3 Agustus 2026 | Draf pertama. Menuangkan pembahasan 2–3 Agustus: model peran sejajar, tiga rekening, alur dua fase, bagan jurnal JRN-P01–P09, invariant rekonsiliasi, jalur refund, disiplin batch, modul 13 |
| 5 Agustus 2026 | JRN-P01 (bayar), JRN-P02 (selesai), JRN-P03 (batal penuh), JRN-P04 (batal sebagian) diimplementasikan di `services/core-api/src/modules/escrow-settlement/` dan diverifikasi ke Postgres nyata (bukan cuma in-memory). `Ledger` sengaja dibuat interface async penuh (bukan `void \| Promise<void>`) supaya implementasi Postgres tidak bisa diam-diam lupa `await` dan kehilangan tulisan jurnal. JRN-P05–P09 (penyapuan komisi, EOD, simpanan) belum dikerjakan — menunggu modul Payout dan Identity. |
