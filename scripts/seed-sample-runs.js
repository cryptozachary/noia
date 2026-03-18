const fs = require("fs/promises");
const path = require("path");
const { ensureBootstrap } = require("../src/storage/bootstrap");
const { config } = require("../src/config");

async function main() {
  await ensureBootstrap();

  const runsDir = path.join(config.dataDir, "runs");
  const agentsDir = path.join(config.dataDir, "agents");
  const exportsDir = path.join(config.dataDir, "exports");

  const runs = [buildBatteryRun(), buildMedicalRun()];

  for (const run of runs) {
    const runPath = path.join(runsDir, `${run.id}.json`);
    await fs.writeFile(runPath, JSON.stringify(run, null, 2), "utf8");

    for (const round of run.roundMessages) {
      for (const message of round.messages || []) {
        const sessionPath = path.join(agentsDir, message.agentId, "sessions", `${run.id}.json`);
        const existing = await readJson(sessionPath, {
          runId: run.id,
          agentId: message.agentId,
          createdAt: run.createdAt,
          entries: []
        });

        existing.entries.push({
          round: round.round,
          stage: round.stage,
          topic: run.topic,
          coordinatorPrompt: round.coordinatorPrompt,
          prompt: "Seed sample entry",
          response: message.content,
          timestamp: message.timestamp
        });

        existing.updatedAt = run.updatedAt;
        await fs.writeFile(sessionPath, JSON.stringify(existing, null, 2), "utf8");
      }
    }

    const coordinatorSessionPath = path.join(agentsDir, "coordinator", "sessions", `${run.id}.json`);
    await fs.writeFile(
      coordinatorSessionPath,
      JSON.stringify(
        {
          runId: run.id,
          agentId: "coordinator",
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          entries: [
            {
              round: run.rounds,
              stage: "final-synthesis",
              topic: run.topic,
              prompt: "Seed final synthesis",
              response: run.finalReport,
              timestamp: run.updatedAt
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await fs.writeFile(path.join(exportsDir, `${run.id}.md`), run.finalReport, "utf8");
  }

  await fs.writeFile(
    path.join(config.dataDir, "topics", "sample-topics.md"),
    [
      "# Sample Topics",
      "",
      "- Next-gen battery inventions for long-duration storage",
      "- Underexplored cancer treatment directions (research-only framing)",
      "- Carbon capture innovations for industrial use"
    ].join("\n"),
    "utf8"
  );

  console.log(`Seeded ${runs.length} runs.`);
}

function buildBatteryRun() {
  const createdAt = "2026-03-16T10:30:00.000Z";
  const updatedAt = "2026-03-16T10:36:00.000Z";

  return {
    id: "sample-run-battery-01",
    title: "Long-Duration Battery Invention Brainstorm",
    topic: "Promising underexplored directions for long-duration grid batteries",
    createdAt,
    updatedAt,
    rounds: 4,
    settings: {
      model: "gpt-4.1-mini"
    },
    roundMessages: [
      {
        round: 1,
        stage: "initial-positions",
        coordinatorPrompt: "Establish initial framing and promising directions.",
        messages: [
          seededMessage(
            "research-synthesizer",
            "Research Synthesizer",
            "Position:\nHybrid sodium-metal + redox mediator systems are underexplored for long-duration storage.\n\nSupporting Reasoning:\nKnown low-cost materials can be paired with mediator chemistry to improve utilization.\n\nConfidence Level:\nMedium\n\nClaim Classification (Established | Inferred | Speculative):\nInferred\n\nMain Uncertainty:\nCycle stability under grid duty profile.\n\nCritique of Others:\nNeed deeper manufacturability analysis.\n\nRevised View:\nPrioritize chemistries with domestic supply chains.",
            createdAt
          ),
          seededMessage(
            "skeptical-reviewer",
            "Skeptical Reviewer",
            "Position:\nMany long-duration claims ignore BOS and maintenance costs.\n\nSupporting Reasoning:\nTotal installed cost often dominates chemistry-level gains.\n\nConfidence Level:\nHigh\n\nClaim Classification (Established | Inferred | Speculative):\nEstablished\n\nMain Uncertainty:\nReal-world service costs by climate region.\n\nCritique of Others:\nNovel chemistry proposals understate degradation pathways.\n\nRevised View:\nRequire side-by-side techno-economic assumptions.",
            createdAt
          ),
          seededMessage(
            "innovation-strategist",
            "Innovation Strategist",
            "Position:\nUse modular electrolyte swap architecture with predictive maintenance sensing.\n\nSupporting Reasoning:\nDecouples active material lifetime from stack lifetime and reduces downtime.\n\nConfidence Level:\nMedium\n\nClaim Classification (Established | Inferred | Speculative):\nSpeculative\n\nMain Uncertainty:\nField logistics complexity.\n\nCritique of Others:\nConservative assumptions may miss operational flexibility gains.\n\nRevised View:\nPilot in controlled microgrid fleets first.",
            createdAt
          )
        ]
      },
      {
        round: 2,
        stage: "cross-critique",
        coordinatorPrompt: "Identify strongest point, biggest flaw, and revised idea.",
        messages: []
      },
      {
        round: 3,
        stage: "convergence",
        coordinatorPrompt: "Narrow to top 3 directions and top experiments.",
        messages: []
      },
      {
        round: 4,
        stage: "final-synthesis",
        coordinatorPrompt: "Produce final synthesis with required headings.",
        messages: []
      }
    ],
    finalReport: [
      "1. Topic",
      "Promising underexplored directions for long-duration grid batteries",
      "",
      "2. Executive Summary",
      "The team converged on modular chemistries, system-level cost realism, and validation-first pilots as the highest-value path.",
      "",
      "3. Known / Established Points",
      "- Balance-of-system costs are often decisive.",
      "- Degradation behavior under realistic duty cycles is a top uncertainty.",
      "",
      "4. Most Promising Hypotheses",
      "- Sodium-based hybrid architectures can deliver lower lifecycle cost if cycle stability improves.",
      "- Electrolyte-swap designs may improve serviceability for long-duration installations.",
      "",
      "5. Major Objections / Risks",
      "- Degradation and maintenance burden may erase chemistry advantages.",
      "- Logistics and service operations may be underestimated.",
      "",
      "6. Proposed Experiments or Validation Steps",
      "- Multi-climate pilot cohorts with harmonized telemetry.",
      "- Standardized lifecycle cost model sensitivity tests.",
      "",
      "7. Unresolved Disagreements",
      "- How much operational complexity utilities will tolerate for lower material costs.",
      "",
      "8. Confidence / Uncertainty Summary",
      "- Moderate confidence in system-level direction; low-to-moderate confidence in chemistry-specific winners.",
      "",
      "9. Suggested Next Research Directions",
      "- Co-design chemistry and service model from the start.",
      "- Benchmark modularity benefits in field pilots.",
      "",
      "10. Safety Note / Disclaimer",
      "This output is for exploratory scientific discussion and planning only."
    ].join("\n"),
    metadata: {
      status: "completed",
      medicalTopic: false,
      model: "gpt-4.1-mini",
      completedAt: updatedAt
    }
  };
}

function buildMedicalRun() {
  const createdAt = "2026-03-16T11:10:00.000Z";
  const updatedAt = "2026-03-16T11:17:00.000Z";

  return {
    id: "sample-run-medical-01",
    title: "Research Debate: Underexplored Cancer Directions",
    topic: "Promising underexplored cancer treatment research directions",
    createdAt,
    updatedAt,
    rounds: 4,
    settings: {
      model: "gpt-4.1-mini"
    },
    roundMessages: [
      {
        round: 1,
        stage: "initial-positions",
        coordinatorPrompt: "Frame topic and propose research hypotheses.",
        messages: []
      },
      {
        round: 2,
        stage: "cross-critique",
        coordinatorPrompt: "Perform evidence critique and revise claims.",
        messages: []
      },
      {
        round: 3,
        stage: "convergence",
        coordinatorPrompt: "Prioritize hypotheses and experiments.",
        messages: []
      },
      {
        round: 4,
        stage: "final-synthesis",
        coordinatorPrompt: "Produce final synthesis with required headings.",
        messages: []
      }
    ],
    finalReport: [
      "1. Topic",
      "Promising underexplored cancer treatment research directions",
      "",
      "2. Executive Summary",
      "The discussion emphasized hypothesis generation around immune microenvironment modulation and delivery precision while highlighting major translational uncertainty.",
      "",
      "3. Known / Established Points",
      "- Tumor microenvironment heterogeneity complicates treatment response.",
      "- Biomarker stratification remains a bottleneck.",
      "",
      "4. Most Promising Hypotheses",
      "- Context-specific immune priming could improve response in resistant subtypes.",
      "- Localized delivery platforms may reduce systemic toxicity.",
      "",
      "5. Major Objections / Risks",
      "- Preclinical models may not transfer to clinical outcomes.",
      "- Safety windows for combination regimens are uncertain.",
      "",
      "6. Proposed Experiments or Validation Steps",
      "- Adaptive biomarker-guided preclinical studies.",
      "- Multi-arm mechanism-focused early studies with strict stopping criteria.",
      "",
      "7. Unresolved Disagreements",
      "- Whether mechanistic depth or translational breadth should dominate near-term portfolio choices.",
      "",
      "8. Confidence / Uncertainty Summary",
      "- Moderate confidence in bottleneck diagnosis; low confidence in near-term therapeutic winners.",
      "",
      "9. Suggested Next Research Directions",
      "- Invest in higher-fidelity translational models and biomarker-first trial design.",
      "",
      "10. Safety Note / Disclaimer",
      "This output is for exploratory scientific discussion only and is not medical advice, diagnosis, or treatment guidance."
    ].join("\n"),
    metadata: {
      status: "completed",
      medicalTopic: true,
      model: "gpt-4.1-mini",
      completedAt: updatedAt
    }
  };
}

function seededMessage(agentId, agentName, content, timestamp) {
  return { agentId, agentName, content, timestamp };
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
