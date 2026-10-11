/** Configuration handoff only. OpenClaw owns providers, auth resolution and HTTP. */
export type TextModel =
  | { baseUrl: string; model: string }
  | { ref: string; keyEnv: string };

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const RESERVED = /^(?:OPENCLAW_|NODE_|NPM_|BRIDGE_|LAB_|LD_|DYLD_|SSL_|GIT_)/;
const OWNED_ENV = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "SHELL",
  "BASH_ENV",
  "ENV",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);

export function credentialEnv(name: string): string {
  if (
    !ENV_NAME.test(name) ||
    RESERVED.test(name) ||
    OWNED_ENV.has(name) ||
    /(?:_BASE_URL|_ENDPOINT|_API_HOST)$/.test(name)
  )
    throw new Error(
      "Use an explicit provider credential env name; runtime controls are forbidden.",
    );
  return name;
}

export function nativeModel(ref: string, keyEnv: string): TextModel {
  if (
    !/^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9~._:+/@-]+$/.test(ref) ||
    ref.length > 200
  )
    throw new Error(
      "Use the native provider/model reference, at most 200 characters.",
    );
  return { ref, keyEnv: credentialEnv(keyEnv) };
}

export function providerEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use HTTPS or HTTP loopback, without URL credentials, query or fragment.",
    );
  return url.href;
}

export function secretRef(name: string) {
  return { source: "env", provider: "bridge-env", id: credentialEnv(name) };
}

export function textModelRef(model: TextModel): string {
  return "ref" in model ? model.ref : `lab/${model.model}`;
}

export function textModelConfig(model: TextModel) {
  if ("ref" in model) {
    const provider = model.ref.split("/")[0] as string;
    // A native provider overlay: no endpoint, transport, model registry or SDK here.
    return {
      catalogRefresh: { enabled: false },
      providers: {
        [provider]: { apiKey: secretRef(model.keyEnv) },
      },
    };
  }
  return {
    providers: {
      lab: {
        api: "openai-completions",
        baseUrl: model.baseUrl,
        apiKey: "local-lab-placeholder",
        models: [{ id: model.model, name: model.model }],
      },
    },
  };
}

/** Copy only user-selected names. Never inherit a shell, HOME, proxy or key registry. */
export function forwardCredentials(
  names: string[],
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of new Set(names)) {
    credentialEnv(name);
    const value = source[name];
    if (value === undefined || value === "") continue;
    if (value.length > 4096 || /[\r\n\0]/.test(value))
      throw new Error(
        "Selected provider credential has an invalid size or control character.",
      );
    result[name] = value;
  }
  return result;
}

export function redactCredentials(
  text: string,
  credentials: NodeJS.ProcessEnv,
): string {
  for (const value of Object.values(credentials))
    if (value) text = text.split(value).join("[REDACTED]");
  return text;
}
