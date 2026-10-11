import { loadProjectEnv } from "./project-env.ts";

try {
  loadProjectEnv();
} catch {
  process.stderr.write(
    "Project .env could not be loaded safely. Check the local file; values are never printed.\n",
  );
  process.exit(2);
}
