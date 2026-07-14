(() => {
  "use strict";

  const cfg = window.EXPERIMENT_CONFIG;
  const params = new URLSearchParams(window.location.search);
  const participantId = (params.get("participant_id") || "").trim();
  const rawCondition = (params.get("condition") || "").trim();
  const conditionCodes = Object.freeze({
    A: "control",
    B: "fake_ai",
    C: "real_ai"
  });
  const conditionCodeByLabel = Object.freeze({
    control: "A",
    fake_ai: "B",
    real_ai: "C"
  });
  const condition = conditionCodes[rawCondition] || rawCondition;
  const conditionCode = conditionCodeByLabel[condition] || rawCondition;
  const validConditions = new Set(["control", "fake_ai", "real_ai"]);
  const isAiCondition = condition === "fake_ai" || condition === "real_ai";
  const sessionId = crypto.randomUUID();
  const storageKey = `brainstorm:${participantId}:${conditionCode}`;

  const el = {
    app: document.querySelector("#app"),
    timer: document.querySelector("#timer"),
    question: document.querySelector("#task-question"),
    instructions: document.querySelector("#task-instructions"),
    ideas: document.querySelector("#ideas"),
    wordCount: document.querySelector("#word-count"),
    saveStatus: document.querySelector("#save-status"),
    assistantPanel: document.querySelector("#assistant-panel"),
    assistantStatus: document.querySelector("#assistant-status"),
    messages: document.querySelector("#messages"),
    feedbackButton: document.querySelector("#feedback-button"),
    submitButton: document.querySelector("#submit-button"),
    participantLabel: document.querySelector("#participant-label"),
    errorPanel: document.querySelector("#error-panel"),
    errorMessage: document.querySelector("#error-message"),
    overlay: document.querySelector("#completion-overlay"),
    completionMessage: document.querySelector("#completion-message")
  };

  const state = {
    startedAt: null,
    endedAt: null,
    remainingSeconds: cfg.TASK_DURATION_SECONDS,
    timerHandle: null,
    draftHandle: null,
    autoFeedbackHandle: null,
    interactionCount: 0,
    interactions: [],
    feedbackBusy: false,
    submitted: false,
    lastFeedbackAt: 0
  };

  const fakeFeedback = [
    "You’re building a strong set of ideas. Keep exploring different directions.",
    "That’s a promising start. What other possibilities might fit alongside these?",
    "Your ideas show good variety. Try looking at the problem from another angle.",
    "Nice progress. You could keep going by thinking about different people or situations.",
    "There are some interesting possibilities here. See whether one idea leads to another.",
    "You’re developing a useful range of thoughts. Keep adding anything that comes to mind."
  ];

  function showError(message) {
    el.errorMessage.textContent = message;
    el.errorPanel.hidden = false;
    el.app.hidden = true;
    el.submitButton.hidden = true;
    el.timer.closest(".timer-card").hidden = true;
  }

  function initialise() {
    if (!cfg || !participantId || !validConditions.has(condition)) {
      showError("Please return to the questionnaire and use the study link provided there.");
      return;
    }

    el.question.textContent = cfg.TASK_QUESTION;
    el.instructions.textContent = cfg.TASK_INSTRUCTIONS;
    el.participantLabel.textContent = `Participant: ${participantId}`;
    el.app.classList.toggle("control-layout", !isAiCondition);
    el.assistantPanel.hidden = !isAiCondition;
    el.app.hidden = false;
    el.submitButton.disabled = false;

    restoreLocalDraft();
    state.startedAt = new Date().toISOString();
    recordEvent("session_started");
    updateWordCount();
    startTimer();
    bindEvents();
    saveDraft("started");

    if (isAiCondition) {
      window.setTimeout(() => {
        if (!state.submitted && !state.feedbackBusy) requestFeedback("automatic");
      }, cfg.FIRST_AUTO_FEEDBACK_SECONDS * 1000);
      state.autoFeedbackHandle = window.setInterval(() => {
        if (!state.submitted && !state.feedbackBusy) requestFeedback("automatic");
      }, cfg.AUTO_FEEDBACK_INTERVAL_SECONDS * 1000);
    }
  }

  function bindEvents() {
    el.ideas.addEventListener("input", () => {
      updateWordCount();
      saveLocalDraft();
      el.saveStatus.textContent = "Saved locally";
      window.clearTimeout(state.draftHandle);
      state.draftHandle = window.setTimeout(() => saveDraft("autosave"), 2500);
    });
    el.feedbackButton.addEventListener("click", () => requestFeedback("manual"));
    el.submitButton.addEventListener("click", () => finish(false));
    window.addEventListener("pagehide", () => {
      if (!state.submitted) saveDraft("pagehide", true);
    });
  }

  function startTimer() {
    renderTimer();
    state.timerHandle = window.setInterval(() => {
      state.remainingSeconds -= 1;
      renderTimer();
      if (state.remainingSeconds <= 0) finish(true);
    }, 1000);
  }

  function renderTimer() {
    const seconds = Math.max(0, state.remainingSeconds);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    el.timer.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    el.timer.closest(".timer-card").classList.toggle("warning", seconds <= 60);
  }

  function updateWordCount() {
    const words = el.ideas.value.trim() ? el.ideas.value.trim().split(/\s+/u).length : 0;
    el.wordCount.textContent = String(words);
  }

  function saveLocalDraft() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        text: el.ideas.value,
        updatedAt: new Date().toISOString()
      }));
    } catch (_) { /* Local storage is a resilience layer only. */ }
  }

  function restoreLocalDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(storageKey));
      if (draft && typeof draft.text === "string") el.ideas.value = draft.text;
    } catch (_) { /* Ignore malformed or unavailable storage. */ }
  }

  function recordEvent(type, detail = {}) {
    state.interactions.push({
      type,
      at: new Date().toISOString(),
      elapsed_seconds: state.startedAt
        ? Math.round((Date.now() - Date.parse(state.startedAt)) / 1000)
        : 0,
      ...detail
    });
  }

  async function requestFeedback(trigger) {
    if (!isAiCondition || state.feedbackBusy || state.submitted) return;
    const now = Date.now();
    const cooldownMs = cfg.MANUAL_FEEDBACK_COOLDOWN_SECONDS * 1000;
    if (trigger === "manual" && now - state.lastFeedbackAt < cooldownMs) {
      el.assistantStatus.textContent = "A new perspective will be available shortly";
      return;
    }

    state.feedbackBusy = true;
    state.lastFeedbackAt = now;
    el.feedbackButton.disabled = true;
    el.assistantStatus.textContent = "Considering your ideas";
    const bubble = createThinkingBubble();
    const inputSnapshot = el.ideas.value.trim();
    recordEvent("feedback_requested", { trigger, input: inputSnapshot });

    try {
      let responseText;
      if (condition === "fake_ai") {
        await wait(900 + Math.random() * 1300);
        responseText = fakeFeedback[state.interactionCount % fakeFeedback.length];
      } else {
        const response = await fetch(`${normaliseBase(cfg.API_BASE_URL)}/api/ai-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participant_id: participantId,
            session_id: sessionId,
            condition,
            condition_code: conditionCode,
            ideas: inputSnapshot,
            task_question: cfg.TASK_QUESTION,
            recent_feedback: getRecentFeedback(),
            interaction_count: state.interactionCount
          })
        });
        if (!response.ok) throw new Error(`Feedback request failed (${response.status})`);
        const data = await response.json();
        responseText = data.feedback;
      }

      state.interactionCount += 1;
      bubble.innerHTML = "<p></p>";
      const paragraph = bubble.querySelector("p");
      await typeOrganically(paragraph, responseText);
      recordEvent("feedback_displayed", {
        trigger,
        input: inputSnapshot,
        response: responseText,
        feedback_number: state.interactionCount
      });
      el.assistantStatus.textContent = "Ready when you are";
      saveDraft("feedback");
    } catch (error) {
      bubble.innerHTML = "<p>I’m unable to offer a suggestion right now. Please keep developing your ideas.</p>";
      recordEvent("feedback_error", { trigger, message: String(error.message || error) });
      el.assistantStatus.textContent = "Temporarily unavailable";
    } finally {
      state.feedbackBusy = false;
      el.feedbackButton.disabled = false;
    }
  }

  function createThinkingBubble() {
    const bubble = document.createElement("div");
    bubble.className = "message assistant-message";
    bubble.innerHTML = '<span class="thinking" aria-label="Generating response"><i></i><i></i><i></i></span>';
    el.messages.appendChild(bubble);
    el.messages.scrollTop = el.messages.scrollHeight;
    return bubble;
  }

  function getRecentFeedback() {
    return state.interactions
      .filter(item => item.type === "feedback_displayed" && item.response)
      .slice(-3)
      .map(item => String(item.response).slice(0, 500));
  }

  async function typeOrganically(target, text) {
    target.classList.add("typing-cursor");
    const tokens = String(text).match(/\s+|[^\s]+/gu) || [];
    for (const token of tokens) {
      if (state.submitted) break;
      target.textContent += token;
      el.messages.scrollTop = el.messages.scrollHeight;
      const punctuationPause = /[.!?]$/u.test(token) ? 150 + Math.random() * 170 : 0;
      const basePause = token.trim() ? 38 + Math.random() * 58 : 14 + Math.random() * 24;
      await wait(basePause + punctuationPause);
    }
    target.classList.remove("typing-cursor");
  }

  function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function buildPayload(reason) {
    return {
      session_id: sessionId,
      participant_id: participantId,
      condition,
      condition_code: conditionCode,
      task_question: cfg.TASK_QUESTION,
      task_instructions: cfg.TASK_INSTRUCTIONS,
      brainstorm_text: el.ideas.value,
      started_at: state.startedAt,
      ended_at: state.endedAt,
      completed: state.submitted,
      auto_ended: reason === "timeout",
      early_submit: reason === "early_submit",
      duration_seconds: state.startedAt
        ? Math.max(0, Math.round(((state.endedAt ? Date.parse(state.endedAt) : Date.now()) - Date.parse(state.startedAt)) / 1000))
        : 0,
      interaction_count: state.interactionCount,
      interactions: state.interactions,
      save_reason: reason,
      client_metadata: {
        language: navigator.language,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    };
  }

  async function saveDraft(reason, keepalive = false) {
    if (!cfg.API_BASE_URL || cfg.API_BASE_URL.includes("YOUR-VERCEL-PROJECT")) return false;
    try {
      el.saveStatus.textContent = "Saving…";
      const response = await fetch(`${normaliseBase(cfg.API_BASE_URL)}/api/save-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(reason)),
        keepalive
      });
      if (!response.ok) throw new Error("Save failed");
      el.saveStatus.textContent = "Saved";
      return true;
    } catch (_) {
      el.saveStatus.textContent = "Saved locally; server retry pending";
      return false;
    }
  }

  async function finish(autoEnded) {
    if (state.submitted) return;
    state.submitted = true;
    state.endedAt = new Date().toISOString();
    window.clearInterval(state.timerHandle);
    window.clearInterval(state.autoFeedbackHandle);
    window.clearTimeout(state.draftHandle);
    el.ideas.disabled = true;
    el.feedbackButton.disabled = true;
    el.submitButton.disabled = true;
    el.overlay.hidden = false;
    const reason = autoEnded ? "timeout" : "early_submit";
    recordEvent("session_completed", { reason });
    await Promise.race([saveDraft(reason), wait(4500)]);
    try { localStorage.removeItem(storageKey); } catch (_) {}
    redirectToQualtrics();
  }

  function redirectToQualtrics() {
    if (!cfg.QUALTRICS_RETURN_URL || cfg.QUALTRICS_RETURN_URL.includes("YOUR-ORGANISATION")) {
      el.completionMessage.textContent =
        "Your response is complete. Configure QUALTRICS_RETURN_URL in config.js to enable the automatic return.";
      return;
    }
    const destination = new URL(cfg.QUALTRICS_RETURN_URL);
    destination.searchParams.set("participant_id", participantId);
    destination.searchParams.set("condition", conditionCode);
    destination.searchParams.set("session_id", sessionId);
    window.location.assign(destination.toString());
  }

  function normaliseBase(value) {
    return String(value || "").replace(/\/+$/u, "");
  }

  initialise();
})();
