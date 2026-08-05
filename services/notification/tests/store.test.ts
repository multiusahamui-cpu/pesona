import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryInboxStore, InMemoryDeviceStore } from '../src/store.js';
import type { InboxEntry, DeviceRegistration } from '../src/domain/types.js';

const T0 = 1_770_000_000_000;

function entry(over: Partial<InboxEntry> = {}): InboxEntry {
  return {
    dedupeKey: 'DK-1',
    recipientId: 'CUST-1',
    kind: 'ORDER_STATUS',
    priority: 'HIGH',
    title: 'Judul',
    body: 'Isi',
    createdAt: T0,
    expiresAt: null,
    readAt: null,
    ...over,
  };
}

function device(over: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    deviceId: 'DEV-1',
    recipientId: 'CUST-1',
    shell: 'native-webview',
    platform: 'android',
    pushToken: 'token-1',
    lastSeenAt: T0,
    ...over,
  };
}

describe('InMemoryInboxStore', () => {
  let store: InMemoryInboxStore;

  beforeEach(() => {
    store = new InMemoryInboxStore();
  });

  it('menyimpan dan mengembalikan entri per penerima, terpisah dari penerima lain', async () => {
    await store.append('CUST-1', entry({ dedupeKey: 'DK-1' }));
    await store.append('CUST-2', entry({ dedupeKey: 'DK-2', recipientId: 'CUST-2' }));

    expect(await store.listForRecipient('CUST-1')).toHaveLength(1);
    expect(await store.listForRecipient('CUST-2')).toHaveLength(1);
    expect(await store.listForRecipient('TIDAK-ADA')).toEqual([]);
  });

  it('dedupeKeysForRecipient mencerminkan seluruh kunci yang pernah ditulis', async () => {
    await store.append('CUST-1', entry({ dedupeKey: 'DK-1' }));
    await store.append('CUST-1', entry({ dedupeKey: 'DK-2' }));

    const keys = await store.dedupeKeysForRecipient('CUST-1');
    expect(keys.has('DK-1')).toBe(true);
    expect(keys.has('DK-2')).toBe(true);
    expect(keys.has('DK-3')).toBe(false);
  });

  it('markRead menandai entri yang cocok dan mengembalikan true', async () => {
    await store.append('CUST-1', entry({ dedupeKey: 'DK-1' }));

    const ok = await store.markRead('CUST-1', 'DK-1', T0 + 1_000);
    expect(ok).toBe(true);

    const [readEntry] = await store.listForRecipient('CUST-1');
    expect(readEntry?.readAt).toBe(T0 + 1_000);
  });

  it('markRead mengembalikan false untuk entri atau penerima yang tidak ada — bukan melempar', async () => {
    await store.append('CUST-1', entry({ dedupeKey: 'DK-1' }));

    expect(await store.markRead('CUST-1', 'TIDAK-ADA', T0)).toBe(false);
    expect(await store.markRead('TIDAK-ADA', 'DK-1', T0)).toBe(false);
  });
});

describe('InMemoryDeviceStore', () => {
  let store: InMemoryDeviceStore;

  beforeEach(() => {
    store = new InMemoryDeviceStore();
  });

  it('mendaftarkan beberapa perangkat untuk satu penerima', async () => {
    await store.register(device({ deviceId: 'DEV-1' }));
    await store.register(device({ deviceId: 'DEV-2' }));

    const list = await store.listForRecipient('CUST-1');
    expect(list.map((d) => d.deviceId).sort()).toEqual(['DEV-1', 'DEV-2']);
  });

  it('registrasi ulang deviceId yang sama menimpa, bukan menumpuk', async () => {
    await store.register(device({ deviceId: 'DEV-1', pushToken: 'lama' }));
    await store.register(device({ deviceId: 'DEV-1', pushToken: 'baru' }));

    const list = await store.listForRecipient('CUST-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.pushToken).toBe('baru');
  });

  it('perangkat penerima lain tidak ikut muncul', async () => {
    await store.register(device({ deviceId: 'DEV-1', recipientId: 'CUST-1' }));
    await store.register(device({ deviceId: 'DEV-2', recipientId: 'CUST-2' }));

    expect(await store.listForRecipient('CUST-1')).toHaveLength(1);
    expect(await store.listForRecipient('TIDAK-ADA')).toEqual([]);
  });
});
