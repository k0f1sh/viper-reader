/// <reference types="vite/client" />

import type { ViperReaderApi } from "../preload/preload.cjs";

declare global {
  interface Window {
    viperReader?: ViperReaderApi;
  }
}
