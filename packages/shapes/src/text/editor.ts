/**
 * Inline HTML contenteditable rich text editor for sticky notes and text elements (BOARD-1003b, 1003c, 1003d, 1001).
 *
 * @packageDocumentation
 */

import type { Board, ElementRecord } from '@kujam/core';
import {
  COLOR_VALUES,
  STICKY_COLOR_VALUES,
  STICKY_TEXT_COLOR,
  type ColorKey,
  type StickyColor,
} from '../colors.js';
import {
  isRichTextEmpty,
  normalizeRichText,
  sanitizeLink,
  type RichText,
  type RichTextOp,
} from './model.js';

/**
 * Gap between adjacent sticky notes created via Tab or Shift+Tab, in board units (BOARD-914).
 *
 * @beta
 */
export const STICKY_TAB_GAP = 20;

/**
 * Minimal interface required from the renderer view to host an active text editor.
 *
 * @public
 */
export interface TextEditorHost {
  readonly board: Board;
  mountEditor(
    editor: HTMLElement,
    bounds: { x: number; y: number; w: number; h: number; rotation?: number },
  ): () => void;
}

/**
 * Options for configuring the inline text editor.
 *
 * @public
 */
export interface TextEditorOptions {
  /** Prompt handler for creating a link (Mod+K). Defaults to window.prompt. */
  readonly promptLink?: (currentUrl?: string) => string | null | Promise<string | null>;
  /** Callback when editing session starts. */
  readonly onEditStart?: (elementId: string) => void;
  /** Callback when editing session finishes. */
  readonly onEditEnd?: (elementId: string) => void;
}

/**
 * Handle to an active text editor attachment.
 *
 * @public
 */
export interface TextEditorAttachment {
  /** ID of the element currently being edited, or `null`. */
  readonly activeElementId: string | null;
  /** Starts an editing session for the specified element. */
  edit(elementId: string): void;
  /** Commits and finishes the current editing session. */
  stop(): void;
  /** Detaches listeners and cleans up the active editor. */
  detach(): void;
}

/**
 * Converts canonical RichText delta into sanitized HTML DOM nodes for the contenteditable editor.
 *
 * @internal
 */
export function richTextToDom(delta: RichText, container: HTMLElement): void {
  const doc = container.ownerDocument;
  container.replaceChildren();

  // Break ops into paragraph/list lines
  interface EditorLine {
    ops: Array<{ text: string; bold?: boolean; italic?: boolean; link?: string }>;
    list?: 'bullet' | 'ordered';
    indent: number;
  }

  const lines: EditorLine[] = [];
  let currentOps: EditorLine['ops'] = [];

  for (const op of delta) {
    const parts = op.insert.split(/(\n)/);
    for (const part of parts) {
      if (part === '\n') {
        lines.push({
          ops: currentOps,
          list: op.attributes?.list,
          indent: op.attributes?.indent ?? (op.attributes?.list ? 1 : 0),
        });
        currentOps = [];
      } else if (part.length > 0) {
        currentOps.push({
          text: part,
          bold: op.attributes?.bold,
          italic: op.attributes?.italic,
          link: op.attributes?.link,
        });
      }
    }
  }

  if (currentOps.length > 0) {
    lines.push({ ops: currentOps, indent: 0 });
  }

  if (lines.length === 0) {
    const p = doc.createElement('p');
    p.appendChild(doc.createElement('br'));
    container.appendChild(p);
    return;
  }

  let currentListEl: HTMLUListElement | HTMLOListElement | null = null;
  let currentListKind: 'bullet' | 'ordered' | null = null;

  for (const line of lines) {
    if (line.list) {
      if (!currentListEl || currentListKind !== line.list) {
        currentListKind = line.list;
        currentListEl = doc.createElement(line.list === 'ordered' ? 'ol' : 'ul');
        currentListEl.style.margin = '0';
        currentListEl.style.paddingLeft = '24px';
        container.appendChild(currentListEl);
      }

      const li = doc.createElement('li');
      if (line.indent > 1) {
        li.style.marginLeft = `${(line.indent - 1) * 20}px`;
      }

      appendLineOpsToElement(doc, line.ops, li);
      currentListEl.appendChild(li);
    } else {
      currentListEl = null;
      currentListKind = null;

      const p = doc.createElement('p');
      p.style.margin = '0';
      p.style.minHeight = '1em';
      appendLineOpsToElement(doc, line.ops, p);
      container.appendChild(p);
    }
  }
}

