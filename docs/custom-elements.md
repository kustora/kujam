# Custom Elements: External Data, `render.html`, and Security

A guide for plugin authors building elements whose data comes from the app (BOARD-604, BOARD-1201, BOARD-1202, BOARD-1203, BOARD-1206). The examples use a generic post card.

## 1. Resolvers in the app

The app registers a data fetcher per name. It may return the data directly (from the app's cache), a `Promise`, or a `ResolveError`:

```ts
const board = createBoard({
  plugins: [defaultElements, defaultTools, postPlugin],
  resolvers: {
    post: async (id) => {
      const res = await fetch(`/api/posts/${encodeURIComponent(id)}`);
      if (res.status === 403) return { status: 'forbidden' };
      if (res.status === 404) return { status: 'not-found' };
      if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
      return (await res.json()) as Post;
    },
  },
});
```

- Results are cached per `(resolver, id)`. In-flight requests are shared, so ten cards for the same post call `post` only once.
- Failures (an exception or a rejected promise) are **not** cached. The element shows an error with a "Try again" button (`board.reloadElementData(id)`).
- When the data changes in the app, call `board.invalidate('post', id)`. Only the elements using that post are reloaded and updated. `board.invalidate('post')` drops the whole `post` resolver cache.

## 2. The element

```ts
const postCard = defineElement({
  type: 'post-card',
  version: 1,
  props: schema({ postId: string() }),
  defaults: { postId: '' },
  // Derives the element's data from its props. The (resolver, id) pairs called here are
  // recorded, so invalidate only touches the elements that actually use them.
  resolve: (el, ctx) => ctx.resolvers.post!(el.props.postId) as Post | Promise<Post>,
  placeholder: (reason) => ({ label: reason === 'forbidden' ? 'Private post' : '' }),
  render: {
    html(host, el, data) {
      const title = host.ownerDocument.createElement('strong');
      const like = host.ownerDocument.createElement('button');
      like.dataset.boardInteractive = ''; // the only area that receives clicks
      like.textContent = 'Like';
      host.append(title, like);
      const show = (post?: Post) => {
        title.textContent = post?.title ?? ''; // textContent, not innerHTML
      };
      show(data);
      return { update: (_el, next) => show(next), destroy() {} };
    },
  },
});
```

Lifecycle:

| When                                     | What happens                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| The element enters the viewport          | `resolve` runs (once, then cached), then `render.html(host, el, data, ctx)`.         |
| Data is loading                          | An element-sized skeleton. Replace it with `placeholder('loading')`.                 |
| `forbidden` / `not-found`                | `placeholder(reason)`, or the built-in label. Data is **never** shown.               |
| `error`                                  | An error placeholder with a "Try again" button.                                      |
| The record or the data changes           | `update(el, data)`. Panning or zooming the camera does **not** call `update`.        |
| `invalidate` with an async resolver      | The old view stays visible until the new data arrives, then `update`.                |
| Leaves the viewport, deleted, or unmount | `destroy()`.                                                                         |
| Props change                             | `resolve` runs again. Moving or resizing the element does not trigger a new resolve. |

`render.canvas`, `actions`, and `a11y` receive the same `data` once it is ready. A canvas element with `resolve` is drawn as a placeholder until its data is ready.

### Pointer

The element host forwards pointer events to the board tools (select, move, resize), so HTML cards can be selected and moved like any other element. Only nodes marked `data-board-interactive` receive their own clicks and typing, for example buttons, links, or inputs.

### Error isolation

An exception in `resolve`, a resolver, `render.html`, `update`, `render.canvas`, `actions`, or `a11y` only affects that element: it shows an error placeholder and the board emits an `error` event (`resolve-error`, `render-error`, `action-error`). Other elements keep rendering.

### Drop targets (BOARD-1208)

An element can accept other elements dropped onto it with the select tool:

```ts
dropTarget: {
  accepts: (dropped) => dropped.type === 'item-card',
  onDrop(target, dropped, point, ctx) {
    ctx.updateProps({ itemIds: [...target.props.itemIds, String(dropped.props.itemId)] });
    ctx.removeDropped(); // without this, the dropped element stays where it was released
  },
},
```

While an accepted element is dragged over the target, the overlay highlights the target. The move plus `onDrop` is one transaction and one undo step. `accepts` must be cheap and free of side effects; errors in `accepts` or `onDrop` are reported as an `error` event of kind `plugin-error`, and an `onDrop` that throws cancels all of the drop's changes (the move itself stays).

### Pasting URLs (BOARD-1209)

A plugin can turn a pasted URL into an element, for example a link card:

```ts
definePlugin({
  id: 'example.link-card',
  elements: [linkCard], // resolve: (el, ctx) => ctx.resolvers.linkPreview(el.props.url)
  onPasteUrl: (url) => ({ type: 'link-card', w: 320, h: 120, props: { url } }),
});
```

The hook must be synchronous and return an `ElementInput` or `null`; the first plugin (in install order) that returns an element wins, and the paste is one undo step. Only `http:` and `https:` URLs reach the hook. The packages do **not** fetch the URL: the host fetches preview metadata (preferably on its server) through a resolver, so the element appears immediately in a loading state and then fills in. A hook that throws is reported as `plugin-error` and the next plugin is tried; if none handles it, the URL is pasted as text.

## 3. Security (ADR-009, T8)

Plugin code runs with full privileges on the app's origin, so the packages cannot protect against a malicious plugin. What can (and must) be prevented is untrusted **data** entering the DOM as code. Element props and resolver data are untrusted: both can come from collaboration peers, imported files, or a server.

- **Text:** use `textContent` or `createTextNode`. Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` with props or data. This repository's ESLint rules forbid them in packages; apply the same rule in plugins.
- **Links and images:** pass URLs through `sanitizeUrl` / `isSafeUrl` from `@kujam/core` before setting `href` or `src`; open links with `safeLinkAttributes()` (`rel="noopener noreferrer"`).
- **Styles:** set them through the CSSOM (`el.style.color = …`); never build a `style` attribute or a `<style>` element from data. This is also what lets the board run under a strict CSP (`docs/csp.md`).
- **Iframes:** never create an iframe from a URL in props. Use the official embed element `createEmbedElement({ domains })` from `@kujam/shapes` (BOARD-1107), which uses `sandbox` and an origin allow-list.
- **Placeholders:** `placeholder(reason)` does not receive data, so a `forbidden` element cannot leak the content it hides.
- **Resolvers:** check permissions on the server or in the app, then return `{ status: 'forbidden' }`; do not rely on the element to hide data that has already been sent.
