export class TimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settled = true;
      reject(new TimeoutError(label, ms));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
