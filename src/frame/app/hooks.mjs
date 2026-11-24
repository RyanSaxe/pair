const handlers = {};

export function registerHooks(entries) {
  Object.assign(handlers, entries);
}

export function callHook(name, ...args) {
  const fn = handlers[name];
  if (typeof fn !== "function") {
    throw new Error(`Frame hook "${name}" is not registered.`);
  }
  return fn(...args);
}
