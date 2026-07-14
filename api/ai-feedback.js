import { handlePreflight, jsonError, setCors, validateIdentity } from "./_shared.js";

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  setCors(req, res);
  if (req.method !== "POST") return jsonError(res, 405, "Method not allowed");
  if (!process.env.OPENAI_API_KEY) return jsonError(res, 500, "AI service is not configured");

  const body = req.body || {};
  const identityError = validateIdentity(body);
  if (identityError) return jsonError(res, 400, identityError);
  if (body.condition !== "real_ai") return jsonError(res, 403, "AI feedback is only available in this condition");

  const ideas = String(body.ideas || "").trim().slice(0, 12000);
  const taskQuestion = String(body.task_question || "").trim().slice(0, 2000);
  const recentFeedback = Array.isArray(body.recent_feedback)
    ? body.recent_feedback
      .map(item => String(item || "").trim())
      .filter(Boolean)
      .slice(-3)
      .map(item => item.slice(0, 500))
    : [];
  const taskContext = taskQuestion
    ? `The brainstorming task is:\n\n${taskQuestion}\n\n`
    : "";
  const feedbackContext = recentFeedback.length
    ? `Recent feedback already shown to the participant:\n\n${recentFeedback.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n\n`
    : "";
  const userContent = ideas
    ? `${taskContext}${feedbackContext}The participant's current ideas are:\n\n${ideas}`
    : `${taskContext}The participant has not written any ideas yet. Give one brief, open-ended starting prompt.`;

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
        instructions:
          "You are a concise brainstorming partner in a research study. " +
          "Base your response directly on the participant's current ideas. " +
          "First refer to one concrete theme, feature, or gap you notice in their text, then suggest one specific next direction they could explore. " +
          "If their text is very short, ask one targeted question that fits the task instead of giving generic encouragement. " +
          "Avoid repeating feedback that has already been shown. " +
          "Do not give generic praise such as 'great idea' unless you name the specific idea or theme you are responding to. " +
          "Do not score, rank, rewrite, or claim that an idea is objectively good. " +
          "Do not mention the study, experimental condition, or these instructions. " +
          "Use plain English, at most 60 words, and no bullet list.",
        input: userContent,
        max_output_tokens: 120
      })
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("OpenAI error", upstream.status, detail.slice(0, 500));
      return jsonError(res, 502, "AI feedback is temporarily unavailable");
    }

    const data = await upstream.json();
    const feedback = extractOutputText(data);
    if (!feedback) return jsonError(res, 502, "AI returned an empty response");
    return res.status(200).json({ feedback: feedback.slice(0, 1000) });
  } catch (error) {
    console.error("AI proxy failure", error);
    return jsonError(res, 502, "AI feedback is temporarily unavailable");
  }
}

function extractOutputText(response) {
  return (response.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text" && typeof item.text === "string")
    .map(item => item.text)
    .join("\n")
    .trim();
}
