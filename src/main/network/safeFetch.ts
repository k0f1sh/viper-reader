import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
const maxRedirects = 5;

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32]
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export type SafeFetchOptions = {
  headers?: HeadersInit;
  timeoutMs: number;
};

export async function safeFetch(
  input: string,
  options: SafeFetchOptions
): Promise<Response> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let currentUrl = new URL(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeAddress = await resolveSafeNetworkAddress(currentUrl);
    const dispatcher = new Agent({
      connections: 1,
      pipelining: 0,
      connect: {
        lookup: createPinnedLookup(safeAddress)
      }
    });
    const response = await fetch(currentUrl, {
      headers: options.headers,
      redirect: "manual",
      signal,
      dispatcher
    } as RequestInit & { dispatcher: Agent });

    if (!isRedirect(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    if (redirectCount === maxRedirects) {
      throw new Error(`リダイレクト回数が上限の ${maxRedirects} 回を超えました。`);
    }

    await response.body?.cancel();
    currentUrl = new URL(location, currentUrl);
  }

  throw new Error("URLを取得できませんでした。");
}

export async function readResponseText(
  response: Response,
  maxBytes: number
): Promise<{ text: string; byteLength: number }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`レスポンスサイズが上限の ${maxBytes} バイトを超えています。`);
  }

  if (!response.body) {
    return { text: "", byteLength: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new Error(`レスポンスサイズが上限の ${maxBytes} バイトを超えています。`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    text: new TextDecoder().decode(bytes),
    byteLength
  };
}

export async function assertSafeNetworkUrl(url: URL): Promise<void> {
  await resolveSafeNetworkAddress(url);
}

type SafeNetworkAddress = {
  address: string;
  family: 4 | 6;
};

async function resolveSafeNetworkAddress(url: URL): Promise<SafeNetworkAddress> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`HTTPまたはHTTPS以外のURLは取得できません: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("認証情報を含むURLは取得できません。");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`ローカルホストへのアクセスを拒否しました: ${hostname}`);
  }

  const addressType = isIP(hostname);
  if (addressType !== 0) {
    assertAllowedAddress(hostname, addressType);
    return { address: hostname, family: addressType === 6 ? 6 : 4 };
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`ホスト名を解決できません: ${hostname}`);
  }
  for (const address of addresses) {
    assertAllowedAddress(address.address, address.family);
  }
  const selected = addresses[0];
  return {
    address: selected.address,
    family: selected.family === 6 ? 6 : 4
  };
}

export function createPinnedLookup(address: SafeNetworkAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function assertAllowedAddress(address: string, family: number): void {
  const isBlocked = family === 6
    ? blockedIpv6Addresses.check(address, "ipv6")
    : blockedIpv4Addresses.check(address, "ipv4");
  if (isBlocked) {
    throw new Error(`ローカルネットワークまたは予約済みアドレスへのアクセスを拒否しました: ${address}`);
  }
}

function isRedirect(status: number): boolean {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
}
