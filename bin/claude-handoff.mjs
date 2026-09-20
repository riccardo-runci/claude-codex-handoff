#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

const CODEX_FALLBACK_PATH = path.join(
  os.homedir(),
  ".codex",
  "packages",
  "standalone",
  "current",
  "bin",
  process.platform === "win32" ? "codex.exe" : "codex"
);

function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    session: null,
    out: null,
    maxToolOutput: 2000,
    maxTotalChars: 700000,
    maxDiffChars: 50000,
    runCodex: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") out.project = argv[++i];
    else if (a === "--session") out.session = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--max-tool-output") out.maxToolOutput = parseInt(argv[++i], 10);
    else if (a === "--max-total-chars") out.maxTotalChars = parseInt(argv[++i], 10);
    else if (a === "--max-diff-chars") out.maxDiffChars = parseInt(argv[++i], 10);
    else if (a === "--run-codex") out.runCodex = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Argomento sconosciuto: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Uso: claude-handoff [opzioni]

Genera un file markdown con tutto il contesto necessario a Codex CLI per
continuare un task iniziato con Claude Code, leggendo la sessione salvata
su disco (nessuna chiamata a Claude — funziona anche a crediti/rate-limit
Claude esauriti).

Opzioni:
  --project <path>       Directory progetto (default: cwd corrente)
  --session <uuid>       Sessione specifica (default: piu' recente per mtime)
  --out <path>           File di output (default: ./handoff-<id>-<ts>.md)
  --max-tool-output <n>  Caratteri max per output dei tool (default: 2000)
  --max-total-chars <n>  Limite totale caratteri dell'intero documento, tronca i
                         turni piu' vecchi tenendo i piu' recenti (default: 700000;
                         Codex CLI rifiuta input oltre ~1048576 caratteri)
  --max-diff-chars <n>   Caratteri max per il 'git diff' incluso (default: 50000)
  --run-codex            Lancia subito 'codex exec' col file generato
  -h, --help             Questo help

Esempi:
  claude-handoff                                  Handoff della sessione piu' recente in questa cartella
  claude-handoff --run-codex                       Come sopra, e lancia subito Codex col contesto
  claude-handoff --project C:\\progetti\\foo         Handoff per un altro progetto
  claude-handoff --session <uuid> --out ctx.md     Sessione specifica, output custom
`);
}

function encodeProjectDir(projectPath) {
  const abs = path.resolve(projectPath);
  return abs.replace(/[^a-zA-Z0-9]/g, "-");
}

function findSessionFile(project, sessionId) {
  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  const encoded = encodeProjectDir(project);
  const dir = path.join(claudeProjectsDir, encoded);

  if (!fs.existsSync(dir)) {
    throw new Error(
      `Nessuna cartella sessioni Claude trovata per il progetto:\n  ${dir}\n` +
        `(progetto: ${project})`
    );
  }

  if (sessionId) {
    const f = path.join(dir, `${sessionId}.jsonl`);
    if (!fs.existsSync(f)) throw new Error(`Sessione non trovata: ${f}`);
    return f;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const full = path.join(dir, f);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error(`Nessun file .jsonl in ${dir}`);
  return files[0].full;
}

function readJsonl(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // riga corrotta/incompleta, ignora
    }
  }
  return entries;
}

function truncate(str, max) {
  if (typeof str !== "string") str = JSON.stringify(str);
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n...[troncato, ${str.length - max} caratteri omessi]`;
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function flattenTurns(entries, maxToolOutput) {
  const turns = [];
  let lastAssistantHadUnresolvedToolUse = false;

  for (const e of entries) {
    if (e.type === "user") {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        const toolResults = content.filter((b) => b && b.type === "tool_result");
        for (const tr of toolResults) {
          turns.push({
            kind: "tool_result",
            toolUseId: tr.tool_use_id,
            isError: !!tr.is_error,
            content: truncate(
              typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
              maxToolOutput
            ),
          });
          lastAssistantHadUnresolvedToolUse = false;
        }
        const text = extractTextFromContent(content);
        if (text.trim()) turns.push({ kind: "user_text", text });
      } else if (typeof content === "string" && content.trim()) {
        turns.push({ kind: "user_text", text: content });
      }
    } else if (e.type === "assistant") {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "text" && b.text?.trim()) {
            turns.push({ kind: "assistant_text", text: b.text });
          } else if (b.type === "tool_use") {
            turns.push({
              kind: "tool_use",
              id: b.id,
              name: b.name,
              input: truncate(JSON.stringify(b.input), 500),
            });
            lastAssistantHadUnresolvedToolUse = true;
          }
        }
      }
    }
  }

  return { turns, lastAssistantHadUnresolvedToolUse };
}

