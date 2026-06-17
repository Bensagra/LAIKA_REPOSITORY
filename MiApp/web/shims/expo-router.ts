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

export function Stack() {
  return null;
}

Stack.Screen = function Screen() {
  return null;
};
