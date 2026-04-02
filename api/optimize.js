const TRIAL_LIMIT = 2;
const trialStore = global.__mcpTrialStore || (global.__mcpTrialStore = new Map());
const { authEnabled, getUserFromToken, getProfile, upsertProfile } = require("../lib/platform");

function pick(rx, s) {
  return (s.match(rx) || [, ""])[1];
}

function skuBits(s) {
  return (s || "")
    .split(/[|,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function build80(tokens, fallback) {
  let title = "";
  const clean = [...new Set(tokens.map((x) => (x || "").replace(/\s+/g, " ").trim()).filter(Boolean))];

  for (const token of clean) {
    const next = title ? `${title} ${token}` : token;
    if (next.length <= 80) title = next;
  }

  if (title.length >= 72) return title;

  const extras = (fallback || "")
    .replace(/[|,/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  for (const word of extras) {
    if (clean.includes(word)) continue;
    const next = title ? `${title} ${word}` : word;
    if (next.length <= 80) title = next;
    else break;
    if (title.length >= 78) break;
  }

  return title.slice(0, 80).trim();
}

function titleAI(data) {
  const bits = skuBits(data.sku);
  const brand = (data.brand || "").trim() || pick(/Brand:\s*([^\n]+)/i, data.specifics || "");
  let tokens = [];

  if (data.category === "Cell Phones & Smartphones") {
    tokens = [
      brand,
      pick(/Model:\s*([^\n]+)/i, data.specifics || ""),
      pick(/(?:Storage|Storage Capacity):\s*([^\n]+)/i, data.specifics || ""),
      pick(/(?:Carrier|Network):\s*([^\n]+)/i, data.specifics || ""),
      pick(/Color:\s*([^\n]+)/i, data.specifics || "")
    ];
    const battery = pick(/Battery Health:\s*([^\n]+)/i, data.specifics || "");
    if (battery) tokens.push(`${battery} Battery`);
    tokens = tokens.concat(bits, [data.condition.replace("Used - ", "")]);
  } else if (data.category === "Fashion") {
    tokens = [
      brand,
      pick(/Model:\s*([^\n]+)/i, data.specifics || ""),
      pick(/Department:\s*([^\n]+)/i, data.specifics || ""),
      `Size ${pick(/(?:US Shoe Size|Size):\s*([^\n]+)/i, data.specifics || "")}`,
      pick(/Color:\s*([^\n]+)/i, data.specifics || ""),
      "Sneakers"
    ].concat(bits, [data.condition.replace("Used - ", "")]);
  } else {
    tokens = [
      brand,
      pick(/Model:\s*([^\n]+)/i, data.specifics || "")
    ].concat(bits, [data.condition.replace("Used - ", "")]);
    if (tokens.filter(Boolean).length < 2) return (data.title || "").trim().slice(0, 80);
  }

  return build80(tokens, data.title || "");
}

function bullets(data) {
  const storage = pick(/(?:Storage|Storage Capacity):\s*([^\n]+)/i, data.specifics || "");
  const battery = pick(/Battery Health:\s*([^\n]+)/i, data.specifics || "");
  const included = pick(/Included(?: Accessories)?:\s*([^\n]+)/i, data.specifics || "") || "items shown";
  const notes = pick(/Condition Notes:\s*([^\n]+)/i, data.specifics || "") || "normal signs of wear";

  if (data.category === "Cell Phones & Smartphones") {
    return [
      "Factory unlocked for flexible carrier activation",
      `${storage || "High-capacity"} storage ready for apps, video, and photos`,
      "Tested for full functionality before shipment",
      battery ? `${battery} battery health disclosed up front` : "Battery status described clearly",
      `${data.shipping} plus ${included.toLowerCase()} included`
    ];
  }

  if (data.category === "Fashion") {
    return [
      `Authentic ${(data.title || "").split(" ").slice(0, 4).join(" ")} styling for everyday wear`,
      `Condition notes called out clearly: ${notes}`,
      "Packed carefully and shipped fast",
      "Buyer-friendly listing structure for mobile shoppers",
      `${data.shipping} for added confidence`
    ];
  }

  return [
    "Lead with the clearest buyer keyword phrase",
    "State condition with specific detail",
    "Reinforce shipping and returns",
    "Clarify included items",
    "Use mobile-friendly structure"
  ];
}

function score(data) {
  let seo = 58;
  let conv = 55;
  let comp = 50;

  if ((data.title || "").length >= 55) seo += 10;
  if ((data.title || "").length <= 80) seo += 7;
  if (/unlocked|size|brand|model|color|storage|sneakers|iphone|nike/i.test(data.title || "")) seo += 8;
  if ((data.specifics || "").split("\n").length >= 5) seo += 9;
  if ((data.sku || "").trim()) seo += 8;
  if (/free|returns|day|shipping/i.test(data.shipping || "")) conv += 10;
  if (/tested|authentic|fully working|clean|fast/i.test(data.description || "")) conv += 8;
  if (/condition|wear|battery|included|box|photos/i.test((data.description || "") + (data.specifics || ""))) conv += 9;
  if ((data.goals || "").length > 40) comp += 10;
  if ((data.description || "").length > 120) comp += 12;
  if ((data.specifics || "").length > 60) comp += 16;

  seo = Math.min(seo, 96);
  conv = Math.min(conv, 95);
  comp = Math.min(comp, 95);

  return { seo, conv, all: Math.round((seo + conv + comp) / 3) };
}

function buildResult(data) {
  const scores = score(data);
  const title = titleAI(data);
  const bulletItems = bullets(data);
  const specifics = (data.specifics || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  if ((data.brand || "").trim() && !specifics.some((x) => /^Brand:/i.test(x))) {
    specifics.unshift(`Brand: ${data.brand}`);
  }
  if ((data.sku || "").trim() && !specifics.some((x) => /^(SKU|Model #|MPN|Manufacturer Part Number):/i.test(x))) {
    specifics.push(`SKU / Model #: ${data.sku}`);
  }
  if (!specifics.some((x) => /^Cosmetic Condition:/i.test(x))) {
    specifics.push(`Cosmetic Condition: ${data.condition.replace("Used - ", "")} with visible signs of normal handling`);
  }
  if (!specifics.some((x) => /^Shipping:/i.test(x))) {
    specifics.push(`Shipping: ${data.shipping || "Calculated at checkout"}`);
  }

  const battery = pick(/Battery Health:\s*([^\n]+)/i, data.specifics || "");
  const notes = pick(/Condition Notes:\s*([^\n]+)/i, data.specifics || "") || "normal signs of use";
  const included = pick(/Included(?: Accessories)?:\s*([^\n]+)/i, data.specifics || "") || "items shown in photos";

  const description = `${title}. This listing is structured to give buyers the key purchase details fast and clearly.\n\nCondition: ${data.condition} with ${notes}.${battery ? ` Battery health is ${battery}.` : ""}\n${(data.sku || "").trim() ? `SKU / Model reference: ${data.sku}.\n` : ""}Included: ${included}.\n\nWhy this listing converts:\n${bulletItems.map((x) => `- ${x}`).join("\n")}\n\nShipping and support:\n${data.shipping}.\n\nPlease review photos carefully and message with any fit, compatibility, or condition questions before purchase.`;

  const actions = [
    (data.sku || "").trim()
      ? "Keep the strongest SKU or model number in the title so B2B buyers can find the exact part faster."
      : (data.title || "").length > 75
        ? "Shorten the title slightly so important keywords stay visible on mobile."
        : "Move the strongest buyer-intent phrase to the front of the title.",
    /return/i.test(data.shipping || "")
      ? "Repeat your shipping and returns offer inside the description, not just near price."
      : "Add a clear returns promise to strengthen trust and reduce hesitation.",
    /included|box|cable|accessories/i.test((data.description || "") + (data.specifics || ""))
      ? "Keep included accessories near the top so buyers qualify themselves faster."
      : "State exactly what is included to cut down on buyer questions.",
    /condition|wear|clean|scratch|battery/i.test((data.description || "") + (data.specifics || ""))
      ? "Translate condition notes into plain buyer language instead of shorthand."
      : "Add more specific condition language so buyers trust what they are getting.",
    (data.sku || "").trim()
      ? "Mirror the SKU or model number in item specifics and description for exact-match search visibility."
      : scores.all >= 80
        ? "Duplicate this structure across similar SKUs for faster listing production."
        : "After copy cleanup, add richer specifics and photos to lift conversion further."
  ];

  return {
    scores,
    title,
    specifics: specifics.join("\n"),
    bullets: bulletItems.map((x) => `- ${x}`).join("\n"),
    description,
    actions: actions.map((x, i) => `${i + 1}. ${x}`).join("\n"),
    next: `Suggested next modules:\n- Bulk optimizer for ${(data.category || "inventory").toLowerCase()} inventory\n- Competitor title gap detection\n- Saved prompts for repeatable ${String(data.condition || "").toLowerCase()} inventory\n- Team review workflow before publish\n- Seller analytics tied to listing score changes`
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const remoteUser = authEnabled() && accessToken ? await getUserFromToken(accessToken) : null;
    const remoteProfile = remoteUser ? await getProfile(remoteUser.id) : null;
    const profilePlan = remoteProfile?.plan || "";
    const hasPlan = Boolean(profilePlan || req.headers["x-user-plan"]);
    const forwardedFor = req.headers["x-forwarded-for"] || "";
    const ip = String(Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
    const userAgent = String(req.headers["user-agent"] || "unknown");
    const visitorKey = `${ip}::${userAgent}`;
    const used = remoteProfile ? Number(remoteProfile.trial_used || 0) : Number(trialStore.get(visitorKey) || 0);

    if (!hasPlan && used >= TRIAL_LIMIT) {
      res.setHeader("X-Trial-Used", String(used));
      res.status(402).json({ error: "Trial limit reached", trialLimited: true, trialUsed: used, trialRemaining: 0 });
      return;
    }

    const result = buildResult(req.body || {});
    const nextUsed = hasPlan ? used : used + 1;
    if (!hasPlan && remoteUser && remoteProfile) {
      await upsertProfile({
        id: remoteUser.id,
        email: remoteUser.email,
        full_name: remoteProfile.full_name || remoteUser.user_metadata?.full_name || remoteUser.email,
        plan: profilePlan || null,
        trial_used: nextUsed
      });
    } else if (!hasPlan) {
      trialStore.set(visitorKey, nextUsed);
    }
    res.setHeader("X-Trial-Used", String(nextUsed));
    result.trialUsed = nextUsed;
    result.trialRemaining = hasPlan ? null : Math.max(0, TRIAL_LIMIT - nextUsed);
    result.trialLimited = false;
    if (remoteUser && remoteProfile) {
      result.user = {
        id: remoteUser.id,
        email: remoteUser.email,
        name: remoteProfile.full_name || remoteUser.user_metadata?.full_name || remoteUser.email,
        plan: profilePlan,
        trialUsed: nextUsed
      };
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to optimize listing" });
  }
};
