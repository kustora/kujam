# Content Security Policy (`BOARD-2006`)

The `@kujam/*` packages run under a strict Content Security Policy (CSP): **no `unsafe-eval`** and **no `unsafe-inline`** for scripts or styles. No package (and none of their dependencies: `yjs`, `lib0`, `y-protocols`, `y-indexeddb`, `perfect-freehand`) uses `eval`, `new Function`, or inline scripts.

## Recommended policy

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' blob: data:;
  connect-src 'self' wss://sync.example.com https://api.example.com;
  frame-src 'none';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none'
```

Adjust the directives to the features you use:

| Directive     | What it needs                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`  | `'self'` (or the CDN origin that serves your bundle) is enough. Neither `unsafe-eval` nor `unsafe-inline` is needed.                                                                         |
| `style-src`   | `'self'` is enough. See [Styles](#styles) for older browsers.                                                                                                                                |
| `img-src`     | `blob:` for dropped or pasted images (object URLs, `BOARD-908`); `data:` only if documents store raster images as `data:` URLs. Add your `AssetResolver` origin if it differs.               |
| `connect-src` | The `@kujam/sync-yjs` endpoint (a `wss:` WebSocket, for example Hocuspocus) and the `@kujam/storage-http` endpoint.                                                                          |
| `font-src`    | Only if your app loads the Inter font itself; the UI falls back to system fonts.                                                                                                             |
| `frame-src`   | `'none'` if you do not use embed elements. If you do (`createEmbedElement`, `BOARD-1107`), list the same origins as its `domains`, for example `frame-src https://www.youtube-nocookie.com`. |

## Styles

- **`@kujam/ui`** installs each component's styles as a _Constructable Stylesheet_ (`shadowRoot.adoptedStyleSheets`), one shared sheet per component type. CSP does not apply to these sheets, so `style-src 'self'` is enough. Browsers without `adoptedStyleSheets` (Safari < 16.4, Firefox < 101, Chrome < 73) fall back to a `<style>` element in the shadow root, which a strict policy **blocks**. For those browsers, add `style-src 'unsafe-inline'`.
- **`@kujam/renderer`**, **`@kujam/shapes`**, and the text editor set styles only through the CSSOM (`el.style.left = …`, `style.setProperty`), which `style-src-attr` does not restrict. There are no `style` attributes in markup and no `setAttribute('style', …)`; pasted HTML is sanitized and its `style` attributes are dropped (`BOARD-2001`).
- Custom elements that render HTML (`render.html`) are the plugin's responsibility: follow the same rules (CSSOM, not `style` attributes or `<style>`).

## Testing

`e2e/csp.spec.ts` opens the playground with `?csp=1`. The dev server then sends the strict policy above (with a nonce only for the playground's own `<style>` and the tags Vite injects), and the test fails on any CSP violation coming from the packages:

```bash
pnpm test:e2e e2e/csp.spec.ts
```

Note: WebKit reports `style-src-attr` for the built-in shadow tree of every `<select>` element. The packages do not use `<select>`; reports from the playground shell are ignored by the test.
