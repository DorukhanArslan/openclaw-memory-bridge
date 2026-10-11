import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  loadProjectEnv,
  MissingEnvironmentError,
  PROJECT_ENV,
  requireEnvironment,
} from "../src/project-env.ts";

const project = dirname(PROJECT_ENV);
const node = join(project, "node_modules/node/bin/node");
const canary = "synthetic-env-secret-canary";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bridge-env-test-"));
  const file = join(root, ".env");
  return {
    root,
    file,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("ENV: native dotenv parsing preserves inherited values, including empty ones", () => {
  const f = fixture();
  try {
    writeFileSync(
      f.file,
      `OPENROUTER_API_KEY=${canary}\nLAB_MODEL_NAME="quoted model" # comment\nLAB_VECTOR_MODEL=from-file\nSYNTHETIC_PROVIDER_KEY='$(echo never-executed)'\n`,
      { mode: 0o600 },
    );
    const env: NodeJS.ProcessEnv = {
      OPENROUTER_API_KEY: "",
      LAB_VECTOR_MODEL: "inherited",
    };
    loadProjectEnv(env, f.file);
    assert.deepEqual(env, {
      OPENROUTER_API_KEY: "",
      LAB_MODEL_NAME: "quoted model",
      LAB_VECTOR_MODEL: "inherited",
      SYNTHETIC_PROVIDER_KEY: "$(echo never-executed)",
    });
    assert.throws(
      () => requireEnvironment(["OPENROUTER_API_KEY"], env),
      MissingEnvironmentError,
    );
    assert.equal(readFileSync(f.file, "utf8").includes(canary), true);
    assert.equal(statSync(f.file).mode & 0o077, 0);
  } finally {
    f.close();
  }
});

test("ENV: file errors are sanitized and validation is atomic", () => {
  const f = fixture();
  try {
    for (const invalid of [
      `NODE_OPTIONS=${canary}`,
      `OPENCLAW_GATEWAY_BIND=${canary}`,
      `PATH=${canary}`,
      `UNRELATED_SETTING=${canary}`,
      `SYNTHETIC_PROVIDER_KEY="${canary}\nsecond line"`,
      `SYNTHETIC_PROVIDER_KEY=${canary}\0`,
    ]) {
      writeFileSync(f.file, `LAB_MODEL_NAME=valid-first\n${invalid}\n`);
      const env = {};
      assert.throws(
        () => loadProjectEnv(env, f.file),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message.includes(canary), false);
          assert.match(error.message, /could not be loaded safely/);
          return true;
        },
      );
      assert.deepEqual(env, {});
    }
  } finally {
    f.close();
  }
});

