// Zapíše, která verze se nasazuje (čte /api/verze). Nikdy nesmí shodit deploy.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let commit = process.env.WORKERS_CI_COMMIT_SHA ?? "";
if (!commit) {
  try {
    commit = execSync("git rev-parse HEAD").toString().trim();
  } catch {
    commit = "neznámý";
  }
}
writeFileSync(
  "src/build-info.json",
  JSON.stringify({ commit: commit.slice(0, 7), builtAt: new Date().toISOString() }),
);
