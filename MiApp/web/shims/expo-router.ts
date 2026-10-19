import { useEffect } from 'react';

type NavigateTarget = string | { pathname: string; params?: Record<string, string> };

function toHash(target: NavigateTarget): string {
  if (typeof target === 'string') return target;
  const query = target.params ? `?${new URLSearchParams(target.params).toString()}` : '';
  return `${target.pathname}${query}`;
}

function navigate(target: NavigateTarget) {
  window.location.hash = toHash(target);
  window.dispatchEvent(new Event('laikai:navigate'));
}

export function useRouter() {
  return {
    push: navigate,
    replace: navigate,
    back: () => { window.history.back(); },
  };
}

// Each web screen is mounted fresh on navigation, so "focus" == mount.
export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(() => effect(), [effect]);
}

/** Query string of the current hash, e.g. #/mision-detalle?id=abc -> {id: "abc"}. */
export function useLocalSearchParams<T extends Record<string, string> = Record<string, string>>(): Partial<T> {
  const hash = window.location.hash.replace(/^#/, '');
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return {} as Partial<T>;
  return Object.fromEntries(new URLSearchParams(hash.slice(qIndex + 1)).entries()) as Partial<T>;
}

export function Stack() {
  return null;
}

Stack.Screen = function Screen() {
  return null;
};
