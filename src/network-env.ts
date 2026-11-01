/** OpenClaw owns proxy selection and TLS. Preserve only its runtime network inputs. */
const NETWORK_ENV_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export function forwardNetworkEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of NETWORK_ENV_NAMES) {
    const value = source[name];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      value.length > 16384 ||
      /[\r\n\0]/.test(value)
    )
      throw new Error(`Invalid runtime network setting: ${name}.`);
    // Empty lowercase values can override uppercase proxy/bypass settings.
    result[name] = value;
  }
  return result;
}
