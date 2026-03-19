import { toasts } from "../stores.js";

let nextId = 1;

export function addToast(message, type = "info") {
  const id = nextId++;
  toasts.update((t) => [...t, { id, message, type }]);
  setTimeout(() => {
    toasts.update((t) => t.filter((toast) => toast.id !== id));
  }, 3500);
}
