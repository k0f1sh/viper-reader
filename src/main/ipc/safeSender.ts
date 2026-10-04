export type IpcSender = {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
};

export function sendIfAvailable(
  sender: IpcSender,
  channel: string,
  ...args: unknown[]
): boolean {
  if (sender.isDestroyed()) {
    return false;
  }

  try {
    sender.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}
