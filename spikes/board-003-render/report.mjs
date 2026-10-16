/* global console, URL */
// BOARD-003: merangkum semua results/*.json menjadi tabel Markdown untuk ADR-003.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./results/', import.meta.url);
const reports = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

for (const r of reports) {
  console.log(`\n### ${r.label}\n`);
  console.log(
    `${r.userAgent}  \nDPR ${r.dpr}, viewport ${r.viewport.w}x${r.viewport.h}, interval refresh ~${r.refreshMs} ms, ${r.elementCount} elemen, ${r.cardCount} kartu\n`,
  );
  console.log(
    '| Skenario | fps rata-rata | frame p50 (ms) | frame p95 (ms) | frame maks (ms) | skrip p95 (ms) | frame panjang | elemen digambar |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of r.scenarios) {
    console.log(
      `| ${s.name} | ${s.avgFps} | ${s.frameMs.p50} | ${s.frameMs.p95} | ${s.frameMs.max} | ${s.scriptMs.p95} | ${s.longFramePct}% | ${s.avgDrawn} |`,
    );
  }
  console.log('\n| Mode | Muat sampai tampil (ms) | Heap JS (MB) | Sumber memori |');
  console.log('| --- | ---: | ---: | --- |');
  for (const m of r.modes)
    console.log(`| ${m.mode} | ${m.loadMs} | ${m.jsHeapMB ?? '-'} | ${m.memorySource} |`);
}