function appendLineOpsToElement(
  doc: Document,
  ops: Array<{ text: string; bold?: boolean; italic?: boolean; link?: string }>,
  parent: HTMLElement,
): void {
  if (ops.length === 0) {
    parent.appendChild(doc.createElement('br'));
    return;
  }

  for (const op of ops) {
    let node: HTMLElement | Text = doc.createTextNode(op.text);

    if (op.bold) {
      const strong = doc.createElement('strong');
      strong.appendChild(node);
      node = strong;
    }

    if (op.italic) {
      const em = doc.createElement('em');
      em.appendChild(node);
      node = em;
    }

    if (op.link) {
      const safeHref = sanitizeLink(op.link);
      if (safeHref) {
        const a = doc.createElement('a');
        a.href = safeHref;
        a.rel = 'noopener noreferrer';
        a.style.color = '#2F6FDB';
        a.style.textDecoration = 'underline';
        a.appendChild(node);
        node = a;
      }
    }

    parent.appendChild(node);
  }
}

/**
 * Extracts canonical RichText delta from a contenteditable DOM node.
 *
 * @internal
 */
export function domToRichText(container: HTMLElement): RichText {
  const ops: RichTextOp[] = [];

  function traverseNode(node: Node, state: { bold?: boolean; italic?: boolean; link?: string }) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        const attributes: Record<string, unknown> = {};
        if (state.bold) attributes.bold = true;
        if (state.italic) attributes.italic = true;
        if (state.link) attributes.link = state.link;

        ops.push(
          Object.keys(attributes).length > 0
            ? { insert: text, attributes }
            : { insert: text },
        );
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      ops.push({ insert: '\n' });
      return;
    }

    const nextState = { ...state };
    if (tag === 'strong' || tag === 'b') nextState.bold = true;
    if (tag === 'em' || tag === 'i') nextState.italic = true;
    if (tag === 'a') {
      const href = (el as HTMLAnchorElement).getAttribute('href');
      if (href) {
        const safe = sanitizeLink(href);
        if (safe) nextState.link = safe;
      }
    }

    for (const child of Array.from(el.childNodes)) {
      traverseNode(child, nextState);
    }

    // Newlines after block elements
    if (tag === 'p' || tag === 'li' || tag === 'div') {
      const lastOp = ops[ops.length - 1];
      if (!lastOp || !lastOp.insert.endsWith('\n')) {
        if (tag === 'li') {
          const parentTag = el.parentElement?.tagName.toLowerCase();
          const isOrdered = parentTag === 'ol';
          const indent = el.style.marginLeft
            ? Math.min(3, Math.floor(parseInt(el.style.marginLeft, 10) / 20) + 1)
            : 1;

          ops.push({
            insert: '\n',
            attributes: {
              list: isOrdered ? 'ordered' : 'bullet',
              ...(indent > 1 ? { indent } : {}),
            },
          });
        } else {
          ops.push({ insert: '\n' });
        }
      }
    }
  }

  for (const child of Array.from(container.childNodes)) {
    traverseNode(child, {});
  }

  return normalizeRichText(ops);
}

/**
 * Sanitizes external pasted HTML by removing scripts, iframes, styles, and dangerous tags (BOARD-2001).
 *
 * @internal
 */
