import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NATIVE_DIST = dirname(fileURLToPath(import.meta.resolve("openclaw")));
const NATIVE_ENTRY = resolve(NATIVE_DIST, "../openclaw.mjs");
const USAGE_ARGS = [
  "status",
  "--usage",
  "--json",
  "--agent",
  "main",
  "--timeout",
  "10000",
];
const USAGE_ORIGIN = "https://openrouter.ai/api/v1/key";
const PROVIDER_BASE = "https://openrouter.ai/api/v1";

// This compatibility adapter uses the pinned native routing owner. The status
// command skips native proxy startup even though its usage helper needs it.
const CONTRACTS = {
  "proxy-env-DxV5eJIK.mjs":
    "dbe159171656307ce1881c710ef11baa99612dd20eb05ee90d237bd23212cb0e",
  "proxy-lifecycle-DK10inkq.mjs":
    "885617ace9733bf282d95aadca6368cffa95395cfa8d7c34142348b99b71838d",
  "proxy-lifecycle-Dl57fEmL.mjs":
    "de283d5f397582801b5f35b43ffbe17cb4f49e70c14233a7d6bac2ac3fb794f6",
};

export function isNativeUsageInvocation(
  argv: string[],
  entry = NATIVE_ENTRY,
): boolean {
  return (
    argv[1] === entry &&
    argv.length === USAGE_ARGS.length + 2 &&
    USAGE_ARGS.every((arg, index) => argv[index + 2] === arg)
  );
}

export async function verifyNativeUsageProxyContracts(directory = NATIVE_DIST) {
  try {
    for (const [name, expected] of Object.entries(CONTRACTS)) {
      const actual = createHash("sha256")
        .update(await readFile(join(directory, name)))
        .digest("hex");
      if (actual !== expected) throw new Error();
    }
  } catch {
    throw new Error(
      "Unverified native quota proxy runtime; revalidate the pinned release.",
    );
  }
}

/** Called only by the private preload, before optional lifecycle admission. */
export async function startNativeUsageProxy(
  argv = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Promise<(() => Promise<void>) | undefined> {
  if (!isNativeUsageInvocation(argv)) return;
  if (!env.OPENROUTER_API_KEY?.trim()) return;
  if (
    ![
      env.https_proxy ?? env.HTTPS_PROXY,
      env.http_proxy ?? env.HTTP_PROXY,
    ].some((value) => value?.trim())
  )
    return;
  await verifyNativeUsageProxyContracts();
  const proxyEnvironment = await import(
    pathToFileURL(join(NATIVE_DIST, "proxy-env-DxV5eJIK.mjs")).href
  );
  // Use native proxy precedence and NO_PROXY matching rather than inventing a
  // second matcher. No owner is started when this destination bypasses proxy.
  if (!proxyEnvironment.c(USAGE_ORIGIN, env)) return;
  if (!env.OPENCLAW_CONFIG_PATH) return;
  let config: {
    agents?: { defaults?: { model?: { primary?: string } } };
    models?: { providers?: { openrouter?: { baseUrl?: string } } };
  };
  try {
    config = JSON.parse(await readFile(env.OPENCLAW_CONFIG_PATH, "utf8"));
  } catch {
    throw new Error("Native quota proxy context is unavailable.");
  }
  const provider = config.models?.providers?.openrouter;
  if (
    !config.agents?.defaults?.model?.primary?.startsWith("openrouter/") ||
    !provider ||
    (provider.baseUrl !== undefined &&
      provider.baseUrl.replace(/\/+$/, "") !== PROVIDER_BASE)
  )
    return;
  const lifecycle = await import(
    pathToFileURL(join(NATIVE_DIST, "proxy-lifecycle-DK10inkq.mjs")).href
  );
  const originalLog = console.log;
  let handle: unknown;
  try {
    // Native startup logs must not contaminate the quota command's JSON stdout.
    console.log = (...args: unknown[]) => console.error(...args);
    handle = await lifecycle.startProxy({
      proxyUrl: proxyEnvironment.s("https", env),
      loopbackMode: "gateway-only",
    });
  } catch {
    throw new Error("Native quota proxy initialization failed.");
  } finally {
    console.log = originalLog;
  }
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await lifecycle.stopProxy(handle);
  };
}
