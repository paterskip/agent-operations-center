#!/usr/bin/env bash
set -euo pipefail

echo "==> Uruchamianie walidacji Tier 1 & Tier 2 dla skilli agentów AOC..."
npx vitest run lib/skills-registry.test.ts
npx --yes tsx scripts/eval-skills.ts