function collectTouchedFiles(entries) {
  const files = new Set();
  for (const e of entries) {
    if (e.type === "assistant") {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_use" && b.input) {
            const p = b.input.file_path || b.input.path;
            if (typeof p === "string") files.add(p);
          }
        }
      }
    }
    if (e.type === "file-history-snapshot" || e.type === "file-history-delta") {
      if (typeof e.filePath === "string") files.add(e.filePath);
      if (typeof e.path === "string") files.add(e.path);
    }
  }
  return [...files].sort();
}

function gitState(project, maxDiffChars) {
  try {
    const status = execFileSync("git", ["status", "--short"], {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const rawDiff = execFileSync("git", ["diff", "HEAD"], {
      cwd: project,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const diff = truncate(rawDiff, maxDiffChars);
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { isRepo: true, branch, status, diff };
  } catch {
    return { isRepo: false };
  }
}

function formatTurn(t) {
  switch (t.kind) {
    case "user_text":
      return `### Utente\n\n${t.text}\n`;
    case "assistant_text":
      return `### Claude\n\n${t.text}\n`;
    case "tool_use":
      return `**[tool_use] ${t.name}**\n\`\`\`json\n${t.input}\n\`\`\`\n`;
    case "tool_result":
      return `**[tool_result]${t.isError ? " (ERRORE)" : ""}**\n\`\`\`\n${t.content}\n\`\`\`\n`;
    default:
      return "";
  }
}

function truncateTurns(turns, maxChars) {
  const formatted = turns.map(formatTurn);
  const total = formatted.reduce((sum, s) => sum + s.length, 0);
  if (total <= maxChars) {
    return { turns, droppedCount: 0 };
  }

  let kept = [];
  let usedChars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const len = formatted[i].length;
    if (usedChars + len > maxChars) break;
    kept.unshift(turns[i]);
    usedChars += len;
  }

  return { turns: kept, droppedCount: turns.length - kept.length };
}

function buildMarkdown({ project, sessionFile, sessionId, turns, unresolved, touchedFiles, git, droppedCount }) {
  const lines = [];
  lines.push(`# Handoff Claude Code -> Codex`);
  lines.push("");
  lines.push(`Generato: ${new Date().toISOString()}`);
  lines.push(`Progetto: \`${project}\``);
  lines.push(`Sessione Claude: \`${sessionId}\``);
  lines.push(`File sorgente: \`${sessionFile}\``);
  lines.push("");

  if (unresolved) {
    lines.push(
      `> **Nota ripresa:** l'ultima azione di Claude era una chiamata a tool ancora senza risultato ` +
        `(sessione probabilmente interrotta a meta', es. per crediti/rate-limit finiti). ` +
        `Controlla l'ultimo blocco \`tool_use\` qui sotto: potrebbe non essere andato a buon fine o non essere mai stato eseguito.`
    );
    lines.push("");
  }

  lines.push(`## Task`);
  lines.push("");
  lines.push(
    `Sei Codex, stai riprendendo un task lasciato a meta' da Claude Code sullo stesso progetto. ` +
      `Sotto trovi la conversazione completa (testo + tool call + risultati), i file toccati e lo stato git attuale. ` +
      `Usa questo contesto per continuare da dove Claude si e' fermato, senza ripartire da zero.`
  );
  lines.push("");

  lines.push(`## Conversazione`);
  lines.push("");
  if (droppedCount > 0) {
    lines.push(
      `> **Nota:** i ${droppedCount} turni piu' vecchi sono stati omessi per rientrare nel limite ` +
        `di dimensione input (Codex CLI rifiuta prompt oltre ~1048576 caratteri). Sotto trovi solo la parte ` +
        `piu' recente della conversazione, quella rilevante per riprendere il task da dove si e' fermato.`
    );
    lines.push("");
  }
  for (const t of turns) {
    lines.push(formatTurn(t));
  }

  lines.push(`## File toccati`);
  lines.push("");
  if (touchedFiles.length === 0) {
    lines.push("(nessuno rilevato)");
  } else {
    for (const f of touchedFiles) lines.push(`- \`${f}\``);
  }
  lines.push("");

  lines.push(`## Stato git`);
  lines.push("");
  if (!git.isRepo) {
    lines.push("(non e' un repository git, o git non disponibile)");
  } else {
    lines.push(`Branch: \`${git.branch}\``);
    lines.push("");
    lines.push("### git status --short");
    lines.push("```");
    lines.push(git.status.trim() || "(pulito)");
    lines.push("```");
    lines.push("");
    lines.push("### git diff HEAD");
    lines.push("```diff");
    lines.push(git.diff.trim() || "(nessuna differenza)");
    lines.push("```");
  }
  lines.push("");

  return lines.join("\n");
}

function findCodexBinary() {
  const finder = process.platform === "win32" ? "where" : "which";
  const probe = spawnSync(finder, ["codex"], { encoding: "utf8" });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  }
  if (fs.existsSync(CODEX_FALLBACK_PATH)) return CODEX_FALLBACK_PATH;
  return null;
}

function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    printHelp();
    process.exit(0);
  }
  const args = parseArgs(rawArgs);

  const sessionFile = findSessionFile(args.project, args.session);
  const sessionId = path.basename(sessionFile, ".jsonl");
  const entries = readJsonl(sessionFile);
  const { turns: allTurns, lastAssistantHadUnresolvedToolUse } = flattenTurns(entries, args.maxToolOutput);
  const touchedFiles = collectTouchedFiles(entries);
  const git = gitState(args.project, args.maxDiffChars);

  // Prima misura quanto pesa il documento senza la conversazione (header, task,
  // file toccati, stato git/diff), poi assegna il budget residuo ai turni: cosi'
  // il limite --max-total-chars vale sul documento intero, non solo sui turni.
  const skeleton = buildMarkdown({
    project: args.project,
    sessionFile,
    sessionId,
    turns: [],
    unresolved: lastAssistantHadUnresolvedToolUse,
    touchedFiles,
    git,
    droppedCount: 0,
  });
  const conversationBudget = Math.max(0, args.maxTotalChars - skeleton.length - 2000);
  const { turns, droppedCount } = truncateTurns(allTurns, conversationBudget);

  const md = buildMarkdown({
    project: args.project,
    sessionFile,
    sessionId,
    turns,
    unresolved: lastAssistantHadUnresolvedToolUse,
    touchedFiles,
    git,
    droppedCount,
  });

  const outPath =
    args.out ||
    path.join(
      process.cwd(),
      `handoff-${sessionId.slice(0, 8)}-${Date.now()}.md`
    );
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`Handoff scritto in: ${outPath}`);
  console.log(`Sessione usata: ${sessionId}`);
  if (lastAssistantHadUnresolvedToolUse) {
    console.log("Attenzione: task probabilmente interrotto a meta' (tool_use senza risultato).");
  }
  if (droppedCount > 0) {
    console.log(
      `Attenzione: conversazione troppo grande, ${droppedCount} turni piu' vecchi omessi ` +
        `(usa --max-total-chars per alzare/abbassare il limite, default 700000).`
    );
  }

  const codexBin = findCodexBinary();
  const extraFlags = git.isRepo ? [] : ["--skip-git-repo-check"];
  const cmdPreview = `codex exec -C "${args.project}" ${extraFlags.join(" ")} - < "${outPath}"`.replace(/\s+/g, " ");

  if (args.runCodex) {
    if (!codexBin) {
      console.error("codex non trovato ne' nel PATH ne' nel percorso di fallback. Comando da eseguire manualmente:");
      console.error(`  ${cmdPreview}`);
      process.exit(1);
    }
    console.log(`Lancio: ${codexBin} exec -C "${args.project}" ${extraFlags.join(" ")} -   (stdin = ${outPath})`);
    const res = spawnSync(codexBin, ["exec", "-C", args.project, ...extraFlags, "-"], {
      stdio: ["pipe", "inherit", "inherit"],
      input: md,
    });
    process.exit(res.status ?? 1);
  } else {
    console.log("");
    console.log("Per continuare in Codex, esegui:");
    console.log(`  ${cmdPreview}`);
    if (!codexBin) {
      console.log(
        `(nota: 'codex' non risulta nel PATH di questa shell; se il comando sopra fallisce usa il path assoluto: ${CODEX_FALLBACK_PATH})`
      );
    }
  }
}

main();
