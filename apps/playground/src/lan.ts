import qrcode from 'qrcode-generator';
import { h } from './dom.js';

/** LAN addresses of the Vite server (the `lan-info` plugin in vite.config.ts). */
async function fetchNetworkUrls(): Promise<string[]> {
  try {
    const res = await fetch('/__playground/lan');
    if (!res.ok) return [];
    const data = (await res.json()) as { network?: string[] };
    // Loopback is useless for other devices; home/office LAN addresses come first.
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

/** Popover with a QR code to open the same scenario on an iPad or phone on the local network. */
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
          // Long URLs (for example JSON in the query) make the QR too dense; opening the scenario is enough.
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
