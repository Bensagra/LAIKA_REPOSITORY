// No-op on web: browsers already have a native `localStorage`. The real
// module (expo-sqlite/localStorage/install) polyfills one backed by SQLite,
// needed only on native where no such global exists. It also ships JSX in a
// .js file that esbuild can't parse for the web build, so it's aliased away
// here rather than merely redundant.
export {};