export function sanitizePastedHtml(rawHtml: string): string {
  let cleaned = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  cleaned = cleaned.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  cleaned = cleaned.replace(/<embed\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
  cleaned = cleaned.replace(/<math\b[^<]*(?:(?!<\/math>)<[^<]*)*<\/math>/gi, '');
  cleaned = cleaned.replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, '');
  cleaned = cleaned.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  cleaned = cleaned.replace(/<(?:img|input|form|base|meta|link)\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
  cleaned = cleaned.replace(/(?:href|src|xlink:href)\s*=\s*['"]?\s*(?:javascript|vbscript|data):[^'"\s>]*/gi, 'href=""');
  return cleaned;
}

/**
 * Creates an inline text editor controller attached to a BoardView (BOARD-1003b, 1003c, 1003d).
 *
 * @public
 */
export function attachTextEditor(
  host: TextEditorHost,
  options?: TextEditorOptions,
): TextEditorAttachment {
  const { board } = host;
  let activeElementId: string | null = null;
  let unmountEditorFn: (() => void) | null = null;
  let activeEditorEl: HTMLDivElement | null = null;
  let isComposing = false;

  function commitAndClose(): void {
    if (!activeElementId || !activeEditorEl) return;

    const elId = activeElementId;
    const editor = activeEditorEl;
    activeElementId = null;
    activeEditorEl = null;

    if (unmountEditorFn) {
      unmountEditorFn();
      unmountEditorFn = null;
    }

    const record = board.getDocument().records[elId];
    if (!record || record.kind !== 'element') {
      options?.onEditEnd?.(elId);
      return;
    }

    if (record.type === 'frame') {
      const plain = domToRichText(editor).map((op) => op.insert).join('').replace(/\n/g, '').trim();
      const currentName = (record.props as { name?: string }).name ?? 'Frame';
      if (plain.length > 0 && plain !== currentName) {
        board.update(
          elId,
          { props: { ...(record.props as Record<string, unknown>), name: plain } },
          { label: 'edit-frame-name' },
        );
      }
      options?.onEditEnd?.(elId);
      return;
    }

    const isLabelProp = record.type === 'geo' || record.type === 'connector';
    const textPropName = isLabelProp ? 'label' : 'text';
    const currentDelta =
      ((record.props as Record<string, unknown>)[textPropName] as RichText) ?? [{ insert: '\n' }];
    const newDelta = domToRichText(editor);

    // If text is empty (BOARD-1003 criterion: empty text deletes text elements, but keeps sticky notes, geo shapes, and connectors)
    if (isRichTextEmpty(newDelta)) {
      if (record.type === 'text') {
        board.delete(elId, { label: 'delete-empty-text' });
      } else {
        board.update(
          elId,
          { props: { [textPropName]: normalizeRichText([{ insert: '\n' }]) } },
          { label: 'edit-text' },
        );
      }
    } else if (JSON.stringify(newDelta) !== JSON.stringify(currentDelta)) {
      board.update(elId, { props: { [textPropName]: newDelta } }, { label: 'edit-text' });
    }

    options?.onEditEnd?.(elId);
  }

  function startEdit(elementId: string): void {
    if (activeElementId === elementId) return;
    if (activeElementId) {
      commitAndClose();
    }

    const record = board.getDocument().records[elementId];
    if (!record || record.kind !== 'element') return;
    if (
      record.type !== 'sticky' &&
      record.type !== 'text' &&
      record.type !== 'geo' &&
      record.type !== 'connector' &&
      record.type !== 'frame'
    ) {
      return;
    }

    activeElementId = elementId;
    options?.onEditStart?.(elementId);

    const doc = (board as unknown as { container?: HTMLElement }).container?.ownerDocument ?? document;
    const editor = doc.createElement('div');
    activeEditorEl = editor;
    editor.contentEditable = 'true';
    editor.dataset.kujamInlineEditor = elementId;

    const theme = board.elementContext.theme;
    const fontFamily = theme.typography.fontFamily;
    const isSticky = record.type === 'sticky';
    const isGeo = record.type === 'geo';
    const isConnector = record.type === 'connector';
    const isFrame = record.type === 'frame';

    // Style editor to visually blend over canvas element
    editor.style.boxSizing = 'border-box';
    editor.style.width = '100%';
    editor.style.height = '100%';
    editor.style.outline = 'none';
    editor.style.overflow = 'auto';
    editor.style.userSelect = 'text';
    editor.style.webkitUserSelect = 'text';
    editor.style.fontFamily = fontFamily;
    editor.style.lineHeight = '1.35';

    if (isSticky) {
      const colorKey = ((record.props as { color?: StickyColor }).color ?? 'yellow') as StickyColor;
      const bgColor = theme.sticky[colorKey] ?? STICKY_COLOR_VALUES[colorKey] ?? '#FBE7A1';
      editor.style.backgroundColor = bgColor;
      editor.style.color = theme.stickyText ?? STICKY_TEXT_COLOR;
      editor.style.padding = '16px';
      editor.style.fontSize = '20px';
      editor.style.textAlign = 'left';
    } else if (isFrame) {
      editor.style.backgroundColor = theme.mode === 'dark' ? '#1E293B' : '#FFFFFF';
      editor.style.color = theme.mode === 'dark' ? '#F8FAFC' : '#0F172A';
      editor.style.border = '1px solid #3B82F6';
      editor.style.borderRadius = '4px';
      editor.style.padding = '2px 6px';
      editor.style.fontSize = '13px';
      editor.style.fontWeight = '600';
      editor.style.lineHeight = '20px';
      editor.style.whiteSpace = 'nowrap';
      editor.style.overflow = 'hidden';
    } else if (isGeo || isConnector) {
      editor.style.backgroundColor = 'transparent';
      const colorKey = (
        isGeo
          ? ((record.props as { textColor?: ColorKey }).textColor ?? 'black')
          : ((record.props as { color?: ColorKey }).color ?? 'black')
      ) as ColorKey;
      editor.style.color = theme.colors[colorKey] ?? COLOR_VALUES[colorKey] ?? '#17191E';
      editor.style.padding = isConnector ? '4px 8px' : '12px';
      editor.style.fontSize = isConnector ? '14px' : '16px';
      editor.style.textAlign = 'center';
      editor.style.display = 'flex';
      editor.style.flexDirection = 'column';
      editor.style.justifyContent = 'center';
    } else {
      editor.style.backgroundColor = 'transparent';
      const colorKey = ((record.props as { color?: ColorKey }).color ?? 'black') as ColorKey;
      editor.style.color = theme.colors[colorKey] ?? '#17191E';
      editor.style.padding = '0';
      const sizeKey = (record.props as { size?: string }).size ?? 'm';
      const fontSizes: Record<string, string> = { s: '16px', m: '24px', l: '32px', xl: '48px' };
      editor.style.fontSize = fontSizes[sizeKey] ?? '24px';
      const align = (record.props as { align?: string }).align ?? 'start';
      editor.style.textAlign = align === 'end' ? 'right' : align === 'center' ? 'center' : 'left';
    }

    const initialText: RichText = isFrame
      ? [{ insert: ((record.props as { name?: string }).name || 'Frame') + '\n' }]
      : isGeo || isConnector
        ? ((record.props as { label?: RichText }).label ?? [{ insert: '\n' }])
        : ((record.props as { text?: RichText }).text ?? [{ insert: '\n' }]);
    richTextToDom(initialText, editor);

    // Stop keydown propagation so board doesn't interpret text as shortcuts
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();

      // Guard IME composition (BOARD-1003d): do not interrupt IME candidate selection
      if (isComposing || e.isComposing) {
        return;
      }

      if (isFrame && e.key === 'Enter') {
        e.preventDefault();
        commitAndClose();
        return;
      }

      // Tab creates adjacent sticky notes (BOARD-914)
      if (
        e.key === 'Tab' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        record.type === 'sticky'
      ) {
        e.preventDefault();

        const reverse = e.shiftKey;
        const currentRecord = board.getElement(elementId);
        if (!currentRecord || currentRecord.type !== 'sticky') return;

        commitAndClose();

        const w = currentRecord.w;
        const h = currentRecord.h;
        const color = (currentRecord.props as { color?: string }).color ?? 'yellow';

        let candidateX = reverse
          ? currentRecord.x - w - STICKY_TAB_GAP
          : currentRecord.x + w + STICKY_TAB_GAP;
        let candidateY = currentRecord.y;

        if (!reverse) {
          let maxRight: number | undefined;
          let rowStartX = currentRecord.x;

          if (currentRecord.parentId !== null) {
            const parent = board.getElement(currentRecord.parentId);
            if (parent) {
              maxRight = parent.x + parent.w;
              const siblings = board
                .query({ pageId: currentRecord.pageId, parentId: currentRecord.parentId })
                .filter((s) => s.type === 'sticky' && Math.abs(s.y - currentRecord.y) < h * 0.5);
              if (siblings.length > 0) {
                rowStartX = Math.min(...siblings.map((s) => s.x));
              }
            }
          } else if (board.camera.viewport.width > 0) {
            const viewBounds = board.camera.getViewportBounds();
            maxRight = viewBounds.maxX;
            const stickies = board
              .query({ pageId: currentRecord.pageId })
              .filter(
                (s) =>
                  s.type === 'sticky' &&
                  s.parentId === null &&
                  Math.abs(s.y - currentRecord.y) < h * 0.5,
              );
            if (stickies.length > 0) {
              rowStartX = Math.min(...stickies.map((s) => s.x));
            }
          }

          if (maxRight !== undefined && candidateX + w > maxRight && candidateX > rowStartX) {
            candidateX = rowStartX;
            candidateY = currentRecord.y + h + STICKY_TAB_GAP;
          }
        }

        let newSticky: Readonly<ElementRecord> | undefined;
        board.history.batch('sticky.tab-create', () => {
          newSticky = board.create({
            type: 'sticky',
            pageId: currentRecord.pageId,
            parentId: currentRecord.parentId,
            x: candidateX,
            y: candidateY,
            w,
            h,
            props: {
              text: [{ insert: '\n' }],
              color,
              authorId: null,
            },
          });
        });

        if (newSticky) {
          board.select([newSticky.id]);
          startEdit(newSticky.id);
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        doc.execCommand?.('bold');
      } else if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        doc.execCommand?.('italic');
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const selection = doc.getSelection();
        const selectedText = selection?.toString() ?? '';
        const promptFn = options?.promptLink ?? ((cur) => window.prompt('URL tautan:', cur ?? 'https://'));
        Promise.resolve(promptFn()).then((url) => {
          if (url) {
            const safe = sanitizeLink(url);
            if (safe) {
              if (selectedText.length > 0) {
                doc.execCommand?.('createLink', false, safe);
              } else {
                const a = doc.createElement('a');
                a.href = safe;
                a.textContent = safe;
                a.rel = 'noopener noreferrer';
                selection?.getRangeAt(0)?.insertNode(a);
              }
            }
          }
        });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commitAndClose();
      }
    });

    // IME composition events (BOARD-1003d)
    editor.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    editor.addEventListener('compositionend', () => {
      isComposing = false;
    });

    // Paste event with sanitization (BOARD-2001)
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const clip = e.clipboardData;
      if (!clip) return;

      const rawHtml = clip.getData('text/html');
      const plainText = clip.getData('text/plain');

      if (rawHtml) {
        const cleanedHtml = sanitizePastedHtml(rawHtml);
        const Parser = doc.defaultView?.DOMParser ?? globalThis.DOMParser;
        const parsedDoc = new Parser().parseFromString(cleanedHtml, 'text/html');
        const pastedDelta = domToRichText(parsedDoc.body);
        const fragment = doc.createDocumentFragment();
        const tempContainer = doc.createElement('div');
        richTextToDom(pastedDelta, tempContainer);
        while (tempContainer.firstChild) {
          fragment.appendChild(tempContainer.firstChild);
        }
        const sel = doc.getSelection();
        if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(fragment);
        } else {
          editor.appendChild(fragment);
        }
      } else if (plainText) {
        const sel = doc.getSelection();
        if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(doc.createTextNode(plainText));
          range.collapse(false);
        } else {
          const p = doc.createElement('p');
          p.style.margin = '0';
          p.style.minHeight = '1em';
          p.appendChild(doc.createTextNode(plainText));
          editor.appendChild(p);
        }
      }
    });

    editor.addEventListener('blur', () => {
      commitAndClose();
    });

    const editorBounds = isFrame
      ? {
          x: record.x,
          y: record.y - 28,
          w: Math.max(160, Math.min(record.w, 320)),
          h: 24,
          rotation: record.rotation,
        }
      : isConnector
        ? {
            x: record.x + record.w / 2 - Math.max(120, record.w) / 2,
            y: record.y + record.h / 2 - Math.max(36, record.h) / 2,
            w: Math.max(120, record.w),
            h: Math.max(36, record.h),
            rotation: record.rotation,
          }
        : {
            x: record.x,
            y: record.y,
            w: record.w,
            h: record.h,
            rotation: record.rotation,
          };
    unmountEditorFn = host.mountEditor(editor, editorBounds);

    // Focus editor and select all text
    setTimeout(() => {
      // The editor may already be closed (for example Esc right after creating an element).
      if (!editor.isConnected) return;
      editor.focus();
      const sel = doc.getSelection();
      if (sel) {
        sel.selectAllChildren(editor);
        if (sel.rangeCount > 0) sel.collapseToEnd();
      }
    }, 0);
  }

  // Listen to board action event: triggers on tool creation and double-click
  const offAction = board.on('action', (event) => {
    if (event.name === 'edit' && typeof event.payload === 'object' && event.payload !== null) {
      const id = (event.payload as { id?: unknown }).id;
      if (typeof id === 'string') {
        startEdit(id);
      }
    }
  });

  // When selection clears or switches to another element, commit active edit
  const offSelection = board.on('selection', (event) => {
    if (activeElementId && !event.ids.includes(activeElementId)) {
      commitAndClose();
    }
  });

  return {
    get activeElementId() {
      return activeElementId;
    },
    edit(id: string) {
      startEdit(id);
    },
    stop() {
      commitAndClose();
    },
    detach() {
      commitAndClose();
      offAction();
      offSelection();
    },
  };
}
