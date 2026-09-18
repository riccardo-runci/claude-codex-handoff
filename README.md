# claude-codex-handoff

Passa il contesto di una sessione [Claude Code](https://claude.com/claude-code) a
[Codex CLI](https://developers.openai.com/codex/cli) quando Claude finisce i crediti
o va in rate-limit a metà di un task.

Legge direttamente i transcript JSONL che Claude Code salva su disco
(`~/.claude/projects/...`) — **non chiama mai Claude**, quindi funziona anche
quando Claude è irraggiungibile, che è esattamente lo scenario per cui serve.

## Installazione

```bash
npm install -g git+https://github.com/riccardo-runci/claude-codex-handoff.git
```

Questo installa il comando globale `claude-handoff` e, in automatico (best-effort),
lo slash-command `/claude-handoff` dentro Claude Code (copiato in `~/.claude/commands/`).

Requisiti: Node.js ≥ 18. [Codex CLI](https://developers.openai.com/codex/cli) è
necessario solo se usi `--run-codex`.

## Uso

```bash
claude-handoff                                    # help
claude-handoff                                     # senza argomenti: help
claude-handoff --project C:\percorso\progetto      # handoff per un progetto specifico (default: cwd)
claude-handoff --session <uuid>                    # sessione specifica (default: la più recente)
claude-handoff --out contesto.md                   # file di output custom
claude-handoff --max-tool-output 5000               # più contesto per output dei tool
claude-handoff --run-codex                          # genera l'handoff E lancia subito Codex con quel contesto
```

Di default lo script prende automaticamente la directory corrente come progetto
e la sessione Claude più recente per quel progetto.

Da dentro Claude Code, `/claude-handoff` fa la stessa cosa (utile mentre Claude
è ancora vivo; nello scenario "crediti finiti" usa il comando da terminale).

## Cosa genera

Un file markdown con:
- conversazione completa (testo utente/assistente, tool call, risultati tool)
- nota esplicita se l'ultima azione era un tool-call senza risultato (task interrotto a metà)
- elenco dei file toccati nella sessione
- stato git del progetto (branch, `status`, `diff`)

## Come funziona `--run-codex`

Lancia `codex exec -C "<progetto>" - < handoff.md`, passando il markdown generato
come prompt iniziale via stdin. Cerca `codex` nel PATH, con fallback al percorso
di installazione standard (`~/.codex/packages/standalone/current/bin/codex[.exe]`).
