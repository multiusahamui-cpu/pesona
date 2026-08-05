import { pgTable, text, bigint, serial, uuid, index } from 'drizzle-orm/pg-core';

/**
 * Tabel buku besar — modul 13.
 *
 * Dua tabel, mengikuti persis bentuk `JournalEntry`/`JournalLine` di
 * ../service/ledger.ts: satu header (`journal_entries`), satu baris per
 * sisi debit/kredit (`journal_lines`). `DrizzleLedger`
 * (../repo/drizzle-ledger.ts) memetakan keduanya <-> tipe domain.
 *
 * APPEND-ONLY. Tidak ada UPDATE di sini dan tidak akan pernah ada —
 * koreksi jurnal dilakukan lewat jurnal pembalik baru (jurnal koreksi),
 * bukan mengubah baris lama. Itulah yang membuat rekonsiliasi bisa
 * dipercaya sebagai jejak audit.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    // uuid dibuat di application layer (randomUUID()), bukan
    // defaultRandom() SQL — supaya tidak bergantung pada extension
    // pgcrypto tersedia atau tidak di instance Postgres tujuan.
    id: uuid('id').primaryKey(),
    code: text('code').notNull(), // JournalCode: JRN-P01..P05
    orderId: text('order_id').notNull(),
    // Epoch milidetik — sama seperti orders.createdAt.
    at: bigint('at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('journal_entries_order_idx').on(table.orderId),
    index('journal_entries_code_idx').on(table.code),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: serial('id').primaryKey(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    account: text('account').notNull(), // AccountCode, mis. '1-1101'
    debit: bigint('debit', { mode: 'number' }).notNull(),
    credit: bigint('credit', { mode: 'number' }).notNull(),
    /** Buku pembantu: nomor order atau ID anggota. Nullable — tidak semua baris punya. */
    subledger: text('subledger'),
  },
  (table) => [
    index('journal_lines_entry_idx').on(table.entryId),
    index('journal_lines_account_idx').on(table.account),
    index('journal_lines_account_subledger_idx').on(table.account, table.subledger),
  ],
);
