import { discoverSkills, validateSkillTier1, validateSkillTier2, getSkillCatalogSummary } from "../lib/skills-registry";

function runEvaluation() {
  console.log("\n========================================================");
  console.log(" 🛡️  AOC / NVIDIA SkillEvaluator — Tier 1 & Tier 2 Gate");
  console.log("========================================================\n");

  const summary = getSkillCatalogSummary();
  console.log(`📊 Znaleziono skilli w katalogu: ${summary.totalSkills}`);
  console.log(`✅ Zweryfikowane (Verified):    ${summary.verifiedSkills}`);
  console.log(`🚀 Średni Skill Lift:           +${summary.avgSkillLift} pkt`);
  console.log(`⚡ Średnia oszczędność tokenów:  ${summary.avgTokenSavings}%\n`);

  let hasErrors = false;

  for (const skill of summary.skills) {
    console.log(`--------------------------------------------------------`);
    console.log(`📦 Skill: \x1b[1m${skill.slug}\x1b[0m (v${skill.version})`);
    console.log(`   Rola/Agenci: [${skill.assignedAgents.join(", ")}]`);
    console.log(`   Triggery:   [${skill.triggers.join(", ")}]`);

    // Tier 1 Validation
    const t1 = validateSkillTier1(skill.slug);
    if (t1.isValid) {
      console.log(`   Tier 1 (Static & Security): \x1b[32mPASS\x1b[0m (Wynik: ${t1.score}/100)`);
    } else {
      console.log(`   Tier 1 (Static & Security): \x1b[31mFAIL\x1b[0m (Wynik: ${t1.score}/100)`);
      for (const issue of t1.issues) {
        console.log(`     ❌ ${issue}`);
      }
      hasErrors = true;
    }

    // Tier 2 Validation
    const t2 = validateSkillTier2(skill.slug);
    if (!t2.hasConflicts) {
      console.log(`   Tier 2 (Distinctiveness):   \x1b[32mPASS\x1b[0m (Wynik: ${t2.distinctivenessScore}/100)`);
    } else {
      console.log(`   Tier 2 (Distinctiveness):   \x1b[33mWARN\x1b[0m (Wynik: ${t2.distinctivenessScore}/100)`);
      for (const conf of t2.overlappingSkills) {
        console.log(`     ⚠️  Konflikt triggerów ze skillem '${conf.slug}': [${conf.sharedTriggers.join(", ")}]`);
      }
    }

    // Benchmark summary
    if (skill.benchmarks.length > 0) {
      const b = skill.benchmarks[0];
      if (b) {
        console.log(`   Tier 3 Live Benchmarks:     \x1b[32mVERIFIED\x1b[0m (Lift: +${skill.overallLift} pkt)`);
        for (const s of b.scores) {
          console.log(`     • ${s.dimension.padEnd(16)}: ${s.baselineScore} -> ${s.withSkillScore} (\x1b[32m+${s.skillLift}\x1b[0m pkt)`);
        }
        console.log(`     • Token Delta:     ${b.tokenUsage.tokenDeltaPercent}%`);
        console.log(`     • Step Savings:    ${b.stepCount.stepSavingsPercent}%`);
      }
    } else {
      console.log(`   Tier 3 Live Benchmarks:     \x1b[33mNEEDS_EVAL\x1b[0m`);
    }
  }

  console.log("\n========================================================");
  if (hasErrors) {
    console.error(" ❌ Walidacja bramki jakościowej NIE powiodła się.");
    process.exit(1);
  } else {
    console.log(" ✅ Wszystkie skille pomyślnie przeszły bramkę jakościową!");
    console.log("========================================================\n");
    process.exit(0);
  }
}

runEvaluation();
