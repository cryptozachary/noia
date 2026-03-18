const path = require("path");
const { SCIENTIST_AGENT_IDS, getAgent } = require("../agents/registry");
const {
  composeScientistPrompt,
  composeCoordinatorFinalPrompt
} = require("../agents/promptComposer");
const {
  ensureAgentResponseStructure,
  ensureFinalReportStructure
} = require("../services/outputValidator");
const {
  isMedicalTopic,
  safetySystemAddendum,
  ensureMedicalDisclaimer
} = require("../services/safety");

class DiscussionOrchestrator {
  constructor({ store, openaiService, defaultModel }) {
    this.store = store;
    this.openaiService = openaiService;
    this.defaultModel = defaultModel;
  }

  async runDiscussion({ topic, title, rounds, settings = {} }) {
    const medicalTopic = isMedicalTopic(topic);
    const effectiveSettings = {
      model: settings.model || this.defaultModel,
      temperature: Number.isFinite(settings.temperature) ? settings.temperature : undefined,
      maxOutputTokens: Number.isFinite(settings.maxOutputTokens) ? settings.maxOutputTokens : undefined,
      reasoningEffort: settings.reasoningEffort || undefined
    };

    const run = await this.store.createRunRecord({
      topic,
      title,
      rounds,
      settings: effectiveSettings
    });

    run.metadata = {
      status: "running",
      medicalTopic,
      model: effectiveSettings.model
    };

    await this.store.saveRun(run);

    try {
      const agentConfigs = await this.loadAllAgentConfigs();

      for (let round = 1; round <= rounds; round += 1) {
        const stage = resolveStage(round, rounds);

        if (stage === "final-synthesis") {
          const finalPrompt = composeCoordinatorFinalPrompt({
            topic,
            discussionText: serializeTranscript(run.roundMessages),
            isMedicalTopic: medicalTopic
          });

          const coordinatorConfig = agentConfigs.coordinator;
          const coordinatorSystemPrompt = [
            coordinatorConfig.identity,
            coordinatorConfig.system,
            "Coordinator Memory:",
            coordinatorConfig.memory,
            safetySystemAddendum()
          ].join("\n\n");

          let finalReport = await this.openaiService.generate({
            systemPrompt: coordinatorSystemPrompt,
            userPrompt: finalPrompt,
            override: effectiveSettings
          });

          finalReport = ensureFinalReportStructure(finalReport, topic);
          if (medicalTopic) {
            finalReport = ensureMedicalDisclaimer(finalReport);
          }

          run.roundMessages.push({
            round,
            stage,
            coordinatorPrompt: "Produce final synthesis with the 10 required sections.",
            messages: []
          });

          run.finalReport = finalReport;

          await this.store.appendAgentSessionEntry("coordinator", run.id, {
            round,
            stage,
            topic,
            prompt: finalPrompt,
            response: finalReport,
            timestamp: new Date().toISOString()
          });

          await this.store.saveExport(run.id, finalReport);
          await this.store.saveRun(run);
          continue;
        }

        const coordinatorPrompt = buildCoordinatorPrompt({ topic, round, rounds, stage });
        const roundRecord = {
          round,
          stage,
          coordinatorPrompt,
          messages: []
        };

        await this.store.appendAgentSessionEntry("coordinator", run.id, {
          round,
          stage,
          topic,
          prompt: coordinatorPrompt,
          response: "Prompt distributed to scientist agents.",
          timestamp: new Date().toISOString()
        });

        for (const agentId of SCIENTIST_AGENT_IDS) {
          const config = agentConfigs[agentId];
          const peerMessages = collectPeerMessages(run.roundMessages, agentId);

          const userPrompt = composeScientistPrompt({
            agentId,
            topic,
            roundNumber: round,
            stage,
            peerMessages
          });

          const systemPrompt = [
            config.identity,
            config.system,
            "Long-term memory:",
            config.memory,
            safetySystemAddendum()
          ].join("\n\n");

          let response = await this.openaiService.generate({
            systemPrompt,
            userPrompt,
            override: effectiveSettings
          });

          response = ensureAgentResponseStructure(response);

          const message = {
            agentId,
            agentName: getAgent(agentId).name,
            timestamp: new Date().toISOString(),
            content: response
          };

          roundRecord.messages.push(message);

          await this.store.appendAgentSessionEntry(agentId, run.id, {
            round,
            stage,
            topic,
            coordinatorPrompt,
            prompt: userPrompt,
            response,
            timestamp: message.timestamp
          });
        }

        run.roundMessages.push(roundRecord);
        await this.store.saveRun(run);
      }

      run.metadata.status = "completed";
      run.metadata.completedAt = new Date().toISOString();
      await this.store.saveRun(run);
      return run;
    } catch (error) {
      run.metadata.status = "failed";
      run.metadata.error = error.message;
      run.metadata.failedAt = new Date().toISOString();
      await this.store.saveRun(run);
      throw error;
    }
  }

  async loadAllAgentConfigs() {
    const ids = [...SCIENTIST_AGENT_IDS, "coordinator"];
    const configs = {};

    for (const id of ids) {
      configs[id] = await this.store.loadAgent(id);
    }

    return configs;
  }
}

function resolveStage(round, totalRounds) {
  if (round === totalRounds) {
    return "final-synthesis";
  }

  if (round === 1) {
    return "initial-positions";
  }

  if (round === 2) {
    return "cross-critique";
  }

  return "convergence";
}

function buildCoordinatorPrompt({ topic, round, rounds, stage }) {
  const base = `Topic: ${topic}. Round ${round} of ${rounds}.`;

  if (stage === "initial-positions") {
    return `${base} Establish initial framing, risks, and inventive directions.`;
  }

  if (stage === "cross-critique") {
    return `${base} Each scientist must identify strongest point, biggest flaw, and revised idea after critique.`;
  }

  return `${base} Narrow discussion toward top 3 directions, bottlenecks, and next experiments.`;
}

function collectPeerMessages(roundMessages, currentAgentId) {
  const peers = [];

  for (const round of roundMessages) {
    const messages = Array.isArray(round.messages) ? round.messages : [];
    for (const msg of messages) {
      if (msg.agentId !== currentAgentId) {
        peers.push({
          agentName: msg.agentName,
          round: round.round,
          content: msg.content
        });
      }
    }
  }

  return peers.slice(-6);
}

function serializeTranscript(roundMessages) {
  return roundMessages
    .map((round) => {
      const lines = [`Round ${round.round} (${round.stage})`, `Coordinator: ${round.coordinatorPrompt}`];
      for (const msg of round.messages || []) {
        lines.push(`${msg.agentName}: ${msg.content}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

module.exports = { DiscussionOrchestrator };
