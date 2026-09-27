import { useEffect } from 'react';

function navigate(path: string) {
  window.location.hash = path;
  window.dispatchEvent(new Event('laikai:navigate'));
}

export function useRouter() {
  return {
    push: navigate,
    replace: navigate,
  };
}

// Each web screen is mounted fresh on navigation, so "focus" == mount.
export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(() => effect(), [effect]);
}

export function Stack() {
  return null;
}

Stack.Screen = function Screen() {
  return null;
};
