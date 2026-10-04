import { StringDecoder } from "node:string_decoder";
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import type { CommandHookConfig, CommandHookProcessState } from "../../shared/types.js";
import { assertHttpUrl, assertString, assertStringArray } from "../ipc/inputValidation.js";

export function assertCommandHookConfig(value: unknown): asserts value is CommandHookConfig {
  if (!value || typeof value !== "object") throw new Error("フック設定が不正です。");
  const config = value as CommandHookConfig;
  assertString(config.command, "hook command", { minLength: 1, maxLength: 4096 });
  assertStringArray(config.args, "hook arguments", { maxItems: 100, maxItemLength: 8192 });
  if (!config.command.trim() || [config.command, ...config.args].some((part) => part.includes("\0"))) {
    throw new Error("フック設定が不正です。");
  }
}

export function expandHookCommand(command: string): string {
  return command.startsWith("~/") ? path.join(homedir(), command.slice(2)) : command;
}

export class CommandHookRunner {
  private child: ChildProcess | null = null;

  async run(config: CommandHookConfig, url: string, onOutput: (output: string) => void = () => {}, onProcess: (state: CommandHookProcessState) => void = () => {}): Promise<void> {
    assertCommandHookConfig(config);
    assertHttpUrl(url, "article URL");
    if (this.child) throw new Error("外部フックは実行中です。");
    const args = config.args.map((arg) => arg.replaceAll("{url}", url));
    const command = expandHookCommand(config.command);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false, cwd: homedir(), env: process.env, stdio: ["ignore", "pipe", "pipe"]
      });
      this.child = child;
      const reportProcess = (status: CommandHookProcessState["status"], exitCode: number | null = null, signal: string | null = null) => {
        onProcess({ command, pid: child.pid ?? null, status, exitCode, signal });
      };
      child.once("spawn", () => reportProcess("running"));
      // Keep only a bounded tail in memory; command output is not stored in SQLite.
      let stderrTail = Buffer.alloc(0);
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-8192);
      });
      let outputTail = "";
      let outputTimer: ReturnType<typeof setTimeout> | null = null;
      const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")];
      const flushOutput = () => {
        if (outputTimer) clearTimeout(outputTimer);
        outputTimer = null;
        if (outputTail) onOutput(outputTail);
      };
      const appendOutput = (text: string) => {
        if (!text) return;
        outputTail = (outputTail + text).slice(-32768);
        if (!outputTimer) outputTimer = setTimeout(flushOutput, 100);
      };
      [child.stdout, child.stderr].forEach((stream, index) => {
        stream?.on("data", (chunk: Buffer) => appendOutput(decoders[index].write(chunk)));
        stream?.once("end", () => appendOutput(decoders[index].end()));
      });
      let failed = false;
      let settled = false;
      let exitTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        if (exitTimer) clearTimeout(exitTimer);
        // Descendants can inherit the pipes. Their lifetime must not keep the
        // registered command running after that command itself has exited.
        child.stdout?.destroy();
        child.stderr?.destroy();
        decoders.forEach((decoder) => appendOutput(decoder.end()));
        flushOutput();
        if (this.child === child) this.child = null;
        if (failed) {
          reject(new Error("外部フックを起動できません。実行ファイルと権限を確認してください。"));
          return;
        }
        if (code === 0) resolve();
        else {
          const reason = signal
            ? `外部フックがシグナル ${signal} で終了しました。`
            : `外部フックが終了コード ${code} で終了しました。`;
          const detail = stderrTail.toString("utf8").trim();
          reject(new Error(detail ? `${reason}\n${detail}` : reason));
        }
      };
      child.once("error", () => {
        failed = true;
        reportProcess("spawn-failed");
        finish(null, null);
      });
      child.once("exit", (code, signal) => {
        reportProcess(code === 0 ? "completed" : "failed", code, signal);
        // Allow queued output to drain, but never wait indefinitely for pipes
        // held open by background descendants. Normal close finishes earlier.
        exitTimer = setTimeout(() => finish(code, signal), 125);
      });
      child.once("close", finish);
    });
  }

  stop(): void {
    this.child?.kill();
  }
}
