/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by `npx @agent8/deploy`. Absent locally, which switches on offline mode. */
  readonly VITE_AGENT8_VERSE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
