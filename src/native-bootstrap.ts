import { createRequire } from "node:module";
import {
  admitLifecycleRequest,
  boundConsolidationUtilityRequest,
} from "./lifecycle-request-budget.ts";

// OpenClaw supplies Undici dispatchers. Node 24's older built-in fetch cannot
// use their handler/options contract. Keep fetch and dispatchers in one runtime.
// This preload applies only to the private OpenClaw child, before its entrypoint.
const nativeRequire = createRequire(import.meta.resolve("openclaw"));
if (
  nativeRequire("../package.json").version !== "2026.9.9" ||
  nativeRequire("undici/package.json").version !== "8.10.2" ||
  process.versions.node !== "24.16.0"
)
  throw new Error(
    "Unverified native HTTP runtime; revalidate the pinned release.",
  );

globalThis.fetch = nativeRequire("undici/index.js").fetch;
const ledger = process.env.OPENCLAW_LAB_LIFECYCLE_LEDGER;
if (ledger) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const bounded = boundConsolidationUtilityRequest(ledger, input, init);
    admitLifecycleRequest(ledger, input, bounded);
    return nativeFetch(input, bounded);
  };
  // Native guarded model transport loads this same prepared runtime snapshot.
  nativeRequire("undici/index.js").fetch = globalThis.fetch;
}
