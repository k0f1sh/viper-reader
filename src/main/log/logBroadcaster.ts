import { BrowserWindow } from "electron";
import util from "node:util";
import type { AppLogEntry } from "../../shared/types.js";

const maxBufferedLogs = 300;
const bufferedLogs: AppLogEntry[] = [];
let nextLogId = 1;
let isInstalled = false;

export function installConsoleLogForwarder(): void {
  if (isInstalled) {
    return;
  }

  isInstalled = true;
  wrapConsoleMethod("log");
  wrapConsoleMethod("info");
  wrapConsoleMethod("warn");
  wrapConsoleMethod("error");
}

export function listBufferedLogs(): AppLogEntry[] {
  return bufferedLogs;
}

function wrapConsoleMethod(level: AppLogEntry["level"]): void {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    appendLog({
      id: `log:${nextLogId++}`,
      level,
      message: formatLogMessage(args),
      createdAt: new Date().toISOString()
    });
  };
}

function appendLog(entry: AppLogEntry): void {
  bufferedLogs.push(entry);
  if (bufferedLogs.length > maxBufferedLogs) {
    bufferedLogs.splice(0, bufferedLogs.length - maxBufferedLogs);
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("logs:entry", entry);
  }
}

function formatLogMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack ?? arg.message;
      }
      if (typeof arg === "string") {
        return arg;
      }
      return util.inspect(arg, {
        breakLength: 120,
        colors: false,
        compact: true,
        depth: 4
      });
    })
    .join(" ");
}
