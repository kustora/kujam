// BOARD-107: fixture lint. API platform yang kebetulan memuat istilah terlarang tetap boleh.
export function notify(target: { postMessage(message: unknown): void }) {
  target.postMessage('siap');
}
