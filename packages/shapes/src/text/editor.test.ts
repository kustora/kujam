// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, type Board } from '@kujam/core';
import {
  attachTextEditor,
  domToRichText,
  richTextToDom,
  sanitizePastedHtml,
  type TextEditorHost,
} from './editor.js';
import type { RichText } from './model.js';
import { defaultElements } from '../index.js';

describe('Inline HTML contenteditable rich text editor (BOARD-1003b, 1003c, 1003d, 1001)', () => {
  describe('richTextToDom and domToRichText round-trip', () => {
    it('converts plain paragraphs to DOM and back to canonical delta', () => {
      const container = document.createElement('div');
      const delta: RichText = [{ insert: 'Halo dunia\nBaris kedua\n' }];
      richTextToDom(delta, container);

      expect(container.children.length).toBe(2);
      expect(container.children[0]?.tagName.toLowerCase()).toBe('p');
      expect(container.children[0]?.textContent).toBe('Halo dunia');

      const extracted = domToRichText(container);
      expect(extracted).toEqual(delta);
    });

    it('converts bold, italic, and safe links', () => {
      const container = document.createElement('div');
      const delta: RichText = [
        { insert: 'Teks ' },
        { insert: 'tebal', attributes: { bold: true } },
        { insert: ' dan ' },
        { insert: 'miring', attributes: { italic: true } },
        { insert: ' serta ' },
        { insert: 'tautan', attributes: { link: 'https://kustora.id' } },
        { insert: '\n' },
      ];
      richTextToDom(delta, container);

      const p = container.children[0] as HTMLElement;
      expect(p.querySelector('strong')?.textContent).toBe('tebal');
      expect(p.querySelector('em')?.textContent).toBe('miring');
      const a = p.querySelector('a');
      expect(a?.textContent).toBe('tautan');
      expect(a?.href).toBe('https://kustora.id/');

      const extracted = domToRichText(container);
      expect(extracted).toEqual(delta);
    });

    it('converts bullet and ordered lists with indent depth', () => {
      const container = document.createElement('div');
      const delta: RichText = [
        { insert: 'Item 1' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Item 2' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Subitem 1' },
        { insert: '\n', attributes: { list: 'ordered', indent: 2 } },
      ];
      richTextToDom(delta, container);

      expect(container.querySelector('ul')).not.toBeNull();
      expect(container.querySelector('ol')).not.toBeNull();

      const extracted = domToRichText(container);
      expect(extracted).toEqual(delta);
    });
  });

  describe('sanitizePastedHtml', () => {
    it('strips script, style, iframe, and dangerous event handlers', () => {
      const malicious =
        '<p>Halo <script>alert(1)</script><img src=x onerror="alert(1)"> <a href="javascript:alert(1)">klik</a></p>' +
        '<style>body { display:none; }</style><iframe src="evil.com"></iframe>';
      const clean = sanitizePastedHtml(malicious);

      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('<style');
      expect(clean).not.toContain('<iframe');
      expect(clean).not.toContain('onerror');
      expect(clean).not.toContain('javascript:');
      expect(clean).toContain('<p>Halo ');
    });
  });

  describe('attachTextEditor lifecycle and behavior', () => {
    let board: Board;
    let mountedEditor: HTMLElement | null = null;
    let unmountSpy: ReturnType<typeof vi.fn>;
    let host: TextEditorHost;

    beforeEach(() => {
      board = createBoard({ plugins: [defaultElements] });
      mountedEditor = null;
      unmountSpy = vi.fn(() => {
        mountedEditor = null;
      });

      host = {
        board,
        mountEditor: vi.fn((editor) => {
          mountedEditor = editor;
          return unmountSpy;
        }),
      };
    });

    it('opens inline editor on "edit" action with matching bounds and styles', () => {
      const attachment = attachTextEditor(host);

      board.create({
        id: 's1',
        type: 'sticky',
        x: 100,
        y: 200,
        w: 192,
        h: 144,
        rotation: 5,
        props: { text: [{ insert: 'Catatan pertama\n' }], color: 'yellow', authorId: null },
      });

      board.elementContext.emit('edit', { id: 's1' });

      expect(attachment.activeElementId).toBe('s1');
      expect(host.mountEditor).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({ x: 100, y: 200, w: 192, h: 144, rotation: 5 }),
      );
      expect(mountedEditor).not.toBeNull();
      expect(mountedEditor?.textContent).toContain('Catatan pertama');
      expect(mountedEditor?.dataset.kujamInlineEditor).toBe('s1');

      attachment.detach();
    });

    it('commits changes on Escape and updates document in one transaction', () => {
      const attachment = attachTextEditor(host);

      board.create({
        id: 's2',
        type: 'sticky',
        x: 50,
        y: 50,
        w: 192,
        h: 144,
        props: { text: [{ insert: 'Lama\n' }], color: 'yellow', authorId: null },
      });

      attachment.edit('s2');
      expect(mountedEditor).not.toBeNull();

      // Simulate typing in editor
      if (mountedEditor) {
        mountedEditor.replaceChildren();
        const p = document.createElement('p');
        p.textContent = 'Baru diperbarui';
        mountedEditor.appendChild(p);

        // Press Escape
        mountedEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }

      expect(attachment.activeElementId).toBeNull();
      expect(unmountSpy).toHaveBeenCalledTimes(1);

      const record = board.getDocument().records['s2'];
      expect(record?.props.text).toEqual([{ insert: 'Baru diperbarui\n' }]);

      attachment.detach();
    });

    it('guards IME composition: Escape during isComposing does not exit edit mode', () => {
      const attachment = attachTextEditor(host);

      board.create({
        id: 's3',
        type: 'sticky',
        x: 0,
        y: 0,
        w: 192,
        h: 144,
        props: { text: [{ insert: 'Konnichiwa\n' }], color: 'yellow', authorId: null },
      });

      attachment.edit('s3');
      expect(mountedEditor).not.toBeNull();

      if (mountedEditor) {
        // Start IME composition (e.g. Japanese kanji selection)
        mountedEditor.dispatchEvent(new CompositionEvent('compositionstart'));

        // Pressing Escape during IME composition cancels candidate window, NOT the editor
        mountedEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(attachment.activeElementId).toBe('s3');
        expect(unmountSpy).not.toHaveBeenCalled();

        // Finish IME composition
        mountedEditor.dispatchEvent(new CompositionEvent('compositionend'));

        // Now Escape commits and closes editor
        mountedEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(attachment.activeElementId).toBeNull();
        expect(unmountSpy).toHaveBeenCalledTimes(1);
      }

      attachment.detach();
    });

    it('empty text: deletes text element, but keeps sticky note (BOARD-1003)', () => {
      const attachment = attachTextEditor(host);

      board.create({
        id: 'txt1',
        type: 'text',
        x: 0,
        y: 0,
        w: 200,
        h: 40,
        props: { text: [{ insert: 'Teks awal\n' }], size: 'm', align: 'start', widthMode: 'auto', color: 'black' },
      });
      board.create({
        id: 'stk1',
        type: 'sticky',
        x: 200,
        y: 0,
        w: 192,
        h: 144,
        props: { text: [{ insert: 'Sticky awal\n' }], color: 'green', authorId: null },
      });

      // 1. Edit text element and clear it
      attachment.edit('txt1');
      if (mountedEditor) {
        mountedEditor.replaceChildren(); // empty
        mountedEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      // Text element should be deleted
      expect(board.getDocument().records['txt1']).toBeUndefined();

      // 2. Edit sticky element and clear it
      attachment.edit('stk1');
      if (mountedEditor) {
        mountedEditor.replaceChildren(); // empty
        mountedEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      // Sticky note MUST NOT be deleted
      const stickyRecord = board.getDocument().records['stk1'];
      expect(stickyRecord).toBeDefined();
      expect(stickyRecord?.props.text).toEqual([{ insert: '\n' }]);

      // 3. Edit geo element (BOARD-1004)
      board.create({
        id: 'geo1',
        type: 'geo',
        x: 400,
        y: 0,
        w: 120,
        h: 80,
        props: {
          geo: 'rectangle',
          fill: 'none',
          fillColor: 'white',
          strokeColor: 'black',
          strokeWidth: 2,
          dash: 'solid',
          textColor: 'black',
          label: [{ insert: 'Geo Label\n' }],
        },
      });

      attachment.edit('geo1');
      expect(attachment.activeElementId).toBe('geo1');
      if (mountedEditor) {
        mountedEditor.replaceChildren(); // empty
        mountedEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      // Geo shape MUST NOT be deleted when label is cleared
      const geoRecord = board.getDocument().records['geo1'];
      expect(geoRecord).toBeDefined();
      expect(geoRecord?.props.label).toEqual([{ insert: '\n' }]);

      attachment.detach();
    });
  });
});
