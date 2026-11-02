import { createRequire } from "node:module";
import {
  admitLifecycleRequest,
  boundConsolidationUtilityRequest,
} from "./lifecycle-request-budget.ts";
import { startNativeUsageProxy } from "./native-usage-proxy.ts";
import {
  admitOneUserRequest,
  boundOneUserUtilityRequest,
  validateOneUserContext,
} from "./one-user-budget.ts";
import {
  admitOneUserFollowupRequest,
  boundOneUserFollowupUtilityRequest,
  validateOneUserFollowupContext,
} from "./one-user-followup-budget.ts";

const ledger = process.env.OPENCLAW_LAB_LIFECYCLE_LEDGER;
const oneUserLedger = process.env.BRIDGE_ONE_USER_LEDGER;
const oneUserFollowupLedger = process.env.BRIDGE_ONE_USER_FOLLOWUP_LEDGER;
if ([ledger, oneUserLedger, oneUserFollowupLedger].filter(Boolean).length > 1)
  throw new Error("Conflicting native admission contexts; dispatch denied.");
if (oneUserLedger) validateOneUserContext(oneUserLedger);
if (oneUserFollowupLedger)
  validateOneUserFollowupContext(oneUserFollowupLedger);

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
const stopUsageProxy = await startNativeUsageProxy();
if (stopUsageProxy) {
  process.once("beforeExit", () => void stopUsageProxy());
  process.once("exit", () => void stopUsageProxy());
}
if (ledger) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const bounded = boundConsolidationUtilityRequest(ledger, input, init);
    admitLifecycleRequest(ledger, input, bounded);
    return nativeFetch(input, bounded);
  };
  // Native guarded model transport loads this same prepared runtime snapshot.
  nativeRequire("undici/index.js").fetch = globalThis.fetch;
} else if (oneUserLedger) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const bounded = boundOneUserUtilityRequest(oneUserLedger, input, init);
    admitOneUserRequest(oneUserLedger, input, bounded);
    return nativeFetch(input, bounded);
  };
  nativeRequire("undici/index.js").fetch = globalThis.fetch;
} else if (oneUserFollowupLedger) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const bounded = boundOneUserFollowupUtilityRequest(
      oneUserFollowupLedger,
      input,
      init,
    );
    admitOneUserFollowupRequest(oneUserFollowupLedger, input, bounded);
    return nativeFetch(input, bounded);
  };
  nativeRequire("undici/index.js").fetch = globalThis.fetch;
}
