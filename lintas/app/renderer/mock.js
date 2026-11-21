// Preview mode: an in-memory implementation of the whole window.lintas contract (docs/IPC.md) with
// Indonesian–English sample data. Loaded only when the real preload has not defined window.lintas.
import { h } from './lib/dom.js';

const DAY = 864e5, HOUR = 36e5, now = Date.now();
const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
let uid = 100;
const id = (p) => `${p}-${++uid}`;
const words = (s) => (String(s).match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;

/* ------------------------------------------------------------------ sample content */
const GUIDE = [
  ['Panduan Pengguna Kasir Pintar', 'Kasir Pintar User Guide'],
  ['Selamat datang di Kasir Pintar, aplikasi kasir untuk usaha kecil dan menengah.', 'Welcome to Kasir Pintar, the point-of-sale app for small and medium-sized businesses.'],
  ['Panduan ini menjelaskan cara mencatat penjualan, mengelola stok, dan membuat laporan penjualan.', 'This guide explains how to record sales, manage stock, and create sales reports.'],
  ['Memulai', 'Getting started'],
  ['Unduh aplikasi dari toko aplikasi, lalu masuk dengan nomor ponsel Anda.', 'Download the app from the app store, then sign in with your mobile number.'],
  ['Masukkan kode OTP 6 digit yang dikirim melalui SMS.', 'Enter the 6-digit OTP code sent by SMS.'],
  ['Kode berlaku selama 5 menit.', 'The code is valid for 5 minutes.'],
  ['Menambahkan produk', 'Adding products'],
  ['Ketuk tombol <b>Tambah Produk</b> di halaman Stok.', 'Tap the <b>Add Product</b> button on the Stock page.'],
  ['Isi nama produk, harga jual, dan jumlah stok awal.', 'Fill in the product name, selling price, and initial stock quantity.'],
  ['Anda dapat memindai kode batang untuk mengisi data produk secara otomatis.', 'You can scan the barcode to fill in the product details automatically.'],
  ['Mencatat penjualan', 'Recording a sale'],
  ['Pilih produk, lalu ketuk <b>Bayar</b> untuk melanjutkan ke pembayaran.', 'Select the products, then tap <b>Pay</b> to proceed to payment.'],
  ['Kasir dapat menerima pembayaran tunai, kartu debit, atau QRIS.', 'The cashier can accept cash, debit card, or QRIS payments.'],
  ['Jika pelanggan membayar uang muka, catat jumlahnya di kolom Uang Muka.', 'If the customer pays a down payment, record the amount in the Down Payment field.'],
  ['Setelah pembayaran berhasil, struk akan dicetak atau dikirim melalui WhatsApp.', 'Once the payment is successful, the receipt is printed or sent via WhatsApp.'],
  ['Diskon dan promosi', 'Discounts and promotions'],
  ['Diskon dapat diberikan per produk atau untuk seluruh transaksi.', 'Discounts can be applied per product or to the whole transaction.'],
  ['Diskon maksimum yang dapat diberikan kasir adalah 20% dari total belanja.', 'The maximum discount a cashier can give is 20% of the total purchase.'],
  ['Untuk diskon di atas 20%, diperlukan persetujuan pemilik toko.', "Discounts above 20% require the store owner's approval."],
  ['Mengelola stok', 'Managing stock'],
  ['Stok berkurang secara otomatis setiap kali terjadi penjualan.', 'Stock decreases automatically each time a sale is made.'],
  ['Aplikasi akan mengirim pemberitahuan jika stok produk kurang dari {jumlah_minimum} unit.', "The app sends a notification when a product's stock falls below {jumlah_minimum} units."],
  ['Lakukan stok opname setidaknya sebulan sekali.', 'Perform a stock take at least once a month.'],
  ['Retur barang', 'Returns'],
  ['Pelanggan dapat mengembalikan barang dalam waktu 7 hari dengan menunjukkan struk.', 'Customers can return items within 7 days by presenting the receipt.'],
  ['Dana akan dikembalikan melalui metode pembayaran yang sama.', 'The refund is issued through the same payment method.'],
  ['Laporan penjualan', 'Sales reports'],
  ['Laporan penjualan harian tersedia setelah tutup kasir.', 'The daily sales report is available after the register is closed.'],
  ['Anda dapat mengekspor laporan dalam format PDF atau Excel.', 'You can export reports in PDF or Excel format.'],
  ['Mode luring', 'Offline mode'],
  ['Kasir Pintar tetap dapat digunakan tanpa koneksi internet.', 'Kasir Pintar can still be used without an internet connection.'],
  ['Data akan disinkronkan secara otomatis saat perangkat kembali daring.', 'Data is synced automatically when the device is back online.'],
  ['Bantuan', 'Help'],
  ['Hubungi tim dukungan kami melalui WhatsApp di 0812-3456-7890 pada hari kerja pukul 08.00–17.00 WIB.', 'Contact our support team via WhatsApp on 0812-3456-7890 on working days, 08:00–17:00 WIB.'],
  ['Terima kasih telah menggunakan Kasir Pintar.', 'Thank you for using Kasir Pintar.'],
];
const GUIDE_STATUS = 'aaaaaaaarrrrtt nddttdttn nnn nnnnnnnnn'.replace(/ /g, 'n');
const STRINGS = [
  ['login.title', 'Masuk', 'Sign in'], ['login.otp_hint', 'Masukkan kode OTP', 'Enter the OTP code'],
  ['cart.empty', 'Keranjang masih kosong', 'Your cart is empty'], ['checkout.pay', 'Bayar Sekarang', 'Pay now'],
  ['stock.low', 'Stok {produk} tinggal {jumlah}', 'Only {jumlah} of {produk} left in stock'], ['receipt.send', 'Kirim struk', 'Send receipt'],
  ['discount.apply', 'Terapkan diskon', 'Apply discount'], ['error.network', 'Koneksi terputus. Coba lagi.', 'Connection lost. Try again.'],
  ['report.daily', 'Laporan penjualan harian', 'Daily sales report'], ['greeting', 'Halo, %s!', 'Hello, %s!'],
  ['sync.done', 'Data berhasil disinkronkan', 'Data synced successfully'], ['settings.printer', 'Pengaturan pencetak struk', 'Receipt printer settings'],
  ['cashier.close', 'Tutup kasir', 'Close register'], ['return.title', 'Retur barang', 'Returns'],
];
const PRIVACY = [
  ['Privacy Policy', 'Kebijakan Privasi'],
  ['Last updated: 1 November 2026', 'Terakhir diperbarui: 1 November 2026'],
  ['This Privacy Policy explains how Tokolaris collects, uses, and protects your personal data.', 'Kebijakan Privasi ini menjelaskan cara Tokolaris mengumpulkan, menggunakan, dan melindungi data pribadi Anda.'],
  ['Information we collect', 'Informasi yang kami kumpulkan'],
  ['We collect the information you provide when you create an account, such as your name, email address, and phone number.', 'Kami mengumpulkan informasi yang Anda berikan saat membuat akun, seperti nama, alamat email, dan nomor telepon.'],
  ['We also collect transaction data when you make a purchase.', 'Kami juga mengumpulkan data transaksi saat Anda melakukan pembelian.'],
  ['How we use your information', 'Cara kami menggunakan informasi Anda'],
  ['We use your personal data to process orders, prevent fraud, and improve our services.', 'Kami menggunakan data pribadi Anda untuk memproses pesanan, mencegah penipuan, dan meningkatkan layanan kami.'],
  ['We never sell your personal data to third parties.', 'Kami tidak pernah menjual data pribadi Anda kepada pihak ketiga.'],
  ['Your rights', 'Hak Anda'],
  ['You have the right to access, correct, or delete your personal data at any time.', 'Anda berhak mengakses, memperbaiki, atau menghapus data pribadi Anda kapan saja.'],
  ['To exercise your rights, contact our Data Protection Officer at privacy@tokolaris.example.', 'Untuk menggunakan hak Anda, hubungi Pejabat Pelindungan Data kami di privacy@tokolaris.example.'],
  ['Data retention', 'Penyimpanan data'],
  ['We retain your data for as long as your account is active or as required by law.', 'Kami menyimpan data Anda selama akun Anda aktif atau sebagaimana diwajibkan oleh hukum.'],
];
const PRESS = [
  ['Siaran Pers', 'Press Release'],
  ['QRIS Antarnegara kini dapat digunakan di lima negara ASEAN.', 'Cross-border QRIS can now be used in five ASEAN countries.'],
  ['Wisatawan Indonesia dapat membayar dengan memindai kode QR di merchant setempat tanpa menukar uang tunai.', 'Indonesian travellers can pay by scanning a QR code at local merchants without exchanging cash.'],
  ['Nilai tukar ditetapkan secara langsung dan ditampilkan sebelum pembayaran dikonfirmasi.', 'The exchange rate is set in real time and shown before the payment is confirmed.'],
  ['Layanan ini diharapkan mendorong transaksi UMKM di kawasan wisata.', 'The service is expected to boost MSME transactions in tourist areas.'],
  ['Informasi lebih lanjut tersedia di situs resmi penyelenggara.', "Further information is available on the operator's official website."],
];
const LEGACY_TM = [ // older product version: produces realistic fuzzy matches
  ['Stok berkurang secara otomatis setiap kali ada penjualan.', 'Stock decreases automatically each time there is a sale.'],
  ['Pelanggan dapat mengembalikan barang dalam waktu 14 hari dengan menunjukkan struk.', 'Customers can return items within 14 days by presenting the receipt.'],
  ['Untuk diskon di atas 15%, diperlukan persetujuan manajer toko.', "Discounts above 15% require the store manager's approval."],
  ['Laporan penjualan mingguan tersedia setelah tutup kasir.', 'The weekly sales report is available after the register is closed.'],
  ['Jika pelanggan membayar uang muka, catat jumlahnya di kolom Catatan.', 'If the customer pays a down payment, record the amount in the Notes field.'],
  ['Setelah pembayaran berhasil, struk akan dicetak secara otomatis.', 'Once the payment is successful, the receipt is printed automatically.'],
  ['Anda dapat mengekspor laporan dalam format PDF.', 'You can export reports in PDF format.'],
  ['Data akan disinkronkan saat perangkat kembali daring.', 'Data is synced when the device is back online.'],
  ['Aplikasi akan mengirim pemberitahuan jika stok produk kurang dari {jumlah_minimum} unit.', "The app sends a notification when a product's stock falls below {jumlah_minimum} units."],
  ['Lakukan stok opname setidaknya tiga bulan sekali.', 'Perform a stock take at least once every three months.'],
  ['Hubungi tim dukungan kami melalui WhatsApp pada hari kerja.', 'Contact our support team via WhatsApp on working days.'],
  ['Dana akan dikembalikan melalui transfer bank.', 'The refund is issued by bank transfer.'],
  ['Kasir Pintar dapat digunakan tanpa koneksi internet.', 'Kasir Pintar can be used without an internet connection.'],
  ['Terima kasih telah menggunakan aplikasi kami.', 'Thank you for using our app.'],
];
const MENUS = [['Stok', 'Stock'], ['Penjualan', 'Sales'], ['Laporan', 'Reports'], ['Pelanggan', 'Customers'], ['Diskon', 'Discounts'], ['Pegawai', 'Staff'], ['Pemasok', 'Suppliers'], ['Pengaturan', 'Settings'], ['Pembayaran', 'Payments'], ['Promosi', 'Promotions'], ['Outlet', 'Outlets'], ['Pajak', 'Taxes']];
const ACTS = [['melihat ringkasan harian', 'view the daily summary'], ['menambahkan data baru', 'add a new record'], ['mengekspor data ke Excel', 'export the data to Excel'], ['mengubah pengaturan tampilan', 'change the display settings'], ['mencari data berdasarkan tanggal', 'search records by date'], ['menghapus data yang tidak terpakai', 'delete unused records'], ['mencetak laporan', 'print the report'], ['mengatur hak akses pegawai', 'set staff access rights'], ['menyinkronkan data antar perangkat', 'sync data across devices'], ['melihat riwayat perubahan', 'view the change history']];

/* ------------------------------------------------------------------ TMS data */
const REF = new Map(); // segment id -> reference translation (what the mock "AI" suggests)
function mkSegs(pairs, statusOf, extra = {}) {
  return pairs.map((p, i) => {
    const [key, src, ref] = p.length === 3 ? p : [null, p[0], p[1]];
    const st = statusOf(i);
    const s = { id: id('s'), n: i + 1, source: src, target: st === 'new' ? '' : ref, status: st, locked: false, key, note: null, comment: null,
      matchScore: st === 'new' ? null : (st === 'approved' || st === 'reviewed' ? 100 : null), origin: st === 'new' ? null : 'human', updatedAt: st === 'new' ? null : now - (i + 2) * HOUR };
    Object.assign(s, extra[i + 1] || {});
    REF.set(s.id, ref);
    return s;
  });
}
const stMap = { a: 'approved', r: 'reviewed', t: 'translated', d: 'draft', n: 'new' };
const guideSegs = mkSegs(GUIDE, (i) => stMap[GUIDE_STATUS[i]] || 'new', {
  1: { locked: true },
  14: { matchScore: 100, origin: 'tm' },
  16: { status: 'draft', target: 'Once the payment is successful, the bill is printed or sent via WhatsApp.', matchScore: 78, origin: 'mt-ai', comment: 'Klien minta "receipt", bukan "bill" — cek termbase.' },
  19: { status: 'draft', target: 'The maximum discount a cashier can give is 25% of the total purchase.', matchScore: null, origin: 'human' },
  20: { status: 'draft', target: "Discounts above 20% require the store manager's approval.", matchScore: 82, origin: 'tm' },
  22: { matchScore: 88 }, 26: { matchScore: 93 }, 23: { matchScore: 100, note: 'Placeholder {jumlah_minimum} must be kept unchanged.' },
});
const bigPairs = []; for (let i = 0; i < 1240; i++) { const m = MENUS[i % MENUS.length], a = ACTS[(i * 7 + Math.floor(i / 12)) % ACTS.length]; bigPairs.push([`Ketuk menu ${m[0]} untuk ${a[0]}.`, `Tap the ${m[1]} menu to ${a[1]}.`]); }
const FILES = {
  guide: { id: 'f-guide', name: 'panduan-pengguna-v3.2.docx', format: 'docx', origin: 'import', url: null, createdAt: now - 6 * DAY, segs: guideSegs },
  strings: { id: 'f-strings', name: 'strings.id.json', format: 'json', origin: 'import', url: null, createdAt: now - 6 * DAY, segs: mkSegs(STRINGS, (i) => (i < 6 ? 'approved' : i < 9 ? 'translated' : i < 10 ? 'draft' : 'new')) },
  retur: { id: 'f-retur', name: 'Retur barang — Pusat Bantuan', format: 'html', origin: 'web', url: 'https://docs.kasirpintar.example/panduan/retur-barang', createdAt: now - 2 * DAY, segs: mkSegs(GUIDE.slice(24, 27).concat(GUIDE.slice(33, 36)), (i) => (i < 2 ? 'translated' : 'new')) },
  big: { id: 'f-big', name: 'katalog-fitur-lengkap.xliff', format: 'xliff', origin: 'import', url: null, createdAt: now - 5 * DAY, segs: mkSegs(bigPairs, (i) => (i < 420 ? 'approved' : i < 610 ? 'reviewed' : i < 835 ? 'translated' : i < 870 ? 'draft' : 'new')) },
  privacy: { id: 'f-privacy', name: 'privacy-policy-2026.docx', format: 'docx', origin: 'import', url: null, createdAt: now - 3 * DAY, segs: mkSegs(PRIVACY, (i) => (i < 4 ? 'reviewed' : i < 7 ? 'translated' : i === 7 ? 'draft' : 'new'), { 8: { target: 'Kami menggunakan data personal Anda untuk memproses pesanan, mencegah penipuan, dan meningkatkan layanan kami.' } }) },
  press: { id: 'f-press', name: 'siaran-pers-qris-antarnegara.md', format: 'md', origin: 'text', url: null, createdAt: now - 9 * DAY, segs: mkSegs(PRESS, (i) => (i < 5 ? 'approved' : 'reviewed')) },
};
const tmUnits = (pairs, age) => pairs.map(([s, t], i) => ({ id: id('u'), source: s, target: t, createdAt: now - age * DAY - i * HOUR, usage: (i * 3) % 7 }));
const TMS = [
  { id: 'tm-kasir', name: 'Kasir Pintar — project TM', sourceLang: 'id', targetLang: 'en', updatedAt: now - 2 * HOUR, list: tmUnits(guideSegs.filter((s) => ['translated', 'reviewed', 'approved'].includes(s.status)).map((s) => [s.source, s.target]), 1) },
  { id: 'tm-legacy', name: 'Kasir Pintar v3.1 (legacy)', sourceLang: 'id', targetLang: 'en', updatedAt: now - 48 * DAY, list: tmUnits(LEGACY_TM, 48) },
  { id: 'tm-legal', name: 'Legal & Privacy EN→ID', sourceLang: 'en', targetLang: 'id', updatedAt: now - 1 * DAY, list: tmUnits(PRIVACY.slice(0, 7).concat([['We use your personal data to process payments and improve our services.', 'Kami menggunakan data pribadi Anda untuk memproses pembayaran dan meningkatkan layanan kami.'], ['We never share your personal data with third parties without your consent.', 'Kami tidak pernah membagikan data pribadi Anda kepada pihak ketiga tanpa persetujuan Anda.'], ['You have the right to access or delete your personal data.', 'Anda berhak mengakses atau menghapus data pribadi Anda.']]), 20) },
  { id: 'tm-press', name: 'Siaran Pers ID→EN', sourceLang: 'id', targetLang: 'en', updatedAt: now - 9 * DAY, list: tmUnits(PRESS, 9) },
];
const term = (source, target, status = 'preferred', note = '', pos = 'noun') => ({ id: id('t'), source, target, status, note, pos, createdAt: now - 20 * DAY });
const TBS = [
  { id: 'tb-kasir', name: 'Glosarium Kasir Pintar', sourceLang: 'id', targetLang: 'en', updatedAt: now - 3 * DAY, list: [
    term('struk', 'receipt', 'preferred', 'Bukti pembayaran yang dicetak/dikirim.'),
    term('struk', 'bill', 'forbidden', '"Bill" berarti tagihan — jangan dipakai untuk struk.'),
    term('kasir', 'cashier', 'preferred', 'Orang yang melayani pembayaran.'),
    term('tutup kasir', 'close the register', 'preferred', 'Proses akhir hari; bukan "close cashier".', 'verb'),
    term('uang muka', 'down payment', 'preferred', 'Sesuai gaya klien (bukan "deposit").'),
    term('uang muka', 'advance money', 'forbidden', 'Terjemahan harfiah, tidak lazim.'),
    term('stok', 'stock', 'preferred'), term('stok', 'inventory', 'admitted', 'Boleh untuk judul menu.'),
    term('stok opname', 'stock take', 'preferred', 'UK English per panduan gaya klien.'),
    term('diskon', 'discount', 'preferred'), term('laporan penjualan', 'sales report', 'preferred'),
    term('pemilik toko', 'store owner', 'preferred'), term('kode batang', 'barcode', 'preferred'),
    term('luring', 'offline', 'preferred', '', 'adj'), term('daring', 'online', 'preferred', '', 'adj'),
    term('retur', 'return', 'preferred'), term('pelanggan', 'customer', 'preferred'), term('pelanggan', 'client', 'forbidden', 'Gunakan "customer" untuk pembeli ritel.'),
  ] },
  { id: 'tb-legal', name: 'Istilah Hukum & Privasi (UU PDP)', sourceLang: 'en', targetLang: 'id', updatedAt: now - 8 * DAY, list: [
    term('personal data', 'data pribadi', 'preferred', 'Istilah resmi UU No. 27 Tahun 2022.'),
    term('personal data', 'data personal', 'forbidden', 'Tidak sesuai UU PDP.'),
    term('Data Protection Officer', 'Pejabat Pelindungan Data', 'preferred', 'UU PDP memakai "Pelindungan", bukan "Perlindungan".'),
    term('third parties', 'pihak ketiga', 'preferred'), term('fraud', 'penipuan', 'preferred'), term('consent', 'persetujuan', 'preferred'),
    term('data retention', 'penyimpanan data', 'preferred'), term('data retention', 'retensi data', 'admitted'),
  ] },
  { id: 'tb-press', name: 'Glosarium Keuangan', sourceLang: 'id', targetLang: 'en', updatedAt: now - 30 * DAY, list: [
    term('UMKM', 'MSME', 'preferred', 'micro, small and medium enterprises'), term('nilai tukar', 'exchange rate', 'preferred'), term('uang tunai', 'cash', 'preferred'),
  ] },
];
const PROJECTS = [
  { id: 'p-kasir', name: 'Kasir Pintar — Panduan Pengguna v3.2', client: 'PT Sinar Niaga Digital', sourceLang: 'id', targetLang: 'en', dueDate: now + 5 * DAY, createdAt: now - 6 * DAY, updatedAt: now - 2 * HOUR, tmIds: ['tm-kasir', 'tm-legacy'], termbaseIds: ['tb-kasir'], files: [FILES.guide, FILES.strings, FILES.retur, FILES.big] },
  { id: 'p-privacy', name: 'Kebijakan Privasi Tokolaris 2026', client: 'Tokolaris', sourceLang: 'en', targetLang: 'id', dueDate: now + 2 * DAY, createdAt: now - 3 * DAY, updatedAt: now - 26 * HOUR, tmIds: ['tm-legal'], termbaseIds: ['tb-legal'], files: [FILES.privacy] },
  { id: 'p-press', name: 'Siaran Pers — QRIS Antarnegara', client: 'Humas Asosiasi Pembayaran', sourceLang: 'id', targetLang: 'en', dueDate: now - 1 * DAY, createdAt: now - 9 * DAY, updatedAt: now - 4 * DAY, tmIds: ['tm-press'], termbaseIds: ['tb-press'], files: [FILES.press] },
];
for (const p of PROJECTS) for (const f of p.files) f.projectId = p.id;

function statsOf(segs) {
  const by = { new: 0, draft: 0, translated: 0, reviewed: 0, approved: 0 }; let w = 0;
  for (const s of segs) { by[s.status]++; w += words(s.source); }
  return { segments: segs.length, words: w, byStatus: by, progress: segs.length ? (by.translated + by.reviewed + by.approved) / segs.length : 0 };
}
const fileOut = (f) => ({ id: f.id, projectId: f.projectId, name: f.name, format: f.format, origin: f.origin, url: f.url, createdAt: f.createdAt, stats: statsOf(f.segs) });
const projOut = (p) => ({ id: p.id, name: p.name, client: p.client, sourceLang: p.sourceLang, targetLang: p.targetLang, dueDate: p.dueDate, createdAt: p.createdAt, updatedAt: p.updatedAt, tmIds: p.tmIds, termbaseIds: p.termbaseIds, stats: statsOf(p.files.flatMap((f) => f.segs)), fileCount: p.files.length });
const tmOut = (t) => ({ id: t.id, name: t.name, sourceLang: t.sourceLang, targetLang: t.targetLang, units: t.list.length, updatedAt: t.updatedAt });
const tbOut = (t) => ({ id: t.id, name: t.name, sourceLang: t.sourceLang, targetLang: t.targetLang, entries: t.list.length, updatedAt: t.updatedAt });
const need = (x, what) => { if (!x) throw new Error(`${what} was not found.`); return x; };
const P = (pid) => need(PROJECTS.find((p) => p.id === pid), 'That project');
const F = (pid, fid) => need(P(pid).files.find((f) => f.id === fid), 'That file');

/* fuzzy matching + word diff */
const tok = (s) => s.toLowerCase().match(/[\p{L}\p{N}%{}_]+|[^\s\p{L}\p{N}]/gu) || [];
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return d[b.length];
}
function score(a, b) { if (a === b) return 100; const x = tok(a), y = tok(b); const m = Math.max(x.length, y.length) || 1; return Math.min(99, Math.round(100 * (1 - lev(x, y) / m))); }
function wordDiff(a, b) {
  const x = a.split(/\s+/), y = b.split(/\s+/), n = x.length, m = y.length;
  const t = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = []; const push = (op, w) => { const l = ops[ops.length - 1]; if (l && l.op === op) l.text += ' ' + w; else ops.push({ op, text: w }); };
  let i = 0, j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { push('eq', x[i]); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) push('del', x[i++]); else push('ins', y[j++]); }
  while (i < n) push('del', x[i++]); while (j < m) push('ins', y[j++]);
  return ops.map((o, k) => ({ op: o.op, text: o.text + (k < ops.length - 1 ? ' ' : '') }));
}
function lookup(p, text) {
  const matches = [];
  for (const tm of TMS.filter((t) => p.tmIds.includes(t.id))) for (const u of tm.list) { const sc = score(u.source, text); if (sc >= 50) matches.push({ score: sc, source: u.source, target: u.target, tmId: tm.id, tmName: tm.name, diff: wordDiff(u.source, text) }); }
  matches.sort((a, b) => b.score - a.score);
  const seen = new Set(); const top = matches.filter((m) => !seen.has(m.target) && seen.add(m.target)).slice(0, 5);
  const terms = []; const low = text.toLowerCase();
  for (const tb of TBS.filter((t) => p.termbaseIds.includes(t.id))) for (const e of tb.list) {
    const s = e.source.toLowerCase(); let from = 0, k;
    while ((k = low.indexOf(s, from)) >= 0) {
      const before = low[k - 1], after = low[k + s.length];
      if (!(before && /[\p{L}\p{N}]/u.test(before)) && !(after && /[\p{L}\p{N}]/u.test(after))) { terms.push({ entryId: e.id, termbaseId: tb.id, source: e.source, target: e.target, status: e.status, note: e.note, start: k, end: k + s.length }); break; }
      from = k + s.length;
    }
  }
  // a longer term hides shorter ones inside it ("stok opname" over "stok")
  const filtered = terms.filter((t) => !terms.some((o) => o !== t && o.start <= t.start && o.end >= t.end && (o.end - o.start) > (t.end - t.start)));
  filtered.sort((a, b) => a.start - b.start || (a.status === 'preferred' ? -1 : 1));
  return { matches: top, terms: filtered };
}
const PH = /\{[^}]+\}|%\d*\$?[sd]|<\/?[a-z][^>]*>/gi;
function qaFile(p, f) {
  const issues = []; const add = (s, check, severity, message) => issues.push({ check, severity, message, segmentId: s.id });
  for (const s of f.segs) {
    if (!s.target) { if (['translated', 'reviewed', 'approved'].includes(s.status)) add(s, 'empty-target', 'critical', 'The segment is confirmed but has no translation.'); continue; }
    const { terms } = lookup(p, s.source); const tl = s.target.toLowerCase();
    for (const t of terms) if (t.status === 'forbidden' && tl.includes(t.target.toLowerCase())) add(s, 'forbidden-term', 'major', `Forbidden term “${t.target}” used for “${t.source}”.`);
    for (const t of terms) if (t.status === 'preferred' && !tl.includes(t.target.toLowerCase()) && !terms.some((o) => o.source === t.source && o.status === 'admitted' && tl.includes(o.target.toLowerCase()))) add(s, 'terminology', 'minor', `Term “${t.source}” is not translated as “${t.target}”.`);
    const nums = (x) => (x.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, '')).sort().join(' ');
    if (nums(s.source) !== nums(s.target)) add(s, 'numbers', 'major', 'Numbers in the translation do not match the source.');
    const ph = (x) => (x.match(PH) || []).sort().join(' ');
    if (ph(s.source) !== ph(s.target)) add(s, 'placeholders', 'critical', 'Placeholders or tags differ from the source.');
    if (/ {2,}/.test(s.target)) add(s, 'double-space', 'minor', 'The translation contains a double space.');
    const end = (x) => (/[.!?:]$/.test(x.trim()) ? x.trim().slice(-1) : '');
    if (end(s.source) !== end(s.target)) add(s, 'punctuation', 'minor', 'End punctuation differs from the source.');
  }
  return issues;
}

