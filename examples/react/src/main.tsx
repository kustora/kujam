import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createBoard } from '@kujam/core';
import { Board } from '@kujam/react';

function App() {
  const board = useMemo(() => createBoard({ locale: 'id' }), []);
  return <Board board={board} />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
