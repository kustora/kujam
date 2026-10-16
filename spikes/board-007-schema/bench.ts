// BOARD-007: kecepatan validasi dan bentuk error. Jalankan: pnpm bench (lewat esbuild).
import * as mini from './src/entries/mini.ts';
import * as vb from './src/entries/valibot.ts';
import * as zd from './src/entries/zod.ts';
import * as zm from './src/entries/zod-mini.ts';

const N = 5000;
const COLORS = ['yellow', 'orange', 'green', 'blue', 'violet', 'pink'] as const;
const stickies = Array.from({ length: N }, (_, i) => ({
  kind: 'sticky',
  text: `catatan ${i}`.repeat(3),
  color: COLORS[i % 6],
  size: 'm',
  fontSize: 16,
  ...(i % 2 ? { align: 'center' } : {}),
  link: i % 3 ? null : 'https://example.com',
  locked: false,
  tags: ['a', 'b'],
}));
const strokes = Array.from({ length: N }, (_, i) => ({
  points: Array.from({ length: 50 }, (_, p) => [i + p, p * 2, 0.5]),
  color: '#222',
  width: 3,
}));
const invalid = stickies.map((s) => ({ ...s, fontSize: Number.NaN, extra: 1 }));

const libs = { mini: mini.check, valibot: vb.check, 'zod-mini': zm.check, zod: zd.check };
type Check = typeof mini.check;

function time(fn: () => void): number {
  const runs: number[] = [];
  for (let r = 0; r < 15; r++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return Math.round(runs[7]! * 100) / 100;
}

console.log(
  `| Kandidat | ${N} sticky valid (ms) | ${N} coretan x 50 titik (ms) | ${N} sticky tidak valid (ms) |`,
);
console.log('| --- | ---: | ---: | ---: |');
for (const [name, c] of Object.entries(libs) as [string, Check][]) {
  const passed = (r: unknown) => {
    const res = r as { ok?: boolean; success?: boolean };
    return res.ok ?? res.success;
  };
  if (!stickies.every((s) => passed(c.sticky(s))) || !strokes.every((s) => passed(c.stroke(s))))
    throw new Error(`${name}: data valid ditolak`);
  if (invalid.some((s) => passed(c.sticky(s))))
    throw new Error(`${name}: data tidak valid diterima`);
  const a = time(() => stickies.forEach((s) => c.sticky(s)));
  const b = time(() => strokes.forEach((s) => c.stroke(s)));
  const d = time(() => invalid.forEach((s) => c.sticky(s)));
  console.log(`| ${name} | ${a} | ${b} | ${d} |`);
}

console.log('\nBentuk error untuk { ...sticky, fontSize: NaN, extra: 1, tags: ["a", 2] }:');
const bad = { ...stickies[0], fontSize: Number.NaN, extra: 1, tags: ['a', 2] };
for (const [name, c] of Object.entries(libs) as [string, Check][]) {
  console.log(
    `\n${name}:`,
    JSON.stringify(c.sticky(bad), (_k, v) =>
      typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v,
    ).slice(0, 700),
  );
}