/* ------------------------------------------------------------------ web pages (preview only) */
const PAGES = {
  'berita-nusantara.example/ekonomi/umkm-qris-2026': { site: 'Berita Nusantara', section: 'Ekonomi', lang: 'id', hue: 8,
    title: 'Transaksi QRIS UMKM Tumbuh Pesat, Pedagang Pasar Mulai Tinggalkan Uang Tunai', byline: 'Redaksi Ekonomi · 20 November 2026 · 4 menit baca',
    paras: [
      'JAKARTA — Penggunaan QRIS oleh pelaku usaha mikro, kecil, dan menengah (UMKM) terus meningkat sepanjang 2026. Pedagang pasar tradisional, warung kopi, hingga juru parkir kini menerima pembayaran nontunai.',
      'Data asosiasi sistem pembayaran menunjukkan jumlah merchant QRIS bertambah sekitar 6 juta dalam setahun terakhir, sebagian besar berasal dari usaha mikro.',
      'Kemudahan menjadi alasan utama. Pedagang cukup menempelkan satu kode QR di lapak, dan pembeli bisa membayar dari aplikasi bank atau dompet digital apa pun.',
      '“Dulu saya sering kehabisan uang kembalian. Sekarang pembeli tinggal pindai, dan uangnya langsung masuk rekening,” kata Sari, pedagang sayur di Pasar Minggu.',
      'Meski begitu, tantangan masih ada. Koneksi internet yang tidak stabil dan rendahnya literasi keuangan digital membuat sebagian pedagang ragu beralih.',
      'Pengamat ekonomi digital menilai aplikasi kasir yang tetap berfungsi saat luring dapat membantu pedagang mencatat penjualan dan mengelola stok tanpa bergantung pada sinyal.',
      'Pemerintah menargetkan 40 juta UMKM terhubung ke ekosistem digital pada akhir tahun depan.',
    ],
    tr: { en: { title: 'MSME QRIS Transactions Surge as Market Traders Move Away from Cash', paras: [
      'JAKARTA — The use of QRIS by micro, small and medium enterprises (MSMEs) kept rising throughout 2026. Traditional market traders, coffee stalls and even parking attendants now accept cashless payments.',
      'Payment system association data show the number of QRIS merchants grew by around 6 million over the past year, most of them micro businesses.',
      'Convenience is the main reason. Traders simply stick a single QR code on their stall, and buyers can pay from any banking app or e-wallet.',
      '“I used to run out of change all the time. Now buyers just scan, and the money goes straight into my account,” said Sari, a vegetable seller at Pasar Minggu.',
      'Even so, challenges remain. Unstable internet connections and low digital financial literacy make some traders hesitant to switch.',
      'Digital economy observers say point-of-sale apps that keep working offline can help traders record sales and manage stock without depending on a signal.',
      'The government aims to have 40 million MSMEs connected to the digital ecosystem by the end of next year.',
    ] } },
    answer: 'The article reports that QRIS use among Indonesian MSMEs kept growing through 2026, reaching even market stalls and parking attendants [1].\n\n**Key points**\n\n- **Scale:** about 6 million new QRIS merchants in a year, mostly micro businesses [2]\n- **Why it works:** one QR code on the stall accepts any banking app or e-wallet [3]\n- **Obstacles:** unstable connectivity and low digital financial literacy [5]\n- **Outlook:** offline-capable point-of-sale apps are seen as part of the answer [6]; the government targets 40 million connected MSMEs [7]\n\n> A trader quoted in the piece says she no longer runs out of change [4].\n\nTerminology note: *UMKM* is usually rendered **MSME** in English financial writing.' },
  'localization-weekly.example/articles/terminology-management': { site: 'Localization Weekly', section: 'Craft', lang: 'en', hue: 262,
    title: 'Why terminology management pays for itself', byline: 'By the editorial team · 12 November 2026 · 5 min read',
    paras: [
      'Every translation team has lived this moment: the same product feature appears under three different names in a single release.',
      'A termbase fixes that at the source. It records the approved translation for each key concept, along with forbidden variants and usage notes.',
      'When the termbase is connected to the editor, translators see the approved term the moment it appears in a segment, and quality checks flag anything that deviates.',
      'The payoff compounds. Teams that maintain a termbase report fewer review rounds, faster onboarding for new linguists, and more consistent translation memories.',
      'Start small: fifty well-defined terms with clear notes are worth more than five thousand unverified entries.',
      'Review the termbase with subject-matter experts at least once per release cycle.',
    ],
    tr: { id: { title: 'Mengapa manajemen terminologi sepadan dengan biayanya', paras: [
      'Setiap tim penerjemah pernah mengalami momen ini: fitur produk yang sama muncul dengan tiga nama berbeda dalam satu rilis.',
      'Termbase menyelesaikan masalah itu dari sumbernya. Termbase mencatat terjemahan yang disetujui untuk setiap konsep kunci, beserta varian terlarang dan catatan penggunaan.',
      'Ketika termbase terhubung ke editor, penerjemah langsung melihat istilah yang disetujui begitu istilah itu muncul di segmen, dan pemeriksaan mutu menandai setiap penyimpangan.',
      'Manfaatnya berlipat. Tim yang memelihara termbase melaporkan putaran tinjauan yang lebih sedikit, orientasi linguis baru yang lebih cepat, dan memori terjemahan yang lebih konsisten.',
      'Mulailah dari yang kecil: lima puluh istilah yang terdefinisi baik dengan catatan jelas lebih berharga daripada lima ribu entri yang belum diverifikasi.',
      'Tinjau termbase bersama pakar bidang setidaknya sekali setiap siklus rilis.',
    ] } },
    answer: 'The article argues that a maintained termbase removes inconsistent naming at the source [1][2].\n\n1. It stores approved translations, **forbidden variants** and usage notes [2]\n2. Connected to the editor, it shows terms in context and lets QA flag deviations [3]\n3. Benefits compound: fewer review rounds and more consistent TMs [4]\n\nPractical advice: start with about fifty well-defined terms [5] and review them every release cycle [6].' },
  'docs.kasirpintar.example/panduan/retur-barang': { site: 'Pusat Bantuan Kasir Pintar', section: 'Panduan', lang: 'id', hue: 186,
    title: 'Retur barang', byline: 'Diperbarui 3 November 2026',
    paras: GUIDE.slice(25, 27).map((x) => x[0]).concat(['Buka menu Penjualan, pilih transaksi, lalu ketuk Retur.', 'Stok produk akan bertambah kembali secara otomatis setelah retur disetujui.', GUIDE[34][0]]),
    tr: { en: { title: 'Returns', paras: GUIDE.slice(25, 27).map((x) => x[1]).concat(['Open the Sales menu, select the transaction, then tap Return.', 'Product stock is added back automatically once the return is approved.', GUIDE[34][1]]) } },
    answer: 'This help page explains the return policy: items can be returned within 7 days with the receipt [1], and refunds use the original payment method [2]. Returns are started from the Sales menu [3] and stock is restored automatically [4].' },
};
function pageFor(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const key = (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, '');
  if (PAGES[key]) return PAGES[key];
  const q = u.searchParams.get('q');
  if (q) return { site: 'Search', section: 'Results', lang: 'en', hue: 212, search: true, title: `${q} — search results`, byline: 'Preview results', paras: [
    `Kamus Besar Bahasa Indonesia — arti kata “${q}” beserta contoh pemakaian.`, `${q}: definisi, sinonim, dan padanan bahasa Inggris — glosarium daring.`,
    `Diskusi penerjemah tentang “${q}” dan padanannya dalam konteks hukum dan teknis.`, `Artikel ensiklopedia: ${q}.`] };
  const host = u.host.replace(/^www\./, '');
  return { site: host, section: '', lang: 'en', hue: 200, generic: true, title: host.split('.')[0].replace(/^./, (c) => c.toUpperCase()), byline: url, paras: [
    'This is a preview page. In the real app the live website is drawn in this area by the sandboxed browser engine.',
    'Everything around it — tabs, toolbar, side panel and the internal Lintas pages — is the actual browser interface.',
    'Try the side panel (Ctrl+Shift+E), Find (Ctrl+F), saving the page for offline use, or capturing it into a TMS project.'] };
}
const favFor = (letter, hue) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="hsl(${hue} 55% 42%)"/><text x="16" y="22.5" font-family="system-ui,Segoe UI,sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`);

