/**
 * Reject if `promise` has not settled within `ms`. The original promise is not
 * cancelled, only no longer awaited.
 */
export function withTimeout(promise, ms, what = 'Operation') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms); })
  ]).finally(() => clearTimeout(timer));
}
