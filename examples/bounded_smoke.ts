import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";
import {
  confirmSmoke,
  type SmokeConfirmations,
  SmokeUnavailable,
} from "../src/paid-smoke.ts";

const args = process.argv.slice(2);
const confirmations: SmokeConfirmations = {
  keyLimit: args.includes("--key-limit-confirmed"),
  resetDisabled: args.includes("--reset-disabled-confirmed"),
  exclusiveKey: args.includes("--exclusive-key-confirmed"),
  prices:
    args
      .find((arg) => arg.startsWith("--price-ceilings-confirmed="))
      ?.split("=")[1] ?? "",
  providerLimitUsd: args.includes("--provider-limit=50") ? 50 : 5,
};
let lab: Lab | undefined;
let root: string | undefined;
try {
  const expected = [
    "--key-limit-confirmed",
    "--reset-disabled-confirmed",
    "--exclusive-key-confirmed",
    "--price-ceilings-confirmed=8,30,10,0.02",
    `--provider-limit=${confirmations.providerLimitUsd}`,
  ];
  if (
    args.length !== expected.length ||
    expected.some((arg) => !args.includes(arg))
  )
    throw new Error("All four exact bounded-smoke confirmations are required.");
  confirmSmoke(confirmations);
  root = await mkdtemp(join(PROJECT, ".lab-test-smoke-"));
  lab = await new Lab("smoke", root).init();
  console.log(JSON.stringify(await lab.boundedSmoke(confirmations), null, 2));
} catch (error) {
  // Provider status, native error text, account labels and credentials stay private.
  if (error instanceof SmokeUnavailable) {
    console.error(
      JSON.stringify({
        mode: "denied",
        code: error.code,
        inferenceRequests: 0,
      }),
    );
    process.exitCode = 3;
  } else {
    console.error(
      "Bounded smoke failed or was denied. No general paid suite was authorized.",
    );
    process.exitCode = 2;
  }
} finally {
  await lab?.close();
  if (root) await rm(root, { recursive: true, force: true });
}