/* ------------------------------------------------------------------ install */
export function installMock() {
  const listeners = new Map();
  const emit = (e, p) => { for (const fn of [...(listeners.get(e) || [])]) fn(clone(p)); };
  const status = { version: '0.1.0-preview', online: true, hasApiKey: true, model: 'claude-sonnet-4-5', platform: 'linux', dataDir: '~/.config/Lintas', sandbox: true,
    models: [{ id: 'claude-opus-4-5', label: 'Claude Opus 4.5', note: 'Most capable — careful review and legal texts' }, { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', note: 'Balanced — recommended for everyday translation' }, { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest — bulk pre-translation' }] };
  let settings = { searchEngine: 'duckduckgo', homepage: 'lintas://newtab', httpsOnly: true, blockTrackers: true, blockThirdPartyCookies: true, sendDoNotTrack: true,
    autoSaveOffline: false, showBookmarksBar: true, theme: 'system', model: 'claude-sonnet-4-5', effort: 'medium', restoreSession: true, uiLanguage: 'en', defaultSourceLang: 'id', defaultTargetLang: 'en' };
  const usage = { inputTokens: 48210, outputTokens: 9120, requests: 23, since: now - 3 * HOUR };
  const aiGate = () => { if (!status.online) throw new Error("You're offline. AI features need a network connection."); if (!status.hasApiKey) throw new Error('Add your Claude API key in Settings → AI to use AI features.'); usage.requests++; usage.inputTokens += 1400; usage.outputTokens += 260; };

  const U = { news: 'https://berita-nusantara.example/ekonomi/umkm-qris-2026', loc: 'https://localization-weekly.example/articles/terminology-management', docs: 'https://docs.kasirpintar.example/panduan/retur-barang' };
  let bookmarks = [
    ['KBBI Daring', 'https://kbbi.kemdikbud.go.id/', null], ['EYD V', 'https://ejaan.kemdikbud.go.id/', null], ['Wikipedia bahasa Indonesia', 'https://id.wikipedia.org/', null],
    ['Berita Nusantara', U.news, null], ['Localization Weekly', U.loc, null], ['MDN Web Docs', 'https://developer.mozilla.org/', 'Dev'], ['GitHub', 'https://github.com/', 'Dev'],
    ['Pusat Bantuan Kasir Pintar', U.docs, 'Klien'], ['Tokolaris — Privacy', 'https://tokolaris.example/privacy', 'Klien'],
  ].map(([title, url, folder], i) => ({ id: id('b'), title, url, folder, createdAt: now - (i + 1) * DAY }));
  let history = [
    [U.news, PAGES['berita-nusantara.example/ekonomi/umkm-qris-2026'].title, 0.3, 3], [U.loc, 'Why terminology management pays for itself', 1.1, 2],
    ['https://kbbi.kemdikbud.go.id/entri/luring', 'luring — KBBI Daring', 1.6, 5], [U.docs, 'Retur barang — Pusat Bantuan Kasir Pintar', 2.2, 4],
    ['https://duckduckgo.com/?q=padanan+stock+take', 'padanan stock take — search results', 2.4, 1], ['https://id.wikipedia.org/wiki/QRIS', 'QRIS — Wikipedia bahasa Indonesia', 5, 2],
    ['https://developer.mozilla.org/en-US/docs/Web/API/Intl', 'Intl — MDN Web Docs', 26, 6], ['https://github.com/', 'GitHub', 27.5, 12],
    ['https://ejaan.kemdikbud.go.id/eyd/penggunaan-huruf/huruf-miring/', 'Huruf Miring — EYD V', 29, 2], ['https://tokolaris.example/privacy', 'Privacy Policy — Tokolaris', 50, 3],
    ['https://kbbi.kemdikbud.go.id/entri/daring', 'daring — KBBI Daring', 53, 4], ['https://id.wikipedia.org/wiki/Penerjemahan', 'Penerjemahan — Wikipedia bahasa Indonesia', 75, 1],
  ].map(([url, title, h_, visits]) => ({ url, title, visitedAt: now - h_ * HOUR, visits }));
  let offlinePages = [
    { id: 'o-1', url: U.news, title: PAGES['berita-nusantara.example/ekonomi/umkm-qris-2026'].title, savedAt: now - 20 * HOUR, bytes: 1_840_000, lang: 'id', words: 412 },
    { id: 'o-2', url: U.docs, title: 'Retur barang — Pusat Bantuan Kasir Pintar', savedAt: now - 2 * DAY, bytes: 312_000, lang: 'id', words: 186 },
    { id: 'o-3', url: 'https://id.wikipedia.org/wiki/QRIS', title: 'QRIS — Wikipedia bahasa Indonesia', savedAt: now - 4 * DAY, bytes: 2_950_000, lang: 'id', words: 2140 },
    { id: 'o-4', url: 'https://ejaan.kemdikbud.go.id/eyd/penggunaan-huruf/huruf-miring/', title: 'Huruf Miring — EYD V', savedAt: now - 9 * DAY, bytes: 221_000, lang: 'id', words: 640 },
    { id: 'o-5', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Intl', title: 'Intl — MDN Web Docs', savedAt: now - 12 * DAY, bytes: 905_000, lang: 'en', words: 1320 },
  ];
  let downloads = [
    { id: 'd-1', filename: 'panduan-pengguna-v3.2.en.docx', url: 'lintas://tms/export', state: 'completed', received: 284_000, total: 284_000, savePath: '~/Downloads/panduan-pengguna-v3.2.en.docx' },
    { id: 'd-2', filename: 'glosarium-kasir-pintar.tbx', url: 'lintas://tms/export', state: 'completed', received: 41_200, total: 41_200, savePath: '~/Downloads/glosarium-kasir-pintar.tbx' },
    { id: 'd-3', filename: 'uu-27-2022-pelindungan-data-pribadi.pdf', url: 'https://peraturan.example/uu-27-2022.pdf', state: 'interrupted', received: 1_200_000, total: 3_400_000, savePath: '~/Downloads/uu-27-2022-pelindungan-data-pribadi.pdf' },
  ];

  /* ----- tabs */
  let tabId = 0; const tabs = []; const closed = []; const pageState = new Map(); // tabId -> { find, findActive, highlight }
  const searchUrl = (q) => ({ duckduckgo: 'https://duckduckgo.com/?q=', google: 'https://www.google.com/search?q=', bing: 'https://www.bing.com/search?q=', startpage: 'https://www.startpage.com/do/search?q=', brave: 'https://search.brave.com/search?q=' }[settings.searchEngine] + encodeURIComponent(q).replace(/%20/g, '+'));
  function resolve(input) {
    const t = String(input || '').trim();
    if (!t) return 'lintas://newtab';
    if (/^lintas:\/\//.test(t)) return t;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
    if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return 'https://' + t;
    if (/^localhost(:\d+)?(\/.*)?$/.test(t)) return 'http://' + t;
    return searchUrl(t);
  }
  function mkTab(url, o = {}) {
    const t = { id: ++tabId, kind: 'web', url: '', title: '', favicon: null, loading: false, canGoBack: false, canGoForward: false, active: false, pinned: !!o.pinned, private: !!o.private,
      muted: false, audible: false, security: 'internal', blocked: 0, zoom: 1, error: null, offlineCopy: null, bookmarked: false, translated: null, _hist: [], _pos: -1 };
    load(t, resolve(url), { instant: true });
    return t;
  }
  function apply(t, url) {
    t.url = url; t.error = null; t.translated = null; pageState.delete(t.id);
    t.bookmarked = bookmarks.some((b) => b.url === url);
    if (url.startsWith('lintas://')) { Object.assign(t, { kind: 'internal', title: '', favicon: null, security: 'internal', blocked: 0, offlineCopy: null, audible: false }); return; }
    const pg = pageFor(url); const copy = offlinePages.find((o) => o.url === url);
    t.kind = 'web'; t.offlineCopy = copy ? { id: copy.id, savedAt: copy.savedAt } : null;
    const offlineFail = !status.online || /(^|\.)offline-test\.example/.test(url);
    if (url.startsWith('http://') && settings.httpsOnly && !t._allowHttp?.includes(new URL(url).host)) { /* handled as https failure below */ }
    if (offlineFail) { t.title = pg?.title || url; t.security = 'error'; t.error = { code: -106, description: 'This computer is not connected to the internet.', url }; return; }
    if (/(^|\.)http-only\.example/.test(url) && url.startsWith('https://') && settings.httpsOnly) { t.title = url; t.security = 'error'; t.error = { code: -501, description: 'This site does not support a secure (HTTPS) connection.', url }; return; }
    if (/(^|\.)nxdomain\.example/.test(url)) { t.title = url; t.security = 'error'; t.error = { code: -105, description: 'The server address could not be found.', url }; return; }
    t.title = pg.generic ? pg.title : (pg.search ? pg.title : `${pg.title}${pg.section ? ' — ' + pg.site : ''}`);
    t.favicon = pg.generic ? null : favFor((pg.site[0] || '?').toUpperCase(), pg.hue);
    t.security = url.startsWith('https://') ? 'secure' : 'insecure';
    t.blocked = settings.blockTrackers ? (pg.generic ? 2 : pg.search ? 0 : 7 + (pg.hue % 9)) : 0;
    t.audible = false;
  }
  function load(t, url, { instant, replace } = {}) {
    if (!replace) { t._hist = t._hist.slice(0, t._pos + 1); t._hist.push(url); t._pos = t._hist.length - 1; }
    t.canGoBack = t._pos > 0; t.canGoForward = t._pos < t._hist.length - 1;
    apply(t, url);
    if (t.kind === 'web' && !instant) {
      t.loading = true; const tok_ = (t._load = (t._load || 0) + 1);
      setTimeout(() => { if (t._load !== tok_) return; t.loading = false;
        if (!t.error && !t.private && !history.some((x) => x.url === url && now - x.visitedAt < 1000)) { const ex = history.find((x) => x.url === url); if (ex) { ex.visitedAt = Date.now(); ex.visits++; } else history.unshift({ url, title: t.title, visitedAt: Date.now(), visits: 1 }); }
        changed(); }, 650);
    } else t.loading = false;
  }
  const out = (t) => { const o = { ...t }; for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; };
  const list = () => tabs.map(out);
  let pending = false;
  function changed() { if (pending) return; pending = true; queueMicrotask(() => { pending = false; emit('tabs', list()); draw(); }); }
  const T = (tid) => need(tabs.find((t) => t.id === tid), 'That tab');
  function activate(tid) { for (const t of tabs) t.active = t.id === tid; }

  tabs.push(mkTab('lintas://tms', { pinned: true }), mkTab(U.news), mkTab(U.docs), mkTab(U.loc), mkTab('lintas://newtab'));
  tabs[1].audible = true; activate(tabs[4].id);

  /* ----- preview page renderer (stands in for the native WebContentsView) */
  let host = null, hostTab = null;
  function draw() {
    if (!host || !host.isConnected) return;
    const t = tabs.find((x) => x.id === hostTab); while (host.firstChild) host.firstChild.remove();
    if (!t || t.kind !== 'web' || t.error) return;
    const pg = pageFor(t.url); const st = pageState.get(t.id) || {};
    const tr = t.translated && pg.tr?.[t.translated.targetLang];
    const title = tr ? tr.title : pg.title, paras = tr ? tr.paras : pg.paras;
    const mark = (text) => {
      if (!st.find) return [text];
      const outp = []; const low = text.toLowerCase(), q = st.find.toLowerCase(); let from = 0, k;
      while ((k = low.indexOf(q, from)) >= 0) { if (k > from) outp.push(text.slice(from, k)); st._i = (st._i || 0) + 1; outp.push(h('mark', { class: st._i === st.findActive ? 'cur' : '' }, text.slice(k, k + q.length))); from = k + q.length; }
      outp.push(text.slice(from)); return outp;
    };
    st._i = 0;
    const art = h('article.pv-article', { lang: t.translated?.targetLang || pg.lang, style: { '--pv-hue': pg.hue, zoom: t.zoom } },
      h('header.pv-site', h('span.pv-logo', (pg.site[0] || '?').toUpperCase()), h('strong', pg.site), pg.section ? h('span.pv-sec', pg.section) : null,
        h('nav', ['Beranda', 'Terbaru', 'Tentang'].map((x) => h('span', pg.lang === 'id' && !t.translated ? x : { Beranda: 'Home', Terbaru: 'Latest', Tentang: 'About' }[x])))),
      h('div.pv-body', { class: t.loading ? 'pv-loading' : '' },
        t.translated ? h('div.pv-translated', `Translated to ${t.translated.targetLang.toUpperCase()} by Lintas · original preserved`) : null,
        h('h1', { dir: 'auto' }, mark(title)), h('p.pv-by', pg.byline),
        pg.generic || pg.search ? null : h('div.pv-hero'),
        paras.map((p, i) => h(pg.search ? 'p.pv-result' : 'p', { dir: 'auto', class: st.highlight === i + 1 ? 'pv-flash' : '', dataset: { n: i + 1 } }, mark(p)))));
    host.appendChild(art);
    art.querySelector('.pv-flash, mark.cur')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ----- API */
  const api = {
    on(evt, fn) { if (typeof fn !== 'function') return () => {}; if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt)?.delete(fn); },
    view: { async setBounds(b) { api.__preview.bounds = b; }, async setVisible(v) { api.__preview.visible = v; } },
    tabs: {
      async list() { return clone(list()); },
      async create({ url, active = true, private: priv = false } = {}) { const t = mkTab(url || 'lintas://newtab', { private: priv }); const li = tabs.length; tabs.splice(li, 0, t); if (url && t.kind === 'web') { t.loading = true; setTimeout(() => { t.loading = false; changed(); }, 650); } if (active) activate(t.id); changed(); return clone(out(t)); },
      async close(tid) { const i = tabs.findIndex((t) => t.id === tid); if (i < 0) return; const [t] = tabs.splice(i, 1); closed.push({ url: t.url, private: t.private, index: i }); if (!tabs.length) tabs.push(mkTab('lintas://newtab')); if (t.active) activate((tabs[i] || tabs[i - 1] || tabs[0]).id); changed(); },
      async activate(tid) { T(tid); activate(tid); changed(); },
      async move(tid, to) { const i = tabs.findIndex((t) => t.id === tid); if (i < 0) return; const [t] = tabs.splice(i, 1); tabs.splice(Math.max(0, Math.min(tabs.length, to)), 0, t); changed(); },
      async pin(tid, v) { const t = T(tid); t.pinned = !!v; const i = tabs.indexOf(t); tabs.splice(i, 1); const pinned = tabs.filter((x) => x.pinned).length; tabs.splice(pinned, 0, t); changed(); },
      async mute(tid, v) { T(tid).muted = !!v; changed(); },
      async duplicate(tid) { const s = T(tid); const t = mkTab(s.url, { private: s.private }); tabs.splice(tabs.indexOf(s) + 1, 0, t); activate(t.id); changed(); return clone(out(t)); },
      async reopenClosed() { const c = closed.pop(); if (!c) return; const t = mkTab(c.url, { private: c.private }); tabs.splice(Math.min(tabs.length, c.index), 0, t); activate(t.id); changed(); return clone(out(t)); },
    },
    nav: {
      async go(tid, input) { load(T(tid), resolve(input)); changed(); },
      async back(tid) { const t = T(tid); if (t._pos > 0) { t._pos--; load(t, t._hist[t._pos], { replace: true }); changed(); } },
      async forward(tid) { const t = T(tid); if (t._pos < t._hist.length - 1) { t._pos++; load(t, t._hist[t._pos], { replace: true }); changed(); } },
      async reload(tid) { const t = T(tid); load(t, t.error?.url || t.url, { replace: true }); changed(); },
      async stop(tid) { const t = T(tid); t._load++; t.loading = false; changed(); },
      async zoom(tid, dir) { const t = T(tid); const steps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]; let i = steps.indexOf(t.zoom); if (i < 0) i = 5; t.zoom = dir === 'reset' ? 1 : steps[Math.max(0, Math.min(steps.length - 1, i + (dir === 'in' ? 1 : -1)))]; changed(); return t.zoom; },
      async find(tid, text, { forward = true, findNext = false } = {}) {
        const t = T(tid); const pg = t.kind === 'web' && !t.error ? pageFor(t.url) : null; const st = pageState.get(tid) || {}; pageState.set(tid, st);
        const tr = t.translated && pg?.tr?.[t.translated.targetLang]; const hay = pg ? [tr ? tr.title : pg.title, ...(tr ? tr.paras : pg.paras)].join('\n').toLowerCase() : '';
        const matches = text ? hay.split(text.toLowerCase()).length - 1 : 0;
        st.findActive = !matches ? 0 : (findNext && st.find === text ? ((st.findActive - 1 + (forward ? 1 : -1) + matches) % matches) + 1 : 1); st.find = text;
        draw(); const r = { matches, active: st.findActive }; emit('find', { tabId: tid, ...r }); return r;
      },
      async stopFind(tid) { const st = pageState.get(tid); if (st) { st.find = ''; st.findActive = 0; draw(); } },
      async print() { emit('toast', { kind: 'info', message: 'Preview mode: the print dialog opens in the real app.' }); },
      async devtools() { emit('toast', { kind: 'info', message: 'Preview mode: DevTools open in the real app.' }); },
      async allowHttp(tid) { const t = T(tid); const u = (t.error?.url || t.url).replace(/^https:/, 'http:'); t._hist[t._pos] = u; apply(t, u); t.error = null; t.security = 'insecure'; t.title = pageFor(u).title; changed(); },
    },
    permissions: { async answer(requestId, a) { emit('toast', { kind: 'info', message: `Preview: permission ${a.allow ? 'allowed' : 'blocked'}${a.remember ? ' and remembered' : ''}.` }); } },
    omnibox: { async suggest(text) {
      const q = String(text || '').trim().toLowerCase(); if (!q) return [];
      const r = []; const url = resolve(text); const isSearch = url === searchUrl(text.trim());
      r.push(isSearch ? { type: 'search', title: text.trim(), url, detail: `Search with ${{ duckduckgo: 'DuckDuckGo', google: 'Google', bing: 'Bing', startpage: 'Startpage', brave: 'Brave Search' }[settings.searchEngine]}` } : { type: 'url', title: url, url, detail: 'Go to address' });
      const hit = (s) => String(s || '').toLowerCase().includes(q); const seen = new Set([url]);
      const add = (x) => { if (r.length < 8 && !seen.has(x.url)) { seen.add(x.url); r.push(x); } };
      for (const t of tabs) if (!t.active && t.kind === 'web' && (hit(t.title) || hit(t.url))) add({ type: 'tab', title: t.title, url: t.url, detail: 'Switch to this tab', tabId: t.id });
      for (const p of PROJECTS) { if (hit(p.name) || hit(p.client)) add({ type: 'tms', title: p.name, url: `lintas://tms/project/${p.id}`, detail: `TMS project · ${p.sourceLang.toUpperCase()} → ${p.targetLang.toUpperCase()}` }); for (const f of p.files) if (hit(f.name)) add({ type: 'tms', title: f.name, url: `lintas://tms/file/${p.id}/${f.id}`, detail: `TMS file · ${p.name}` }); }
      for (const b of bookmarks) if (hit(b.title) || hit(b.url)) add({ type: 'bookmark', title: b.title, url: b.url, detail: b.url });
      for (const o of offlinePages) if (hit(o.title)) add({ type: 'offline', title: o.title, url: o.url, detail: 'Saved for offline', offlineId: o.id });
      for (const x of history) if (hit(x.title) || hit(x.url)) add({ type: 'history', title: x.title, url: x.url, detail: x.url });
      if (!isSearch) add({ type: 'search', title: text.trim(), url: searchUrl(text.trim()), detail: 'Search the web' });
      return r;
    } },
    bookmarks: {
      async list() { return clone(bookmarks); },
      async toggle({ url, title }) { const i = bookmarks.findIndex((b) => b.url === url); if (i >= 0) bookmarks.splice(i, 1); else bookmarks.push({ id: id('b'), title: title || url, url, folder: null, createdAt: Date.now() }); for (const t of tabs) t.bookmarked = bookmarks.some((b) => b.url === t.url); changed(); return { bookmarked: i < 0 }; },
      async remove(bid) { bookmarks = bookmarks.filter((b) => b.id !== bid); for (const t of tabs) t.bookmarked = bookmarks.some((b) => b.url === t.url); changed(); },
    },
    history: {
      async list({ q, limit = 200 } = {}) { const s = (q || '').toLowerCase(); return clone(history.filter((x) => !s || x.title.toLowerCase().includes(s) || x.url.toLowerCase().includes(s)).sort((a, b) => b.visitedAt - a.visitedAt).slice(0, limit)); },
      async clear({ since } = {}) { history = since ? history.filter((x) => x.visitedAt < since) : []; },
    },
    downloads: {
      async list() { return clone(downloads); },
      async open(d) { emit('toast', { kind: 'info', message: 'Preview mode: the file opens in the real app.' }); },
      async show(d) { emit('toast', { kind: 'info', message: 'Preview mode: the folder opens in the real app.' }); },
      async cancel(did) { const d = downloads.find((x) => x.id === did); if (d && d.state === 'progressing') { d.state = 'cancelled'; emit('download', d); } },
    },
    extensions: {
      async list() { return [{ id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', name: 'uBlock Origin', version: '1.62.0', description: 'An efficient blocker.', manifestVersion: 3, source: 'store', optionsUrl: null, permissions: ['storage', '<all_urls>'] }]; },
      async installFromStore() { throw new Error('Preview mode: extensions install in the real app.'); },
      async loadUnpacked() { throw new Error('Preview mode: extensions load in the real app.'); },
      async remove() {}, async openOptions() {},
    },
    claude: {
      async status() { return { enabled: false, running: false, configured: false, configPath: '~/.config/Claude/claude_desktop_config.json', configError: null, entry: { command: 'lintas', args: ['app/mcp/server.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } } }; },
      async connect() { throw new Error('Preview mode: setup runs in the real app.'); },
    },
    offline: {
      async save(tid) { const t = T(tid); if (t.kind !== 'web' || t.error) throw new Error('Only loaded web pages can be saved for offline use.'); await delay(700);
        let o = offlinePages.find((x) => x.url === t.url); const pg = pageFor(t.url);
        if (o) o.savedAt = Date.now(); else { o = { id: id('o'), url: t.url, title: t.title, savedAt: Date.now(), bytes: 240_000 + pg.paras.join('').length * 900, lang: pg.lang, words: words(pg.paras.join(' ')) }; offlinePages.unshift(o); }
        t.offlineCopy = { id: o.id, savedAt: o.savedAt }; changed(); return clone(o); },
      async list({ q } = {}) { const s = (q || '').toLowerCase(); return clone(offlinePages.filter((o) => !s || o.title.toLowerCase().includes(s) || o.url.toLowerCase().includes(s)).sort((a, b) => b.savedAt - a.savedAt)); },
      async open(oid, { newTab = false } = {}) { const o = need(offlinePages.find((x) => x.id === oid), 'That saved page'); let t = tabs.find((x) => x.active);
        if (newTab || !t) { t = mkTab('lintas://newtab'); tabs.push(t); activate(t.id); }
        const was = status.online; status.online = true; load(t, o.url, { instant: true }); status.online = was; t.security = 'offline-copy'; t.blocked = 0; changed(); },
      async remove(oid) { offlinePages = offlinePages.filter((o) => o.id !== oid); for (const t of tabs) if (t.offlineCopy?.id === oid) t.offlineCopy = null; changed(); },
    },
    app: { async status() { return clone(status); }, async defaultBrowser() { return { isDefault: false, canSetDirectly: false }; }, async makeDefault() { return { isDefault: false, canSetDirectly: false, openedSettings: true }; } },
    settings: {
      async get() { return clone(settings); },
      async set(partial) { settings = { ...settings, ...partial }; if (partial.model) status.model = partial.model; emit('settings', settings); return clone(settings); },
      async setApiKey(key) { status.hasApiKey = !!key; return { hasApiKey: status.hasApiKey }; },
    },
    privacy: { async clearData({ history: hst, offline } = {}) { await delay(500); if (hst) history = []; if (offline) { offlinePages = []; for (const t of tabs) t.offlineCopy = null; changed(); } } },
    tms: {
      async dashboard() { const projects = PROJECTS.map(projOut); return clone({ projects, tms: TMS.map(tmOut), termbases: TBS.map(tbOut), totals: { words: projects.reduce((a, p) => a + p.stats.words, 0), segments: projects.reduce((a, p) => a + p.stats.segments, 0), approved: projects.reduce((a, p) => a + p.stats.byStatus.approved, 0) } }); },
      async createProject({ name, sourceLang, targetLang, client, dueDate }) { if (!name) throw new Error('Give the project a name.');
        const tm = { id: id('tm'), name: `${name} — project TM`, sourceLang, targetLang, updatedAt: Date.now(), list: [] }; const tb = { id: id('tb'), name: `${name} — termbase`, sourceLang, targetLang, updatedAt: Date.now(), list: [] };
        TMS.push(tm); TBS.push(tb); const p = { id: id('p'), name, client: client || null, sourceLang, targetLang, dueDate: dueDate ? new Date(dueDate).getTime() : null, createdAt: Date.now(), updatedAt: Date.now(), tmIds: [tm.id], termbaseIds: [tb.id], files: [] };
        PROJECTS.unshift(p); return clone(projOut(p)); },
      async updateProject(pid, partial) { const p = P(pid); for (const k of ['name', 'client', 'dueDate', 'sourceLang', 'targetLang', 'tmIds', 'termbaseIds']) if (k in partial) p[k] = k === 'dueDate' && partial[k] ? new Date(partial[k]).getTime() : partial[k]; p.updatedAt = Date.now(); return clone(projOut(p)); },
      async deleteProject(pid) { const i = PROJECTS.findIndex((p) => p.id === pid); if (i >= 0) PROJECTS.splice(i, 1); },
      async getProject(pid) { const p = P(pid); return clone({ ...projOut(p), files: p.files.map(fileOut) }); },
      async importFiles(pid) { const p = P(pid); await delay(600); const f = { id: id('f'), projectId: pid, name: `catatan-rilis-${p.files.length + 1}.md`, format: 'md', origin: 'import', url: null, createdAt: Date.now(), segs: mkSegs(GUIDE.slice(30, 36).map((x) => (p.sourceLang === 'id' ? x : [x[1], x[0]])), () => 'new') }; p.files.push(f); return clone([fileOut(f)]); },
      async importText(pid, { name, text }) { const p = P(pid); const parts = String(text).split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean); if (!parts.length) throw new Error('Paste some text to import.');
        const f = { id: id('f'), projectId: pid, name: name || 'Pasted text', format: 'txt', origin: 'text', url: null, createdAt: Date.now(), segs: mkSegs(parts.map((x) => [x, '']), () => 'new') }; for (const s of f.segs) REF.delete(s.id); p.files.push(f); return clone(fileOut(f)); },
      async capturePage(tid, pid) { const t = T(tid), p = P(pid); if (t.kind !== 'web' || t.error) throw new Error('Open a web page first, then capture it.'); await delay(500); const pg = pageFor(t.url); const tr = pg.tr?.[p.targetLang];
        const f = { id: id('f'), projectId: pid, name: t.title, format: 'html', origin: 'web', url: t.url, createdAt: Date.now(), segs: mkSegs([[pg.title, tr?.title || ''], ...pg.paras.map((x, i) => [x, tr?.paras[i] || ''])], () => 'new') }; p.files.push(f); return clone(fileOut(f)); },
      async deleteFile(pid, fid) { const p = P(pid); p.files = p.files.filter((f) => f.id !== fid); },
      async getFile(pid, fid, { offset = 0, limit = 500, status: st, q } = {}) { const f = F(pid, fid); const s = (q || '').toLowerCase();
        const all = f.segs.filter((x) => (!st || x.status === st) && (!s || x.source.toLowerCase().includes(s) || x.target.toLowerCase().includes(s))); await delay(f.segs.length > 500 ? 120 : 40);
        return clone({ file: fileOut(f), total: all.length, segments: all.slice(offset, offset + limit) }); },
      async updateSegment(pid, fid, sid, patch) { const p = P(pid), f = F(pid, fid); const s = need(f.segs.find((x) => x.id === sid), 'That segment');
        if (s.locked && patch.locked !== false && ('target' in patch || 'status' in patch)) throw new Error('This segment is locked. Unlock it to make changes.');
        if ('target' in patch && patch.target !== s.target) { s.target = patch.target; s.origin = 'human'; }
        for (const k of ['status', 'locked', 'comment']) if (k in patch) s[k] = patch[k];
        s.updatedAt = Date.now(); p.updatedAt = Date.now();
        if (['translated', 'reviewed', 'approved'].includes(s.status) && s.target) { const tm = TMS.find((t) => t.id === p.tmIds[0]); if (tm) { const u = tm.list.find((x) => x.source === s.source); if (u) u.target = s.target; else tm.list.unshift({ id: id('u'), source: s.source, target: s.target, createdAt: Date.now(), usage: 0 }); tm.updatedAt = Date.now(); } }
        return clone(s); },
      async lookup(pid, text) { await delay(60); return clone(lookup(P(pid), String(text || ''))); },
      async pretranslate(pid, fid, { minScore = 100, useAi = false } = {}) { const p = P(pid), f = F(pid, fid); if (useAi) aiGate(); let fromTm = 0, fromAi = 0; const empty = f.segs.filter((s) => !s.target && !s.locked); let done = 0;
        for (const s of empty) { const m = lookup(p, s.source).matches[0]; if (m && m.score >= minScore) { Object.assign(s, { target: m.target, status: 'draft', origin: 'tm', matchScore: m.score, updatedAt: Date.now() }); fromTm++; }
          else if (useAi && REF.get(s.id)) { Object.assign(s, { target: REF.get(s.id), status: 'draft', origin: 'mt-ai', matchScore: m ? m.score : null, updatedAt: Date.now() }); fromAi++; }
          if (++done % Math.max(1, Math.ceil(empty.length / 8)) === 0) { emit('pretranslate-progress', { projectId: pid, fileId: fid, done, total: empty.length }); await delay(140); } }
        await delay(300); return { filled: fromTm + fromAi, fromTm, fromAi }; },
      async analyze(pid) { const p = P(pid); await delay(500); const names = ['101%', '100%', '95-99%', '85-94%', '75-84%', '50-74%', 'No match', 'Repetitions']; const bands = Object.fromEntries(names.map((b) => [b, { band: b, segments: 0, words: 0 }])); const seen = new Set(); let total = 0;
        for (const f of p.files) for (const s of f.segs) { const w = words(s.source); total += w; let b;
          if (seen.has(s.source)) b = 'Repetitions'; else { seen.add(s.source); const sc = f.segs.length > 300 ? (s.status === 'new' ? 0 : 100) : (lookup(p, s.source).matches[0]?.score || 0); b = sc >= 100 ? (s.status === 'approved' ? '101%' : '100%') : sc >= 95 ? '95-99%' : sc >= 85 ? '85-94%' : sc >= 75 ? '75-84%' : sc >= 50 ? '50-74%' : 'No match'; }
          bands[b].segments++; bands[b].words += w; }
        return { bands: names.map((n) => bands[n]), words: total }; },
      async qa(pid, fid) { const p = P(pid); await delay(250); const files = fid ? [F(pid, fid)] : p.files; const issues = files.flatMap((f) => qaFile(p, f)); const summary = {}; for (const i of issues) summary[i.check] = (summary[i.check] || 0) + 1; return clone({ checked: files.reduce((a, f) => a + f.segs.length, 0), issues, summary }); },
      async export(pid, fid, type) { const f = F(pid, fid); await delay(500); const ext = type === 'original' ? f.format : type; const base = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '-'); const name = `${base}.${P(pid).targetLang}.${ext}`;
        const d = { id: id('d'), filename: name, url: 'lintas://tms/export', state: 'completed', received: 52_000, total: 52_000, savePath: `~/Documents/Lintas/${name}` }; downloads.unshift(d); emit('download', d); return { savedTo: d.savePath }; },
      async listTms() { return clone(TMS.map(tmOut)); },
      async createTm({ name, sourceLang, targetLang }) { if (!name) throw new Error('Give the translation memory a name.'); const t = { id: id('tm'), name, sourceLang, targetLang, updatedAt: Date.now(), list: [] }; TMS.push(t); return clone(tmOut(t)); },
      async deleteTm(tid) { const i = TMS.findIndex((t) => t.id === tid); if (i >= 0) TMS.splice(i, 1); for (const p of PROJECTS) p.tmIds = p.tmIds.filter((x) => x !== tid); },
      async importTmx(tid) { const t = need(TMS.find((x) => x.id === tid), 'That translation memory'); await delay(600); const add = tmUnits(LEGACY_TM.slice(0, 6).map(([s, x]) => [s + ' ', x]), 0); t.list.push(...add); t.updatedAt = Date.now(); return { added: add.length }; },
      async exportTm(tid) { const t = need(TMS.find((x) => x.id === tid), 'That translation memory'); await delay(300); return { savedTo: `~/Documents/Lintas/${t.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.tmx` }; },
      async searchTm(tid, { q, limit = 100 } = {}) { const t = need(TMS.find((x) => x.id === tid), 'That translation memory'); const s = (q || '').toLowerCase(); return clone(t.list.filter((u) => !s || u.source.toLowerCase().includes(s) || u.target.toLowerCase().includes(s)).slice(0, limit)); },
      async listTermbases() { return clone(TBS.map(tbOut)); },
      async createTermbase({ name, sourceLang, targetLang }) { if (!name) throw new Error('Give the termbase a name.'); const t = { id: id('tb'), name, sourceLang, targetLang, updatedAt: Date.now(), list: [] }; TBS.push(t); return clone(tbOut(t)); },
      async deleteTermbase(tid) { const i = TBS.findIndex((t) => t.id === tid); if (i >= 0) TBS.splice(i, 1); for (const p of PROJECTS) p.termbaseIds = p.termbaseIds.filter((x) => x !== tid); },
      async listTerms(tid, { q } = {}) { const t = need(TBS.find((x) => x.id === tid), 'That termbase'); const s = (q || '').toLowerCase(); return clone(t.list.filter((e) => !s || e.source.toLowerCase().includes(s) || e.target.toLowerCase().includes(s) || (e.note || '').toLowerCase().includes(s))); },
      async addTerm(tid, { source, target, status: st = 'preferred', note = '' }) { const t = need(TBS.find((x) => x.id === tid), 'That termbase'); if (!source || !target) throw new Error('A term needs both a source and a target.'); const e = term(source, target, st, note, null); e.createdAt = Date.now(); t.list.unshift(e); t.updatedAt = Date.now(); return clone(e); },
      async updateTerm(tid, eid, partial) { const t = need(TBS.find((x) => x.id === tid), 'That termbase'); const e = need(t.list.find((x) => x.id === eid), 'That term'); Object.assign(e, partial); t.updatedAt = Date.now(); return clone(e); },
      async deleteTerm(tid, eid) { const t = need(TBS.find((x) => x.id === tid), 'That termbase'); t.list = t.list.filter((x) => x.id !== eid); },
      async importTermbase(tid) { const t = need(TBS.find((x) => x.id === tid), 'That termbase'); await delay(500); const add = [term('dompet digital', 'e-wallet'), term('uang kembalian', 'change'), term('nontunai', 'cashless', 'preferred', '', 'adj')]; t.list.push(...add); return { added: add.length }; },
      async exportTermbase(tid) { const t = need(TBS.find((x) => x.id === tid), 'That termbase'); await delay(300); return { savedTo: `~/Documents/Lintas/${t.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.tbx` }; },
    },
    ai: {
      async suggest(pid, fid, sid) { aiGate(); const p = P(pid), f = F(pid, fid); const s = need(f.segs.find((x) => x.id === sid), 'That segment'); await delay(900); const lk = lookup(p, s.source); const pref = lk.terms.filter((t) => t.status === 'preferred');
        const target = REF.get(sid) || lk.matches[0]?.target || s.source;
        return { target, rationale: pref.length ? `Follows the termbase: ${pref.map((t) => `“${t.source}” → “${t.target}”`).join(', ')}.${lk.matches[0] ? ` Adapted from a ${lk.matches[0].score}% TM match.` : ''}` : (lk.matches[0] ? `Adapted from a ${lk.matches[0].score}% TM match and the surrounding segments.` : 'Translated from context; no TM match or termbase entry applied.'), usedMatches: lk.matches.length, usedTerms: pref.length }; },
      async review(pid, fid, sid) { aiGate(); const p = P(pid), f = F(pid, fid); const s = need(f.segs.find((x) => x.id === sid), 'That segment'); if (!s.target) throw new Error('There is no translation to review yet.'); await delay(1000);
        const issues = qaFile(p, { segs: [s] }).filter((i) => i.severity !== 'minor').map((i) => ({ category: i.check === 'forbidden-term' ? 'Terminology' : i.check === 'numbers' ? 'Accuracy' : 'Locale convention', severity: i.severity, explanation: i.message, suggestion: i.check === 'forbidden-term' ? 'Use the preferred termbase equivalent.' : 'Align the value with the source text.' }));
        const ref = REF.get(sid);
        if (!issues.length && ref && ref !== s.target) issues.push({ category: 'Style', severity: 'minor', explanation: 'The meaning is correct, but the phrasing can be more natural and closer to the client style.', suggestion: ref });
        return { verdict: issues.length ? 'revise' : 'ok', issues, revised: issues.length && ref ? ref : null }; },
      async translatePage(tid, { targetLang, projectId } = {}) { aiGate(); const t = T(tid); if (t.kind !== 'web' || t.error) throw new Error('Open a web page to translate it.'); const pg = pageFor(t.url);
        if (!pg.tr?.[targetLang]) { if (pg.lang === targetLang) throw new Error('This page is already in that language.'); throw new Error(`Preview mode has no sample translation of this page into ${targetLang.toUpperCase()}.`); }
        const total = pg.paras.length + 1; for (let d = 1; d <= total; d++) { await delay(220); emit('translate-progress', { tabId: tid, done: d, total }); }
        t.translated = { targetLang }; changed(); const fromTm = projectId ? Math.min(2, total) : 0; return { translated: total, fromTm, fromAi: total - fromTm }; },
      async restorePage(tid) { T(tid).translated = null; changed(); },
      async translateText(text, { targetLang, projectId } = {}) { aiGate(); await delay(800); const src = String(text).trim();
        for (const [a, b] of [...GUIDE, ...PRESS]) { if (a === src) return { text: b }; if (b === src) return { text: a }; } for (const [a, b] of PRIVACY) { if (a === src) return { text: b }; if (b === src) return { text: a }; }
        for (const pg of Object.values(PAGES)) { const tr = pg.tr[targetLang]; const i = pg.paras.findIndex((x) => x === src || x.includes(src)); if (tr && i >= 0) return { text: tr.paras[i] }; }
        return { text: targetLang === 'id' ? `(Pratinjau) Terjemahan untuk: ${src}` : `(Preview) Translation of: ${src}` }; },
      async selection(tid) { const s = String(window.getSelection?.() || '').trim(); if (s) return s; const t = T(tid); const pg = t.kind === 'web' ? pageFor(t.url) : null; return pg && !pg.generic ? pg.paras[2] || pg.paras[0] : ''; },
      async ask(tid, question) { aiGate(); const t = T(tid); if (t.kind !== 'web' || t.error) throw new Error('Open a web page to ask about it.'); await delay(1100); const pg = pageFor(t.url);
        const n = Math.min(3, pg.paras.length); const cited = pg.answer ? [...new Set((pg.answer.match(/\[(\d+)\]/g) || []).map((x) => Number(x.slice(1, -1))))] : Array.from({ length: n }, (_, i) => i + 1);
        const answer = /term|istilah|gloss/i.test(question) && pg.lang === 'id' ? 'Candidate terms on this page, with suggested English equivalents:\n\n- **UMKM** → MSME [1]\n- **nontunai** → cashless [1]\n- **dompet digital** → e-wallet [3]\n- **uang kembalian** → change [4]\n- **luring** → offline [6]\n\nYou can add any of these from the **Terms** tab.'
          : (pg.answer || `This page is about **${pg.title}** [1]. ${pg.paras.length > 1 ? 'It goes on to give supporting details [2]' + (n > 2 ? ' and next steps [3].' : '.') : ''}`);
        return { answer, citations: cited.filter((c) => c <= pg.paras.length).map((c) => ({ n: c, quote: pg.paras[c - 1].slice(0, 140) })) }; },
      async highlight(tid, n) { const st = pageState.get(tid) || {}; pageState.set(tid, st); st.highlight = n; draw(); setTimeout(() => { if (st.highlight === n) { st.highlight = null; draw(); } }, 2600); },
      async extractTerms(pid, fid) { aiGate(); const p = P(pid); F(pid, fid); await delay(1200); return { terms: p.sourceLang === 'id'
        ? [{ source: 'kode OTP', target: 'OTP code', note: 'Keep the acronym.', frequency: 3 }, { source: 'harga jual', target: 'selling price', note: '', frequency: 2 }, { source: 'metode pembayaran', target: 'payment method', note: '', frequency: 4 }, { source: 'hari kerja', target: 'working days', note: 'UK usage per style guide.', frequency: 2 }, { source: 'pemberitahuan', target: 'notification', note: '', frequency: 5 }]
        : [{ source: 'account', target: 'akun', note: '', frequency: 4 }, { source: 'transaction data', target: 'data transaksi', note: '', frequency: 2 }, { source: 'email address', target: 'alamat email', note: 'KBBI: "email" tidak baku; klien memakai "email".', frequency: 2 }] }; },
      async usage() { return clone(usage); },
    },
    /* preview-only helpers used by the chrome when the mock is active */
    __preview: {
      bounds: null, visible: true,
      mount(el, tab) { host = el; hostTab = tab?.id ?? null; draw(); },
      actions: [
        { label: 'Trigger a permission prompt', icon: 'mapPin', run() { const t = tabs.find((x) => x.active); emit('permission', { requestId: id('perm'), tabId: t?.id, origin: t?.kind === 'web' ? new URL(t.url).origin : 'https://peta.example', permission: 'geolocation', detail: '' }); } },
        { label: 'Trigger a camera/microphone prompt', icon: 'mic', run() { const t = tabs.find((x) => x.active); emit('permission', { requestId: id('perm'), tabId: t?.id, origin: 'https://rapat.example', permission: 'media', detail: 'camera and microphone' }); } },
        { label: 'Simulate a download', icon: 'download', run() { const d = { id: id('d'), filename: 'kamus-istilah-keuangan.xlsx', url: 'https://glosarium.example/kamus-istilah-keuangan.xlsx', state: 'progressing', received: 0, total: 6_400_000, savePath: '~/Downloads/kamus-istilah-keuangan.xlsx' }; downloads.unshift(d); emit('download', d);
          const iv = setInterval(() => { if (d.state !== 'progressing') return clearInterval(iv); d.received = Math.min(d.total, d.received + 520_000); if (d.received >= d.total) { d.state = 'completed'; clearInterval(iv); } emit('download', d); }, 350); } },
        { label: 'Go offline / online', icon: 'wifiOff', run() { status.online = !status.online; emit('online', { online: status.online }); emit('toast', { kind: 'info', message: status.online ? 'Back online.' : 'You are offline. Saved pages and the TMS keep working.' }); } },
        { label: 'Open a page that fails to load', icon: 'warning', run() { const t = tabs.find((x) => x.active); load(t, 'https://www.nxdomain.example/laporan', {}); changed(); } },
        { label: 'Open an HTTPS-only failure', icon: 'lock', run() { const t = tabs.find((x) => x.active); load(t, 'https://www.http-only.example/arsip', {}); changed(); } },
        { label: 'Open a private tab', icon: 'private', run() { api.tabs.create({ private: true }); } },
        { label: 'Context menu: “Add to termbase…”', icon: 'book', run() { const t = tabs.find((x) => x.active); emit('context', { action: 'add-term', tabId: t?.id, selection: 'dompet digital', pageURL: t?.url }); } },
        { label: 'Toggle API key (has / none)', icon: 'key', run() { status.hasApiKey = !status.hasApiKey; emit('toast', { kind: 'info', message: status.hasApiKey ? 'Preview: API key present.' : 'Preview: no API key.' }); } },
      ],
      setPlatform(p) { status.platform = p; },
    },
  };
  window.lintas = api;
  return api;
}
