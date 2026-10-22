import { describe, expect, it } from 'vitest';
import { parseFont, SvgCanvasContext } from './svg-context.js';
import { el, serializeSvg, type SvgNode } from './xml.js';

function record(
  draw: (g: SvgCanvasContext) => void,
  resolveImage?: (image: object) => string | null,
) {
  const defs: SvgNode[] = [];
  const g = new SvgCanvasContext({
    idPrefix: 't',
    defs,
    resolveImage,
    measureText: (t) => t.length * 10,
  });
  draw(g);
  return { body: serializeSvg(el('g', {}, g.nodes)), defs: serializeSvg(el('defs', {}, defs)), g };
}

describe('BOARD-1702: canvas-to-SVG recording context', () => {
  it('records filled and stroked paths in local coordinates', () => {
    const { body } = record((g) => {
      g.translate(10, 20);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(5, 0);
      g.quadraticCurveTo(5, 5, 0, 5);
      g.closePath();
      g.fillStyle = '#ff0000';
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.setLineDash([4, 2]);
      g.stroke();
    });
    expect(body).toBe(
      '<g><path d="M10 20L15 20Q15 25 10 25Z" fill="#ff0000"/>' +
        '<path d="M10 20L15 20Q15 25 10 25Z" fill="none" stroke="rgba(0, 0, 0, 0.5)" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 2"/></g>',
    );
  });

  it('scales stroke width and dashes with the transform', () => {
    const { body } = record((g) => {
      g.scale(2, 2);
      g.lineWidth = 3;
      g.setLineDash([1]);
      g.strokeRect(0, 0, 1, 1);
    });
    expect(body).toContain('stroke-width="6"');
    expect(body).toContain('stroke-dasharray="2 2"');
    expect(body).toContain('d="M0 0L2 0L2 2L0 2Z"');
  });

  it('turns arcs and ellipses into cubic curves', () => {
    const { body } = record((g) => {
      g.beginPath();
      g.arc(0, 0, 10, 0, Math.PI * 2);
      g.fill();
    });
    const d = /d="([^"]+)"/.exec(body)![1]!;
    expect(d.startsWith('M10 0C')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(4);
    expect(d.endsWith('10 0')).toBe(true);
  });

  it('keeps text as <text> with font, alignment, baseline, and transform', () => {
    const { body } = record((g) => {
      g.translate(5, 6);
      g.rotate(Math.PI / 2);
      g.font = 'italic 600 16px Inter, "Noto Sans", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillStyle = '#123456';
      g.fillText('Halo <dunia> & "kamu"', 1, 2);
    });
    expect(body).toBe(
      '<g><text x="1" y="2" transform="matrix(0 1 -1 0 5 6)" font-family="Inter, &quot;Noto Sans&quot;, sans-serif" font-size="16" font-weight="600" font-style="italic" text-anchor="middle" dominant-baseline="text-before-edge" fill="#123456">Halo &lt;dunia&gt; &amp; "kamu"</text></g>',
    );
  });

  it('compresses text wider than maxWidth and preserves significant spaces', () => {
    const { body } = record((g) => g.fillText(' ab  c', 0, 0, 20));
    expect(body).toContain('textLength="20"');
    expect(body).toContain('lengthAdjust="spacingAndGlyphs"');
    expect(body).toContain('xml:space="preserve"');
  });

  it('maps opacity and blend modes, and never writes url() paints', () => {
    const { body } = record((g) => {
      g.globalAlpha = 0.5;
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'url(https://evil.example/#x)';
      g.fillRect(0, 0, 1, 1);
      g.fillStyle = {};
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(0, 0, 1, 1);
    });
    expect(body).toContain('fill="#000000" opacity="0.5" style="mix-blend-mode:multiply"');
    expect(body).not.toContain('evil');
    expect(body.match(/mix-blend-mode/g)).toHaveLength(1);
  });

  it('wraps clipped drawing in a clip group closed by restore()', () => {
    const { body, defs } = record((g) => {
      g.save();
      g.beginPath();
      g.rect(0, 0, 10, 10);
      g.clip();
      g.fillRect(0, 0, 20, 20);
      g.restore();
      g.fillRect(0, 0, 1, 1);
    });
    expect(defs).toMatch(
      /^<defs><clipPath id="tc\d+"><path d="M0 0L10 0L10 10L0 10Z"\/><\/clipPath><\/defs>$/,
    );
    expect(body).toMatch(
      /^<g><g clip-path="url\(#tc\d+\)"><path d="M0 0L20 0L20 20L0 20Z" fill="#000000"\/><\/g><path d="M0 0L1 0L1 1L0 1Z" fill="#000000"\/><\/g>$/,
    );
  });

  it('draws images through resolveImage, with source rectangles as nested viewports', () => {
    const img = { naturalWidth: 100, naturalHeight: 50 };
    const { body, g } = record(
      (ctx) => {
        ctx.drawImage(img, 0, 0, 10, 5);
        ctx.drawImage(img, 10, 0, 50, 50, 0, 0, 20, 20);
        ctx.drawImage({}, 0, 0);
      },
      (image) => (image === img ? 'https://cdn.example/a.png' : null),
    );
    expect(body).toContain(
      '<image href="https://cdn.example/a.png" x="0" y="0" width="10" height="5" preserveAspectRatio="none"/>',
    );
    expect(body).toContain('viewBox="10 0 50 50"');
    expect(body).toContain(
      '<image href="https://cdn.example/a.png" width="100" height="50" preserveAspectRatio="none"/>',
    );
    expect(g.skippedImages).toBe(1);
  });

  it('supports the renderer helpers (roundRect, dot, drawText, drawThumbnail)', () => {
    const urls: string[] = [];
    const defs: SvgNode[] = [];
    const g = new SvgCanvasContext({ idPrefix: 't', defs, onImageUrl: (u) => urls.push(u) });
    g.beginPath();
    g.roundRect(0, 0, 10, 10, 2);
    g.fill();
    g.dot(5, 5, 2, '#00ff00');
    g.drawText('x', 1, 1, { color: '#111111', font: '12px serif' });
    expect(g.drawThumbnail('https://cdn.example/t.png', 0, 0, 4, 4, { radius: 1 })).toBe(true);
    expect(g.drawThumbnail('javascript:alert(1)', 0, 0, 4, 4)).toBe(false);
    const body = serializeSvg(el('g', {}, g.nodes));
    expect(body).toContain('fill="#00ff00"');
    expect(body).toContain('font-family="serif" font-size="12" fill="#111111"');
    expect(body).toContain('href="https://cdn.example/t.png"');
    expect(body).not.toContain('javascript');
    expect(urls).toEqual(['https://cdn.example/t.png']);
  });

  it('measures text with the given measurer or an estimate', () => {
    const { g } = record(() => {});
    expect(g.measureText('abc').width).toBe(30);
    const estimate = new SvgCanvasContext({ idPrefix: 'x', defs: [] });
    estimate.font = '20px sans-serif';
    expect(estimate.measureText('ab').width).toBeCloseTo(22);
  });

  it('parses CSS font shorthands', () => {
    expect(parseFont('bold 12pt Georgia')).toEqual({
      style: 'normal',
      weight: 'bold',
      size: 16,
      family: 'Georgia',
    });
    expect(parseFont('600 13px Inter, sans-serif')).toMatchObject({ weight: '600', size: 13 });
    expect(parseFont('garbage')).toMatchObject({ size: 10, family: 'sans-serif' });
  });
});
