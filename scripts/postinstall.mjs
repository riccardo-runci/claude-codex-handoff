import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  const src = path.join(__dirname, "..", "commands", "claude-handoff.md");
  const destDir = path.join(os.homedir(), ".claude", "commands");
  const dest = path.join(destDir, "claude-handoff.md");

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`claude-handoff: slash-command installato in ${dest}`);
} catch (err) {
  console.warn(
    `claude-handoff: non sono riuscito a installare lo slash-command /claude-handoff (${err.message}). ` +
      `Il comando terminale 'claude-handoff' funziona comunque normalmente.`
  );
}
