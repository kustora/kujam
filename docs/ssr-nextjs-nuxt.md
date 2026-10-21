# Panduan Server-Side Rendering (SSR): Next.js & Nuxt 3

Panduan arsitektur dan praktik terbaik untuk menjalankan `@kujam/react` dan `@kujam/vue` di lingkungan Server-Side Rendering (SSR) seperti Next.js dan Nuxt 3 (BOARD-1308).

---

## 1. Arsitektur SSR Kujam

Papan tulis (whiteboard) interaktif pada dasarnya bergantung pada API browser (`HTMLCanvasElement`, context 2D/WebGL, listener `PointerEvent`, `ResizeObserver`, dan DOM). Namun, aplikasi web modern sering kali berjalan pada framework hybrid SSR seperti Next.js atau Nuxt.

Desain SSR di Kujam berpegang pada prinsip:
1. **Aman diimpor di server (Zero-eval on import)**:
   Mengimpor `@kujam/core`, `@kujam/renderer`, `@kujam/react`, maupun `@kujam/vue` di Node.js tidak akan memicu error `window is not defined` atau `document is not defined`.
2. **Mounting renderer ditunda ke klien**:
   Fungsi `mountRenderer` dari `@kujam/renderer` hanya dipanggil saat siklus hidup mount browser (`useEffect` di React, `onMounted` di Vue). Sisi server tidak pernah mencoba membuat elemen canvas atau memasang listener input.
3. **Markup kontainer konsisten (No Hydration Mismatch)**:
   Saat SSR, komponen `<Board>` merender kontainer placeholder `<div>` dengan dimensi dan gaya posisi relatif yang sama seperti di klien (`width: 100%; height: 100%; position: relative`), mencegah layout shift saat hidrasi.

---

## 2. Next.js (React)

### App Router (Next.js 13+)

Di Next.js App Router (direktori `app/`), semua komponen secara default adalah React Server Components (RSC). Komponen yang menggunakan `<Board>` atau hooks Kujam memerlukan interaktivitas klien, sehingga harus diberi direktif `'use client'`.

#### Pola Standar: Client Component Wrapper

Buat komponen client-side wrapper untuk papan tulis:

```tsx
// app/components/Whiteboard.tsx
'use client';

import { useMemo, useEffect } from 'react';
import { createBoard } from '@kujam/core';
import { Board } from '@kujam/react';

export default function Whiteboard() {
  // 1. Buat instance board sekali menggunakan useMemo
  const board = useMemo(() => {
    return createBoard({
      // Daftarkan plugins dan tools di sini
    });
  }, []);

  // 2. Bersihkan resource board saat komponen dilepas secara permanen
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

Kemudian gunakan langsung di Server Component halaman:

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

#### Pola Alternatif: Dynamic Import dengan `ssr: false`

Jika Anda menggunakan plugin atau adaptor penyimpanan yang secara eksplisit mengakses browser storage saat modul dimuat, atau ingin menampilkan skeleton khusus selama pemuatan:

```tsx
// app/page.tsx
'use client';

import dynamic from 'next/dynamic';

const Whiteboard = dynamic(() => import('./components/Whiteboard'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <p>Memuat papan tulis...</p>
    </div>
  ),
});

export default function Page() {
  return <Whiteboard />;
}
```

### Pages Router (Next.js Klasik)

Di Pages Router (`pages/index.tsx`), dynamic import dengan `ssr: false` direkomendasikan untuk membungkus papan tulis:

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

Nuxt 3 mengeksekusi blok `<script setup>` di server dan klien secara default.

#### Pola 1: Menggunakan `<ClientOnly>`

Komponen bawaan `<ClientOnly>` memastikan rendering komponen `<Board>` hanya berjalan di sisi klien:

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
          <span>Memuat papan tulis...</span>
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
```

#### Pola 2: Komponen Khusus Klien (`.client.vue`)

Nuxt 3 otomatis mengisolasi komponen yang memiliki akhiran nama file `.client.vue` sehingga kode tidak akan pernah dieksekusi di server:

```vue
<!-- components/Whiteboard.client.vue -->
<script setup lang="ts">
import { shallowRef, onBeforeUnmount } from 'vue';
import { createBoard } from '@kujam/core';
import { Board } from '@kujam/vue';

// Aman membuat board langsung di script setup karena file ini .client.vue
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

Lalu panggil di halaman mana pun tanpa pembungkus tambahan:

```vue
<!-- pages/index.vue -->
<template>
  <main>
    <Whiteboard />
  </main>
</template>
```

---

## 4. Praktik Terbaik Manajemen Board

### Hindari Pembuatan Ulang Instance saat Re-render

- **React**:
  Gunakan `useMemo(() => createBoard(...), [])` atau `useRef(null)`. Jangan pernah memanggil `createBoard()` langsung di dalam tubuh fungsi render tanpa memoize, karena setiap re-render akan membuat board baru dan menyebabkan canvas di-mount ulang.
- **Vue**:
  Selalu gunakan `shallowRef(createBoard(...))` atau `shallowRef<Board | null>(null)`. **Jangan** gunakan `ref` mendalam atau `reactive()`, karena instance Board memiliki method internal dan state Yjs/event emitter yang tidak perlu diproxy oleh sistem reaktivitas Vue.

### React 18 & 19 StrictMode

Di lingkungan development dengan StrictMode aktif, React menjalankan siklus effect dua kali (`mount` -> `unmount` -> `mount`).
- `<Board>` dirancang agar aman terhadap StrictMode: view renderer lama akan di-unmount dan dibersihkan, lalu view baru dipasang kembali tanpa kebocoran memori.
- **Peringatan**: Jangan memanggil `board.dispose()` di dalam fungsi cleanup efek yang sama jika efek tersebut dapat berjalan ulang saat re-render. `board.dispose()` membuat board tidak dapat digunakan kembali secara permanen. Pastikan `dispose()` hanya dipanggil saat lifecycle komponen benar-benar selesai.

### Inisialisasi Storage & Jaringan Klien

Penyimpanan lokal seperti `@kujam/storage-indexeddb` atau sinkronisasi WebRTC/WebSocket (`@kujam/sync-yjs`) memerlukan API browser (`window.indexedDB`, `window.WebSocket`, dll).
- Inisialisasi provider ini di dalam hook klien:
  - React: di dalam `useEffect(() => { ... }, [])`.
  - Vue: di dalam `onMounted(() => { ... })` atau komponen `.client.vue`.
