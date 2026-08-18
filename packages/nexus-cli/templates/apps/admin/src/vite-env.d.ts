// Ambient declarations for the admin host app. Self-contained: does not depend
// on `vite/client` types being resolvable from the host workspace, so `@bhooai/admin`
// imports (import.meta.env, *.svg) type-check consistently in every project.
interface ImportMetaEnv {
  readonly VITE_SUPERVISOR_URL?: string;
  readonly [key: string]: string | undefined;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}
