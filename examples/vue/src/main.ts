import { createApp, defineComponent, h, type PropType } from 'vue';
import { createBoard, type Board as CoreBoard } from '@kujam/core';
import { defaultElements, defaultTools } from '@kujam/shapes';
import { Board, useCamera, useHistory, useSelection, useTool } from '@kujam/vue';

const TOOLS = [
  ['select', 'Pilih'],
  ['hand', 'Tangan'],
  ['sticky', 'Sticky'],
  ['draw', 'Pena'],
  ['text', 'Teks'],
  ['eraser', 'Hapus'],
] as const;

const bar = {
  position: 'absolute',
  left: '50%',
  bottom: '16px',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: '4px',
  padding: '6px',
  borderRadius: '12px',
  background: '#fff',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  font: '13px system-ui, sans-serif',
} as const;

const Toolbar = defineComponent({
  props: { board: { type: Object as PropType<CoreBoard>, required: true } },
  setup(props) {
    const tool = useTool(props.board);
    const { canUndo, canRedo, undo, redo } = useHistory(props.board);
    // Only changes when the rounded zoom changes, not on every pan frame.
    const zoom = useCamera(props.board, (c) => Math.round(c.zoom * 100));
    const selected = useSelection(props.board, (ids) => ids.length);

    return () =>
      h('div', { style: bar }, [
        ...TOOLS.map(([id, label]) =>
          h(
            'button',
            { key: id, 'aria-pressed': tool.value === id, onClick: () => props.board.setTool(id) },
            label,
          ),
        ),
        h('button', { disabled: !canUndo.value, onClick: undo }, 'Urungkan'),
        h('button', { disabled: !canRedo.value, onClick: redo }, 'Ulangi'),
        h(
          'span',
          { style: { alignSelf: 'center', padding: '0 8px' } },
          `${zoom.value}% · ${selected.value} dipilih`,
        ),
      ]);
  },
});

// The board lives as long as the page; the app owns it, so `<Board>` never disposes it.
const board = createBoard({ locale: 'id', plugins: [defaultElements, defaultTools] });

createApp({
  render: () =>
    h('div', { style: { position: 'relative', width: '100%', height: '100%' } }, [
      h(Board, { board, theme: 'light' }),
      h(Toolbar, { board }),
    ]),
}).mount('#app');
