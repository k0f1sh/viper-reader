/// <reference types="vite/client" />

import type { ViperReaderApi } from "../preload/preload";

declare global {
  interface Window {
    viperReader?: ViperReaderApi;
  }
}
