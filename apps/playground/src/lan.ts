import qrcode from 'qrcode-generator';
import { h } from './dom.js';

/** Alamat LAN dari server Vite (plugin `lan-info` di vite.config.ts). */
async function fetchNetworkUrls(): Promise<string[]> {
  try {
    const res = await fetch('/__playground/lan');
    if (!res.ok) return [];
    const data = (await res.json()) as { network?: string[] };
    // Loopback tidak berguna untuk perangkat lain; alamat LAN rumah/kantor didahulukan.
    const rank = (url: string) => {
      const host = new URL(url).hostname;
      return host.startsWith('192.168.') ? 0 : host.startsWith('10.') ? 1 : 2;
    };
    return (data.network ?? [])
      .filter((url) => !new URL(url).hostname.startsWith('127.'))
      .sort((a, b) => rank(a) - rank(b));
  } catch {
    return [];
  }
}

function qrImage(url: string): HTMLImageElement {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return h('img', {
    src: qr.createDataURL(4, 2),
    alt: `QR code untuk ${url}`,
    width: 164,
    height: 164,
  });
}

/** Popover berisi QR code untuk membuka skenario yang sama di iPad atau HP di jaringan lokal. */
export async function buildLanPopover(): Promise<HTMLElement> {
  const pathAndQuery = `${location.pathname}${location.search}`;
  const bases = await fetchNetworkUrls();
  const body =
    bases.length === 0
      ? [
          h(
            'p',
            {},
            'Alamat LAN tidak tersedia. Jalankan dengan ',
            h('code', {}, 'pnpm playground'),
            ' (sudah memakai --host) dan pastikan perangkat di jaringan yang sama.',
          ),
        ]
      : bases.map((base) => {
          // URL panjang (misalnya JSON di query) membuat QR terlalu padat; cukup buka skenarionya.
          const full = new URL(pathAndQuery, base).toString();
          const url = full.length > 600 ? new URL(location.pathname, base).toString() : full;
          return h(
            'div',
            { class: 'qr-item' },
            qrImage(url),
            h('a', { href: url, target: '_blank', rel: 'noreferrer' }, url),
          );
        });
  return h(
    'div',
    { class: 'popover', role: 'dialog', 'aria-label': 'Buka di perangkat lain' },
    h('strong', {}, 'Buka di perangkat lain'),
    ...body,
  );
}
