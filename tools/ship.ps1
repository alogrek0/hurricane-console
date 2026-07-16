# tools/ship.ps1 — the whole merge-when-green flow in ONE invocation.
#
# Why this exists: driving ship step-by-step from an agent costs a dozen
# tool round-trips, each re-reading the whole session context. This script
# collapses commit -> push -> PR -> CI watch -> merge -> sync into one call
# with deliberately terse output (full detail only on failure).
#
# Usage (from anywhere in the repo; the agent writes the two files first):
#   powershell -NoProfile -File tools/ship.ps1 -Branch <name> -Title "<PR title>" `
#     -MessageFile <path> -BodyFile <path> [-Hold]
#
#   -MessageFile  commit message, ending with the Co-Authored-By line
#   -BodyFile     PR body (## Summary / ## Verification / Generated-with line)
#   -Hold         stop after the PR goes green; do not merge (active-storm rule)
#
# Covers the common case: everything in the working tree as ONE commit. For
# multi-commit PRs or conflict recovery, fall back to the manual steps in
# .claude/skills/ship/SKILL.md.
#
# Windows PowerShell 5.1 compatible (no &&, no ternary).

param(
  [Parameter(Mandatory = $true)][string]$Branch,
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$MessageFile,
  [Parameter(Mandatory = $true)][string]$BodyFile,
  [switch]$Hold
)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)   # repo root

function Fail([string]$msg) { Write-Host "SHIP FAILED: $msg"; exit 1 }

$gh = 'gh'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  $gh = 'C:\Program Files\GitHub CLI\gh.exe'
  if (-not (Test-Path $gh)) { Fail 'gh CLI not found' }
}

foreach ($f in @($MessageFile, $BodyFile)) {
  if (-not (Test-Path $f)) { Fail "file not found: $f" }
}

# --- preflight ---------------------------------------------------------------
# never ship red; print only the summary line unless something fails
$testOut = node test.js
if ($LASTEXITCODE -ne 0) { Fail "tests red:`n$($testOut -join "`n")" }
Write-Host ("preflight: " + ($testOut | Select-Object -Last 1))

# never commit browser-automation junk (skill rule: delete, don't ship)
if (Test-Path .playwright-mcp) { Remove-Item -Recurse -Force .playwright-mcp }
Get-ChildItem -File -Filter *.png | ForEach-Object {
  git ls-files --error-unmatch $_.Name 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Remove-Item $_.FullName; Write-Host "deleted stray $($_.Name)" }
}

# --- branch ------------------------------------------------------------------
$cur = (git rev-parse --abbrev-ref HEAD).Trim()
if ($cur -eq 'main') {
  git fetch origin | Out-Null
  git pull | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'git pull on main failed' }
  git checkout -b $Branch 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not create branch $Branch" }
  $cur = $Branch
}

# --- commit + push -----------------------------------------------------------
$dirty = git status --porcelain
if ($dirty) {
  git add -A
  git commit -F $MessageFile | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'git commit failed' }
} elseif (-not (git log origin/main..HEAD --oneline 2>$null)) {
  Fail 'nothing to ship (clean tree, no unpushed commits)'
}
Write-Host ("commit: " + (git log -1 --oneline))

git push -u origin $cur 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "git push failed (pre-push version guard?) — run 'git push -u origin $cur' to see why" }

# --- PR (reuse an existing one for this branch) --------------------------------
$prUrl = & $gh pr view --json url --jq .url 2>$null
if ($LASTEXITCODE -ne 0) {
  $prUrl = & $gh pr create --title $Title --body-file $BodyFile
  if ($LASTEXITCODE -ne 0) { Fail 'gh pr create failed' }
}
Write-Host "pr: $prUrl"

# --- CI ----------------------------------------------------------------------
# right after creation the job may not be registered yet ("no checks reported")
$tries = 0
do {
  Start-Sleep -Seconds 15
  $checks = (& $gh pr checks --watch --fail-fast 2>&1 | Out-String).Trim()
  $code = $LASTEXITCODE
  $tries++
} while ($code -ne 0 -and $checks -match 'no checks reported' -and $tries -lt 4)
if ($code -ne 0) { Fail "CI not green — PR left open, NOT merged:`n$checks" }
Write-Host 'ci: green'

if ($Hold) { Write-Host "HOLD: PR is green and waiting — $prUrl"; exit 0 }

# --- merge + sync ------------------------------------------------------------
& $gh pr merge --merge | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "merge blocked (conflict with a just-merged PR?) — PR is green at $prUrl; see SKILL.md notes" }
git checkout main 2>$null | Out-Null
git pull | Out-Null
git branch -d $cur | Out-Null
git push origin --delete $cur 2>$null | Out-Null   # may already be auto-deleted
Write-Host ("merged: " + (git log -1 --oneline))
Write-Host "Pages redeploys within a minute; live clients get the update banner on next reload."
