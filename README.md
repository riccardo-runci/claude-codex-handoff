# claude-codex-handoff

Passa il contesto di una sessione [Claude Code](https://claude.com/claude-code) a
[Codex CLI](https://developers.openai.com/codex/cli) quando Claude finisce i crediti
o va in rate-limit a metà di un task.

Legge direttamente i transcript JSONL che Claude Code salva su disco
(`~/.claude/projects/...`) — **non chiama mai Claude**, quindi funziona anche
quando Claude è irraggiungibile, che è esattamente lo scenario per cui serve.

## Installazione

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/riccardo-runci/claude-codex-handoff/main/install.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/riccardo-runci/claude-codex-handoff/main/install.sh | bash
```

Questo clona la repo in `~/.claude-handoff` e crea il comando globale `claude-handoff`
via `npm link`, installando anche (best-effort) lo slash-command `/claude-handoff`
dentro Claude Code (copiato in `~/.claude/commands/`).

> Non usare `npm install -g git+https://...` per questo pacchetto: su Windows soffre
> di un bug noto di npm con le dipendenze git installate globalmente (symlink verso
> una cartella temporanea della cache che può sparire prima che il postinstall giri),
> che fa fallire l'installazione in modo intermittente. Lo script sopra lo evita del
> tutto usando un `git clone` in una cartella stabile.

**Aggiornare:** rilancia lo stesso comando di installazione — fa `git pull` + re-link.

**Manuale** (equivalente a quanto fanno gli script sopra):
```bash
git clone https://github.com/riccardo-runci/claude-codex-handoff.git ~/.claude-handoff
cd ~/.claude-handoff
npm link
```

Requisiti: Node.js ≥ 18, git. [Codex CLI](https://developers.openai.com/codex/cli) è
necessario solo se usi `--run-codex`.

## Uso

```bash
claude-handoff                                    # help
claude-handoff                                     # senza argomenti: help
claude-handoff --project C:\percorso\progetto      # handoff per un progetto specifico (default: cwd)
claude-handoff --session <uuid>                    # sessione specifica (default: la più recente)
claude-handoff --out contesto.md                   # file di output custom
claude-handoff --max-tool-output 5000               # più contesto per output dei tool
claude-handoff --max-total-chars 500000              # limite totale più basso (default 700000)
claude-handoff --run-codex                          # genera l'handoff E lancia subito Codex con quel contesto
```

Di default lo script prende automaticamente la directory corrente come progetto
e la sessione Claude più recente per quel progetto.

Da dentro Claude Code, `/claude-handoff` fa la stessa cosa (utile mentre Claude
è ancora vivo; nello scenario "crediti finiti" usa il comando da terminale).

## Cosa genera

Un file markdown con:
- conversazione completa (testo utente/assistente, tool call, risultati tool), troncata
  automaticamente ai turni più recenti se supera `--max-total-chars` (default 700000,
  per stare sotto il limite di ~1MB che Codex CLI impone all'input)
- nota esplicita se l'ultima azione era un tool-call senza risultato (task interrotto a metà)
- elenco dei file toccati nella sessione
- stato git del progetto (branch, `status`, `diff`)

## Come funziona `--run-codex`

Lancia `codex exec -C "<progetto>" - < handoff.md`, passando il markdown generato
come prompt iniziale via stdin. Cerca `codex` nel PATH, con fallback al percorso
di installazione standard (`~/.codex/packages/standalone/current/bin/codex[.exe]`).
