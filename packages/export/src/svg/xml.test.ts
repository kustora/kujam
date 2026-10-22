import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  el,
  escapeAttr,
  escapeText,
  fmt,
  parseXmlFragment,
  sanitizeSvgFragment,
  serializeSvg,
} from './xml.js';

const sanitize = (source: string, allowRemoteImages = true) =>
  serializeSvg(
    el('g', {}, sanitizeSvgFragment(source, { idPrefix: 'p', allowRemoteImages }).nodes),
  );

describe('BOARD-1702: SVG serializer', () => {
  it('escapes text and attribute values', () => {
    expect(escapeText('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    expect(escapeAttr(`"x" 'y'\n`)).toBe('&quot;x&quot; &#39;y&#39;&#10;');
    const out = serializeSvg(
      el('text', { 'data-x': '"><script>alert(1)</script>' }, ['</text><script>x</script>']),
    );
    expect(out).toBe(
      '<text data-x="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">&lt;/text&gt;&lt;script&gt;x&lt;/script&gt;</text>',
    );
    expect(out).not.toContain('<script');
  });

  it('drops invalid XML characters and unsafe names', () => {
    expect(escapeText('a\u0000b\u0007c')).toBe('abc');
    expect(serializeSvg({ tag: 'g', attrs: { 'on load': 'x', ok: '1' }, children: [] })).toBe(
      '<g ok="1"/>',
    );
    expect(serializeSvg({ tag: 'bad tag', attrs: {}, children: [] })).toBe('');
  });

  it('formats numbers compactly', () => {
    expect(fmt(1.23456)).toBe('1.235');
    expect(fmt(-0.0001)).toBe('0');
    expect(fmt(Number.NaN)).toBe('0');
  });
});

describe('BOARD-1702: XML fragment parser', () => {
  it('parses elements, attributes, text, CDATA, and entities', () => {
    const nodes = parseXmlFragment(
      `<!-- c --><g id='a' x=1><rect width="2"/>T&amp;&#65;&#x42;<![CDATA[<raw>]]></g>`,
    );
    expect(nodes).toEqual([
      {
        tag: 'g',
        attrs: { id: 'a', x: '1' },
        children: [{ tag: 'rect', attrs: { width: '2' }, children: [] }, 'T&AB', '<raw>'],
      },
    ]);
    expect(decodeEntities('&unknown; &#0; &lt;')).toBe('&unknown;  <');
  });

  it('tolerates unbalanced tags and ignores doctypes with entity declarations', () => {
    const nodes = parseXmlFragment('<!DOCTYPE x [<!ENTITY e "boom">]><g><rect></g></b>&e;');
    expect(nodes[0]).toMatchObject({ tag: 'g', children: [{ tag: 'rect' }] });
    expect(nodes[1]).toBe('&e;');
  });

  it('keeps > inside quoted attribute values', () => {
    expect(parseXmlFragment('<text a="1>2">x</text>')[0]).toMatchObject({ attrs: { a: '1>2' } });
  });
});

describe('BOARD-1702: export.svg sanitizer (no scripts)', () => {
  it('removes scripts, foreignObject, style elements, and animations', () => {
    const out = sanitize(
      '<script>alert(1)</script><foreignObject><div>x</div></foreignObject><style>*{}</style>' +
        '<set attributeName="href" to="javascript:alert(1)"/><animate/><rect width="1"/>',
    );
    expect(out).toBe('<g><rect width="1"/></g>');
  });

  it('removes event handlers and dangerous values', () => {
    const out = sanitize(
      '<rect onclick="x()" ONLOAD="y()" width="1" style="background:url(https://evil.example/x)" fill="url(https://evil.example/#a)"/>' +
        '<circle style="behavior: url(x.htc)" r="2"/><g transform="expression(alert(1))"/>',
    );
    expect(out).toBe('<g><rect width="1"/><circle r="2"/><g/></g>');
  });

  it('allows only local references and safe image URLs', () => {
    expect(sanitize('<use href="https://evil.example/s.svg#x"/><use xlink:href="#a"/>')).toBe(
      '<g><use/><use href="#a"/></g>',
    );
    expect(
      sanitize(
        '<image href="javascript:alert(1)"/><image href="data:image/svg+xml;base64,PHN2Zz4="/>',
      ),
    ).toBe('<g><image/><image/></g>');
    expect(
      sanitize(
        '<image href="https://cdn.example/a.png"/><image href="data:image/png;base64,AAAA"/>',
      ),
    ).toBe(
      '<g><image href="https://cdn.example/a.png"/><image href="data:image/png;base64,AAAA"/></g>',
    );
    expect(sanitize('<image href="https://cdn.example/a.png"/>', false)).toBe('<g><image/></g>');
  });

  it('unwraps links, drops unknown elements, and prefixes IDs with their references', () => {
    const result = sanitizeSvgFragment(
      '<a href="javascript:alert(1)"><g id="grad" fill="url(#grad)"><use href="#grad"/></g></a><iframe/><unknown><rect/></unknown>',
      { idPrefix: 'e1', allowRemoteImages: true },
    );
    expect(serializeSvg(el('g', {}, result.nodes))).toBe(
      '<g><g id="e1-grad" fill="url(#e1-grad)"><use href="#e1-grad"/></g></g>',
    );
    expect(result.removed).toBe(3);
  });

  it('drops xmlns declarations (the export sets its own namespace)', () => {
    expect(sanitize('<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="evil"><rect/></svg>')).toBe(
      '<g><svg><rect/></svg></g>',
    );
  });
});
