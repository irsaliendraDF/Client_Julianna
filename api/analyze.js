// Vercel serverless function: /api/analyze
// Proxies the org health analysis call to the Anthropic API.
// The browser cannot call api.anthropic.com directly (CORS + key exposure),
// so audit.html POSTs the survey payload here and we return the parsed report.
//
// Requires the Vercel env var: ANTHROPIC_API_KEY
// Set it in: Vercel dashboard -> Project -> Settings -> Environment Variables.

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;

const SYSTEM_INSTRUCTIONS = `You are an expert organizational health analyst for Julianna Systems, a third-party workplace wellness consultancy.

You analyze anonymized employee assessments through three lenses:
- Lens 1 (POLICY): What the company says it stands for. Vacation, sick days, parental leave, benefits, performance review rules. The policy on paper.
- Lens 2 (PRACTICE): What is actually happening on the ground. Manager interactions, day-to-day culture, the shadow week.
- Lens 3 (PROVISION): What is offered, and is anyone actually using it. Benefits utilization, mental health resources, the gap between funded and felt.

Style rule: do not use em dashes (—) anywhere in your output. Use commas, parentheses, periods, or colons instead.

Return ONLY a valid JSON object. No preamble, no markdown fences, no explanation.`;

function buildUserPrompt({ profile, ratings, voice }) {
  const ratingLines = ratings.map(r => `- ${r.label}: ${r.value}/10`).join("\n");
  const voiceLines  = voice.map(v => `Q: ${v.label}\nA: ${v.answer || "(no response provided)"}`).join("\n\n");

  return `Analyze this anonymized employee assessment and return a JSON report.

EMPLOYEE PROFILE:
${profile}

SATISFACTION RATINGS (out of 10):
${ratingLines}

VOICE / WRITTEN RESPONSES:
${voiceLines}

Return ONLY this JSON structure:
{
  "overall_score": <number 1-10, weighted average of all lenses>,
  "overall_summary": "<2-3 sentence plain English summary>",
  "lens1": {
    "score": <number 1-10>,
    "analysis": "<3-4 sentence qualitative analysis for Policy lens>",
    "keywords_positive": ["w1","w2","w3"],
    "keywords_negative": ["w1","w2"],
    "keywords_neutral":  ["w1","w2"]
  },
  "lens2": {
    "score": <number 1-10>,
    "analysis": "<3-4 sentence qualitative analysis for Practice lens>",
    "keywords_positive": ["w1","w2","w3"],
    "keywords_negative": ["w1","w2"],
    "keywords_neutral":  ["w1","w2"]
  },
  "lens3": {
    "score": <number 1-10>,
    "analysis": "<3-4 sentence qualitative analysis for Provision lens>",
    "keywords_positive": ["w1","w2","w3"],
    "keywords_negative": ["w1","w2"],
    "keywords_neutral":  ["w1","w2"]
  },
  "standout_strength": "<one sentence>",
  "standout_concern":  "<one sentence>",
  "indicators": {
    "policy_practice_gap":      <number 1-10, 10 = huge gap between policy and reality>,
    "provision_utilization_gap":<number 1-10, 10 = big gap between offered and felt>,
    "management_alignment":     <number 1-10, 10 = strong alignment between manager and C-suite>
  }
}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    const { profile, ratings, voice } = req.body || {};
    if (!profile || !Array.isArray(ratings) || !Array.isArray(voice)) {
      return res.status(400).json({ error: "Missing profile, ratings, or voice" });
    }

    const userPrompt = buildUserPrompt({ profile, ratings, voice });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "x-api-key":        apiKey,
        "anthropic-version":"2023-06-01",
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_INSTRUCTIONS,
        messages:   [{ role: "user", content: userPrompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("[analyze] anthropic error", anthropicRes.status, errText);
      return res.status(502).json({ error: "Upstream Anthropic error", status: anthropicRes.status });
    }

    const data = await anthropicRes.json();
    const raw = (data.content || []).map(b => b.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();

    let report;
    try {
      report = JSON.parse(clean);
    } catch (parseErr) {
      console.error("[analyze] failed to parse model output:", raw);
      return res.status(502).json({ error: "Model returned non-JSON output" });
    }

    return res.status(200).json({ report });
  } catch (err) {
    console.error("[analyze] handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
