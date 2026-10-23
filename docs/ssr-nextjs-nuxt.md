# Server-Side Rendering (SSR) Guide: Next.js and Nuxt 3

Architecture and best practices for running `@kujam/react` and `@kujam/vue` in Server-Side Rendering (SSR) environments such as Next.js and Nuxt 3 (BOARD-1308).

---

## 1. kujam's SSR architecture

An interactive whiteboard depends on browser APIs (`HTMLCanvasElement`, 2D/WebGL contexts, `PointerEvent` listeners, `ResizeObserver`, and the DOM). Modern web apps, however, often run on hybrid SSR frameworks such as Next.js or Nuxt.

kujam's SSR design follows these principles:
1. **Safe to import on the server (zero evaluation on import)**:
   Importing `@kujam/core`, `@kujam/renderer`, `@kujam/react`, or `@kujam/vue` in Node.js never throws `window is not defined` or `document is not defined`.
2. **Renderer mounting is deferred to the client**:
   `mountRenderer` from `@kujam/renderer` is only called in the browser mount lifecycle (`useEffect` in React, `onMounted` in Vue). The server never tries to create a canvas element or attach input listeners.
3. **Consistent container markup (no hydration mismatch)**:
   During SSR, `<Board>` renders a placeholder `<div>` with the same size and relative positioning as on the client (`width: 100%; height: 100%; position: relative`), which prevents layout shift during hydration.

---

## 2. Next.js (React)

### App Router (Next.js 13+)

In the Next.js App Router (the `app/` directory), every component is a React Server Component (RSC) by default. Components that use `<Board>` or kujam hooks need client interactivity, so they must have the `'use client'` directive.

#### Standard pattern: a client component wrapper

Create a client-side wrapper component for the whiteboard:

```tsx
// app/components/Whiteboard.tsx
'use client';

import { useMemo, useEffect } from 'react';
import { createBoard } from '@kujam/core';
import { Board } from '@kujam/react';

export default function Whiteboard() {
  // 1. Create the board instance once with useMemo
  const board = useMemo(() => {
    return createBoard({
      // Register plugins and tools here
    });
  }, []);

  // 2. Release the board's resources when the component is permanently unmounted
  useEffect(() => {
    return () => {
      board.dispose();
    };
  }, [board]);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Board
        board={board}
        theme="light"
        background="dots"
      />
    </div>
  );
}
```

Then use it directly in the page's Server Component:

```tsx
// app/page.tsx
import Whiteboard from './components/Whiteboard';

export default function Page() {
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Whiteboard />
    </main>
  );
}
```

#### Alternative pattern: dynamic import with `ssr: false`

If you use a plugin or storage adapter that touches browser storage when its module loads, or you want a custom skeleton while loading:

```tsx
// app/page.tsx
'use client';

import dynamic from 'next/dynamic';

const Whiteboard = dynamic(() => import('./components/Whiteboard'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <p>Loading whiteboard...</p>
    </div>
  ),
});

export default function Page() {
  return <Whiteboard />;
}
```

### Pages Router (classic Next.js)

In the Pages Router (`pages/index.tsx`), wrapping the whiteboard in a dynamic import with `ssr: false` is recommended:

```tsx
// pages/index.tsx
import dynamic from 'next/dynamic';

const Whiteboard = dynamic(() => import('../components/Whiteboard'), {
  ssr: false,
});

export default function HomePage() {
  return <Whiteboard />;
}
```

---

## 3. Nuxt 3 (Vue)

Nuxt 3 runs `<script setup>` blocks on both the server and the client by default.

#### Pattern 1: `<ClientOnly>`

The built-in `<ClientOnly>` component makes sure `<Board>` only renders on the client:

```vue
<!-- pages/board.vue -->
<script setup lang="ts">
import { shallowRef, onMounted, onBeforeUnmount } from 'vue';
import { createBoard, type Board as CoreBoard } from '@kujam/core';
import { Board } from '@kujam/vue';

const board = shallowRef<CoreBoard | null>(null);

onMounted(() => {
  board.value = createBoard({
    // plugins, tools
  });
});

onBeforeUnmount(() => {
  board.value?.dispose();
});
</script>

<template>
  <div style="width: 100vw; height: 100vh;">
    <ClientOnly>
      <Board v-if="board" :board="board" theme="light" background="dots" />
      <template #fallback>
        <div class="loading-state">
          <span>Loading whiteboard...</span>
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
```

#### Pattern 2: client-only components (`.client.vue`)

Nuxt 3 automatically isolates components whose file name ends in `.client.vue`, so their code never runs on the server:

```vue
<!-- components/Whiteboard.client.vue -->
<script setup lang="ts">
import { shallowRef, onBeforeUnmount } from 'vue';
import { createBoard } from '@kujam/core';
import { Board } from '@kujam/vue';

// Safe to create the board directly in script setup because this file is .client.vue
const board = shallowRef(createBoard());

onBeforeUnmount(() => {
  board.value.dispose();
});
</script>

<template>
  <div style="width: 100vw; height: 100vh;">
    <Board :board="board" theme="light" background="dots" />
  </div>
</template>
```

Then use it on any page without an extra wrapper:

```vue
<!-- pages/index.vue -->
<template>
  <main>
    <Whiteboard />
  </main>
</template>
```

---

## 4. Board management best practices

### Avoid recreating the instance on re-render

- **React**:
  Use `useMemo(() => createBoard(...), [])` or `useRef(null)`. Never call `createBoard()` directly in the render body without memoizing it: every re-render would create a new board and remount the canvas.
- **Vue**:
  Always use `shallowRef(createBoard(...))` or `shallowRef<Board | null>(null)`. Do **not** use a deep `ref` or `reactive()`: a Board instance has internal methods and Yjs/event emitter state that Vue's reactivity system should not proxy.

### React 18 & 19 StrictMode

In development with StrictMode on, React runs effects twice (`mount` -> `unmount` -> `mount`).
- `<Board>` is StrictMode-safe: the old renderer view is unmounted and cleaned up, then a new view is mounted without leaking memory.
- **Warning**: do not call `board.dispose()` in the cleanup of an effect that can run again on re-render. `board.dispose()` makes the board permanently unusable. Only call `dispose()` when the component's lifecycle has truly ended.

### Initializing storage and client networking

Local storage such as `@kujam/storage-indexeddb` and WebRTC/WebSocket sync (`@kujam/sync-yjs`) need browser APIs (`window.indexedDB`, `window.WebSocket`, and so on).
- Initialize these providers in a client hook:
  - React: inside `useEffect(() => { ... }, [])`.
  - Vue: inside `onMounted(() => { ... })` or a `.client.vue` component.