test("ENV: missing files are optional; presence errors expose names only", () => {
  const f = fixture();
  try {
    const env = { SYNTHETIC_PROVIDER_KEY: canary };
    loadProjectEnv(env, f.file);
    requireEnvironment(["SYNTHETIC_PROVIDER_KEY"], env);
    assert.throws(
      () => requireEnvironment(["BRIDGE_GATEWAY_TOKEN"], env),
      (error: unknown) => {
        assert.ok(error instanceof MissingEnvironmentError);
        assert.match(error.message, /BRIDGE_GATEWAY_TOKEN/);
        assert.match(error.message, /Edit the project's .env locally/);
        assert.equal(error.message.includes(canary), false);
        return true;
      },
    );
    assert.throws(
      () => requireEnvironment([canary], env),
      /Unsupported required/,
    );
  } finally {
    f.close();
  }
});

test("ENV: symlinks and nonregular files cannot redirect the loader", () => {
  const f = fixture();
  try {
    const target = join(f.root, "synthetic-external-file");
    writeFileSync(target, `SYNTHETIC_PROVIDER_KEY=${canary}\n`);
    symlinkSync(target, f.file);
    assert.throws(
      () => loadProjectEnv({}, f.file),
      /could not be loaded safely/,
    );
    rmSync(f.file);
    mkdirSync(f.file);
    assert.throws(
      () => loadProjectEnv({}, f.file),
      /could not be loaded safely/,
    );
  } finally {
    f.close();
  }
});

test("ENV: preload, test and smoke wrapper use their own project file from another cwd", () => {
  const f = fixture();
  try {
    for (const dir of [
      "src",
      "scripts",
      "examples",
      "tests",
      "elsewhere",
      "node_modules/node/bin",
    ])
      mkdirSync(join(f.root, dir), { recursive: true });
    for (const name of ["project-env.ts", "load-env.ts", "provider-handoff.ts"])
      copyFileSync(join(project, "src", name), join(f.root, "src", name));
    copyFileSync(
      join(project, "scripts/bounded-smoke.sh"),
      join(f.root, "scripts/bounded-smoke.sh"),
    );
    writeFileSync(join(f.root, "package.json"), '{"type":"module"}\n');
    symlinkSync(node, join(f.root, "node_modules/node/bin/node"));
    writeFileSync(
      f.file,
      `SYNTHETIC_PROVIDER_KEY=${canary}\nOPENROUTER_API_KEY=${canary}\n`,
    );
    const cwd = join(f.root, "elsewhere");
    writeFileSync(join(cwd, ".env"), "SYNTHETIC_PROVIDER_KEY=wrong-cwd\n");
    const preload = join(f.root, "src/load-env.ts");
    const env = { PATH: "/usr/bin:/bin" };
    const check = `console.log(JSON.stringify({fromProject:process.env.SYNTHETIC_PROVIDER_KEY===${JSON.stringify(canary)}}));`;
    assert.deepEqual(
      JSON.parse(
        execFileSync(node, ["--import", preload, "--eval", check], {
          cwd,
          env,
          encoding: "utf8",
        }),
      ),
      { fromProject: true },
    );
    writeFileSync(
      join(f.root, "tests/check.test.ts"),
      `import assert from 'node:assert/strict'; import {test} from 'node:test'; test('synthetic file handoff',()=>assert.ok(process.env.SYNTHETIC_PROVIDER_KEY===${JSON.stringify(canary)}));`,
    );
    const tested = execFileSync(
      node,
      [
        "--import",
        preload,
        "--test",
        "--test-reporter=tap",
        join(f.root, "tests/check.test.ts"),
      ],
      { cwd, env, encoding: "utf8" },
    );
    assert.match(tested, /# pass 1/);
    assert.equal(tested.includes(canary), false);
    // Adapter fixture replaces only the final smoke program; no native/provider call.
    writeFileSync(
      join(f.root, "examples/bounded_smoke.ts"),
      `import '../src/load-env.ts'; console.log(JSON.stringify({fileKey:process.env.OPENROUTER_API_KEY===${JSON.stringify(canary)},inheritedKey:process.env.OPENROUTER_API_KEY==='synthetic-inherited-key'}));`,
    );
    const script = join(f.root, "scripts/bounded-smoke.sh");
    for (const inherited of [false, true]) {
      const result = spawnSync(
        "/bin/bash",
        ["--noprofile", "--norc", "-x", script],
        {
          cwd,
          env: {
            ...env,
            ...(inherited
              ? { OPENROUTER_API_KEY: "synthetic-inherited-key" }
              : {}),
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0);
      assert.equal((result.stdout + result.stderr).includes(canary), false);
      assert.equal(
        (result.stdout + result.stderr).includes("synthetic-inherited-key"),
        false,
      );
      assert.deepEqual(
        JSON.parse(result.stdout.trim().split("\n").at(-1) ?? ""),
        { fileKey: !inherited, inheritedKey: inherited },
      );
    }
    writeFileSync(f.file, `NODE_OPTIONS=${canary}\n`);
    const failed = spawnSync(
      node,
      ["--import", preload, "--eval", "console.log('must not execute')"],
      { cwd, env, encoding: "utf8" },
    );
    assert.equal(failed.status, 2);
    assert.equal(failed.stdout, "");
    assert.equal(failed.stderr.includes(canary), false);
    assert.match(failed.stderr, /values are never printed/);
  } finally {
    f.close();
  }
});

test("ENV: missing bounded-smoke key fails before workspace creation, with no prompt", () => {
  const before = readdirSync(project).filter((name) =>
    name.startsWith(".lab-test-smoke-"),
  );
  const env = { PATH: "/usr/bin:/bin", OPENROUTER_API_KEY: "" };
  for (const [command, args] of [
    [node, [join(project, "examples/bounded_smoke.ts")]],
    [
      "/bin/bash",
      ["--noprofile", "--norc", join(project, "scripts/bounded-smoke.sh")],
    ],
  ] as const) {
    const result = spawnSync(command, [...args], {
      cwd: tmpdir(),
      env,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /Missing required environment settings: OPENROUTER_API_KEY/,
    );
    assert.match(result.stderr, /Edit the project's .env locally/);
    assert.doesNotMatch(result.stderr + result.stdout, /hidden|real-provider/);
  }
  assert.deepEqual(
    readdirSync(project).filter((name) => name.startsWith(".lab-test-smoke-")),
    before,
  );
});

test("ENV: Git excludes credential files and tracks only the keyless template", () => {
  const ignored = spawnSync(
    "git",
    [
      "check-ignore",
      "--no-index",
      ".env",
      ".env.local",
      ".env.production",
      ".env.example",
    ],
    { cwd: project, encoding: "utf8" },
  );
  assert.equal(ignored.status, 0);
  assert.deepEqual(ignored.stdout.trim().split("\n"), [
    ".env",
    ".env.local",
    ".env.production",
  ]);
  const tracked = execFileSync("git", ["ls-files", "--", ".env", ".env.*"], {
    cwd: project,
    encoding: "utf8",
  });
  assert.ok(
    tracked
      .trim()
      .split("\n")
      .every((name) => !name || name === ".env.example"),
  );
  const template = {};
  loadProjectEnv(template, join(project, ".env.example"));
  assert.deepEqual(template, { OPENROUTER_API_KEY: "" });
});
