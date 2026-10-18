import { StrictMode, useMemo, type CSSProperties } from 'react';
import { createBoard, type Board as CoreBoard } from '@kujam/core';
import { Board, useCamera, useHistory, useSelection, useTool } from '@kujam/react';
import { defaultElements, defaultTools } from '@kujam/shapes';
import { createRoot } from 'react-dom/client';

const TOOLS = [
  ['select', 'Pilih'],
  ['hand', 'Tangan'],
  ['sticky', 'Sticky'],
  ['draw', 'Pena'],
  ['text', 'Teks'],
  ['eraser', 'Hapus'],
] as const;

const bar: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 4,
  padding: 6,
  borderRadius: 12,
  background: '#fff',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  font: '13px system-ui, sans-serif',
};

function Toolbar({ board }: { board: CoreBoard }) {
  const tool = useTool(board);
  const { canUndo, canRedo, undo, redo } = useHistory(board);
  // Only re-renders when the rounded zoom changes, not on every pan frame.
  const zoom = useCamera(board, (c) => Math.round(c.zoom * 100));
  const selected = useSelection(board, (ids) => ids.length);

  return (
    <div style={bar}>
      {TOOLS.map(([id, label]) => (
        <button key={id} aria-pressed={tool === id} onClick={() => board.setTool(id)}>
          {label}
        </button>
      ))}
      <button disabled={!canUndo} onClick={undo}>
        Urungkan
      </button>
      <button disabled={!canRedo} onClick={redo}>
        Ulangi
      </button>
      <span style={{ alignSelf: 'center', padding: '0 8px' }}>
        {zoom}% · {selected} dipilih
      </span>
    </div>
  );
}

function App() {
  // The board lives as long as the page. Do not dispose it in an effect cleanup: StrictMode runs
  // cleanups once in development, which would dispose the board before it is used.
  const board = useMemo(
    () => createBoard({ locale: 'id', plugins: [defaultElements, defaultTools] }),
    [],
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Board board={board} theme="light" />
      <Toolbar board={board} />
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
