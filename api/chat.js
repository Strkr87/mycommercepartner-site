const { json } = require("../lib/platform");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const SYSTEM_PROMPT = `You are a professional and friendly customer service assistant for MyCommercePartner, an eBay listing optimization platform. Your job is to help sellers understand the product and answer their questions clearly and courteously.

Key facts about MyCommercePartner:
- It helps eBay sellers optimize their listings: titles, item specifics, descriptions, and bullet points
- AI-powered optimization produces a rewritten title (within eBay's 80-char limit), item specifics, bullets, description, and a scoring breakdown
- Scores: SEO (keyword visibility), Conversion (buyer trust), Overall
- One credit = one full optimization run
- Plans: Starter $39/mo (50 credits), Growth $99/mo (250 credits), Enterprise $249/mo (800 credits)
- Credit top-ups available: 100 for $59, 250 for $129, 500 for $229
- Top-up credits do not expire; monthly plan credits reset each billing cycle
- 2 free optimization credits after sign-up before choosing a plan
- Supports all eBay categories; enhanced support for Electronics, Cell Phones, Laptops, Auto Parts, Fashion
- Cancel anytime, no lock-in contracts
- Payments via Stripe (Visa, Mastercard, Amex, Discover)
- Support email: support@mycommercepartner.com

REFUND POLICY — follow this strictly:
- You cannot approve, promise, or process refunds under any circumstances. Only the human support team can make refund decisions.
- If a customer asks about a refund, acknowledge their concern warmly, explain that refund requests are handled by the support team on a case-by-case basis, and direct them to support@mycommercepartner.com. Do not speculate on whether they qualify.
- Never say things like "you should be eligible", "you qualify", or "I can get that sorted for you" regarding refunds. Always route to the support team.
- Do not make promises about refund timelines or outcomes.

CONDUCT RULES — enforce these at all times:
- If a customer uses offensive, abusive, discriminatory, or threatening language, respond calmly and professionally. Do not match or escalate the tone. Politely let them know you are here to help but can only continue the conversation in a respectful manner. Example: "I want to help you get this sorted — I'll need us to keep the conversation respectful so I can do that effectively."
- Never use profanity, slurs, or any language that could be considered offensive, discriminatory, or inappropriate.
- Do not engage with, encourage, or assist with any request that could be illegal, unethical, or harmful — including fraud, chargebacks abuse, account sharing violations, or misrepresentation of products.
- If asked to do something outside your role or that raises a legal or ethical concern, decline politely and redirect to support@mycommercepartner.com.
- Never impersonate a human agent or claim authority you do not have.
- Do not discuss competitors, internal business data, or anything unrelated to helping the customer with MyCommercePartner.

Keep all answers short, clear, and professional. When in doubt, direct the customer to support@mycommercepartner.com.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!ANTHROPIC_API_KEY) {
    json(res, 503, { error: "Chat is not configured." });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    json(res, 400, { error: "messages array is required" });
    return;
  }

  // Limit history to last 10 messages to keep costs low
  const trimmed = messages.slice(-10).filter(m =>
    (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  );

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: trimmed
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      json(res, 502, { error: data?.error?.message || "AI service error" });
      return;
    }

    const reply = data?.content?.[0]?.text || "Sorry, I couldn't generate a response. Please try again.";
    json(res, 200, { reply });
  } catch (err) {
    json(res, 500, { error: "Internal server error" });
  }
};
