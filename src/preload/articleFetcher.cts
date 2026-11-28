import { ipcRenderer } from "electron";

ipcRenderer.once("article-fetcher:port", event => {
  window.postMessage("article-fetcher:port", window.location.origin, event.ports);
});
