// BOARD-107: lint fixture. Platform APIs and ordinary words that merely contain a banned term are allowed.
export function notify(target: { postMessage(message: unknown): void }) {
  target.postMessage('siap');
}

// The HTTP method: a reviewed string exception.
export const method = 'POST';

// Words that contain a term without it being a whole segment.
export const words = ['postpone', 'multitask', 'postal', 'Postgres', 'brandy', 'POSTER'];
export const message = `postponed ${words.length} multitasking jobs`;
