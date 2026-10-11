import type { Lab } from "../src/lab.ts";

/** Optional acceptance gates. Configuration/unit tests never use these gates. */
export function modelGate(
  kind: "text" | "vector",
  env: NodeJS.ProcessEnv,
): false | string {
  const native =
    kind === "text" ? env.LAB_NATIVE_MODEL_REF : env.LAB_NATIVE_VECTOR_URL;
  const keyName =
    kind === "text" ? env.LAB_NATIVE_KEY_ENV : env.LAB_NATIVE_VECTOR_KEY_ENV;
  if (native || keyName) {
    const model = kind === "text" ? native : env.LAB_NATIVE_VECTOR_MODEL;
    if (!native || !model || !keyName || env.LAB_ALLOW_MODEL_REQUESTS !== "1")
      return "Native provider acceptance requires explicit model/endpoint/key-env selection and LAB_ALLOW_MODEL_REQUESTS=1 after budget approval.";
    return "Paid native acceptance is blocked: strict spending reservation is unavailable; opt-in and quota estimates are not a hard cap.";
  }
  return kind === "text"
    ? env.LAB_MODEL_URL && env.LAB_MODEL_NAME
      ? false
      : "Choose a genuine local model or explicitly approved native provider; no simulated model."
    : env.LAB_VECTOR_URL && env.LAB_VECTOR_MODEL
      ? false
      : "Choose genuine local embeddings or explicitly approved native compatible embeddings; no fake semantic acceptance.";
}

export async function selectTextModel(lab: Lab) {
  if (process.env.LAB_NATIVE_MODEL_REF)
    return lab.configureNativeModel(
      process.env.LAB_NATIVE_MODEL_REF,
      process.env.LAB_NATIVE_KEY_ENV ?? "",
    );
  return lab.configureTextModel(
    process.env.LAB_MODEL_URL ?? "",
    process.env.LAB_MODEL_NAME ?? "",
  );
}

export async function selectVectorModel(lab: Lab) {
  if (process.env.LAB_NATIVE_VECTOR_URL) {
    await lab.configureNativeVector(
      process.env.LAB_NATIVE_VECTOR_URL,
      process.env.LAB_NATIVE_VECTOR_MODEL ?? "",
      process.env.LAB_NATIVE_VECTOR_KEY_ENV ?? "",
    );
    return lab.index(); // Explicit acceptance execution, after the gate; never a setup side effect.
  }
  return lab.configureVector(
    process.env.LAB_VECTOR_URL ?? "",
    process.env.LAB_VECTOR_MODEL ?? "",
  );
}
