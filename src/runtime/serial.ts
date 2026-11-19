/** Run operations on the same mutable resource in arrival order, including after a failed call. */
export function serialQueue() {
  let tail = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const result = tail.then(run);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
