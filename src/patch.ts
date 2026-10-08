export type NativeMethod = (this: unknown, ...args: unknown[]) => unknown;

/** Cooperative wrapping: later wrappers may retain ours, so disposal makes it inert. */
export function wrapMethod(
  object: object,
  key: PropertyKey,
  intercept: (original: NativeMethod, receiver: unknown, args: unknown[]) => unknown,
): () => void {
  const own = Object.getOwnPropertyDescriptor(object, key);
  const original: unknown = Reflect.get(object, key);
  if (typeof original !== 'function' || (own && !own.configurable && !own.writable)) {
    throw new Error(`The required native method ${String(key)} cannot be wrapped safely.`);
  }
  if (own && !('value' in own)) {
    throw new Error(`The required native method ${String(key)} is an accessor.`);
  }
  let enabled = true;
  const wrapped: NativeMethod = function (...args: unknown[]): unknown {
    return enabled
      ? intercept(original as NativeMethod, this, args)
      : Reflect.apply(original, this, args);
  };
  Object.defineProperty(object, key, {
    configurable: own?.configurable ?? true,
    enumerable: own?.enumerable ?? false,
    writable: own?.writable ?? true,
    value: wrapped,
  });
  return () => {
    enabled = false;
    if (Reflect.get(object, key) !== wrapped) return;
    if (own) Object.defineProperty(object, key, own);
    else Reflect.deleteProperty(object, key);
  };
}
