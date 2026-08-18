// Ambient declarations that keep `@bhooai/admin` self-contained: it does
// not depend on the consumer having `vite/client` types installed. Vite /
// esbuild inject `import.meta.env` and resolve asset imports at runtime; the
// host project's build (vite build) handles actual bundling.
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
