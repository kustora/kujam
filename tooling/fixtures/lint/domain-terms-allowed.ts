// BOARD-107: lint fixture. Platform APIs that happen to contain banned terms are still allowed.
export function notify(target: { postMessage(message: unknown): void }) {
  target.postMessage('siap');
}
