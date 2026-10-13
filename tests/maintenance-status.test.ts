import assert from "node:assert/strict";
import test from "node:test";
import { maintenanceExitCode } from "../src/maintenance-status.ts";

const stages = {
  flush: "pass",
  compaction: "pass",
  compactionRecall: "pass",
  dreaming: "pass",
  postDreamRecall: "pass",
};

test("only a complete passing maintenance result permits successful CLI exit", () => {
  assert.equal(maintenanceExitCode({ stages }), 0);
  assert.equal(maintenanceExitCode({ stages, error: "native failure" }), 2);
  assert.equal(maintenanceExitCode({}), 2);
});

for (const name of Object.keys(stages)) {
  test(`failed or omitted ${name} stops successful acceptance without a result.error`, () => {
    assert.equal(
      maintenanceExitCode({ stages: { ...stages, [name]: "fail" } }),
      2,
    );
    const missing = { ...stages } as Record<string, string>;
    delete missing[name];
    assert.equal(maintenanceExitCode({ stages: missing }), 2);
  });
}
