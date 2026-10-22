/**
 * Ready-made plugin lab examples (BOARD-2412): a new brush, a simple stamp tool, a card element
 * with a resolver, and one that fails on purpose to show the error panel. Kept as source strings
 * so the documentation playground (BOARD-2205) can load the same snippets.
 */

export interface LabExample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
}

const brush = `import { defineBrush, definePlugin } from '@kujam/core';

/**
 * A new freehand brush. Pick the pen tool, then "Krayon" in the toolbar's brush choices
 * (or use the "Pakai" button in the lab panel).
 */
export const crayon = defineBrush({
  id: 'lab.crayon',
  label: 'Krayon',
  blend: 'multiply',
  strokeOptions: {
    size: 12,
    thinning: 0.7,
    smoothing: 0.35,
    streamline: 0.6,
    taper: { start: 24, end: 48 },
  },
});

export default definePlugin({
  id: 'lab.crayon-brush',
  brushes: [crayon],
});
`;

const stamp = `import { defineTool, definePlugin } from '@kujam/core';

const SIZE = 64;

/** Every click stamps a star centered on the pointer; each stamp is one undo step. */
export const stampTool = defineTool({
  id: 'lab.stamp',
  cursor: 'crosshair',
  initial: 'idle',
  states: {
    idle: {
      onPointerDown(ctx, e) {
        ctx.board.create({
          type: 'geo',
          x: e.point.x - SIZE / 2,
          y: e.point.y - SIZE / 2,
          w: SIZE,
          h: SIZE,
          props: { geo: 'star', fill: 'solid', fillColor: 'yellow', strokeColor: 'orange' },
        });
      },
    },
  },
});

export default definePlugin({
  id: 'lab.stamp-tool',
  tools: [stampTool],
  toolbarItems: [{ id: 'lab.stamp', label: 'Stempel', toolId: 'lab.stamp' }],
});
`;

const card = `import { defineElement, definePlugin, rect, schema, string } from '@kujam/core';

interface Weather {
  city: string;
  temperature: number;
  summary: string;
}

/** A fake API: answers after a short delay, like a real server would. */
function fetchWeather(city: string): Promise<Weather> {
  const temperature = 24 + ((city.length * 7) % 9);
  return new Promise((done) =>
    setTimeout(() => done({ city, temperature, summary: temperature > 28 ? 'Cerah' : 'Berawan' }), 400),
  );
}

/** A card whose content comes from a resolver, not from the document. */
export const weatherCard = defineElement({
  type: 'lab.weather-card',
  version: 1,
  props: schema({ city: string({ maxLength: 64 }) }),
  defaults: { city: 'Bandung' },
  geometry: (el) => rect(el.w, el.h),
  resolve: (el) => fetchWeather(el.props.city),
  placeholder: (reason) => ({ label: reason === 'loading' ? 'Memuat cuaca…' : 'Cuaca tidak tersedia' }),
  render: {
    html(host, el, data) {
      const root = host as HTMLElement;
      const box = document.createElement('div');
      Object.assign(box.style, {
        boxSizing: 'border-box', width: '100%', height: '100%', padding: '12px 16px',
        borderRadius: '12px', background: '#EAF2FF', border: '1px solid #B9D0F5',
        fontFamily: 'Inter, system-ui, sans-serif', color: '#17191E',
        display: 'grid', alignContent: 'center', gap: '4px',
      });
      const title = document.createElement('strong');
      const line = document.createElement('span');
      box.append(title, line);
      root.append(box);
      const show = (d: Weather | undefined) => {
        // Data is untrusted: text only, never HTML.
        title.textContent = d?.city ?? el.props.city;
        line.textContent = d ? d.temperature + '°C · ' + d.summary : '…';
      };
      show(data);
      return {
        update: (_next, nextData) => show(nextData),
        destroy: () => root.replaceChildren(),
      };
    },
    canvas(g, el, data) {
      g.fillStyle = '#EAF2FF';
      g.fillRect(0, 0, el.w, el.h);
      g.fillStyle = '#17191E';
      g.font = '600 14px Inter, system-ui, sans-serif';
      g.fillText(data ? data.city + ' ' + data.temperature + '°C' : el.props.city, 16, el.h / 2);
    },
  },
  a11y: (el, data) => ({ role: 'group', label: 'Cuaca ' + (data?.city ?? el.props.city) }),
});

export default definePlugin({
  id: 'lab.weather',
  elements: [weatherCard],
});
`;

const broken = `import { defineElement, defineTool, definePlugin, schema, boolean } from '@kujam/core';

/** Its canvas renderer throws: the renderer shows an error placeholder for this element only. */
export const fragile = defineElement({
  type: 'lab.fragile',
  version: 1,
  props: schema({ boom: boolean() }),
  defaults: { boom: true },
  render: {
    canvas(g, el) {
      if (el.props.boom) throw new Error('Render sengaja gagal');
      g.fillRect(0, 0, el.w, el.h);
    },
  },
});

/** Its pointer handler throws: the error is shown in the panel and the interaction rolls back. */
export const faulty = defineTool({
  id: 'lab.faulty',
  initial: 'idle',
  states: {
    idle: {
      onPointerDown() {
        throw new Error('Tool sengaja gagal');
      },
    },
  },
});

export default definePlugin({
  id: 'lab.broken',
  elements: [fragile],
  tools: [faulty],
  toolbarItems: [{ id: 'lab.faulty', label: 'Tool rusak', toolId: 'lab.faulty' }],
});
`;

export const LAB_EXAMPLES: readonly LabExample[] = [
  { id: 'brush', title: 'Kuas baru', description: 'defineBrush: kuas krayon.', source: brush },
  {
    id: 'stamp',
    title: 'Tool stempel',
    description: 'defineTool: klik untuk menempel bintang.',
    source: stamp,
  },
  {
    id: 'card',
    title: 'Kartu dengan resolver',
    description: 'defineElement: kartu cuaca dengan resolver API palsu.',
    source: card,
  },
  {
    id: 'broken',
    title: 'Contoh error',
    description: 'Elemen yang gagal render dan tool yang melempar error.',
    source: broken,
  },
];

export function findExample(id: string | null | undefined): LabExample | undefined {
  return LAB_EXAMPLES.find((e) => e.id === id);
}
