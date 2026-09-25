const { authEnabled, paymentsEnabled, json } = require("../lib/platform");
const { aiEnabled } = require("./_lib/ai-optimizer");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  json(res, 200, {
    authEnabled: authEnabled(),
    paymentsEnabled: paymentsEnabled(),
    aiEnabled: aiEnabled(),
    trialLimit: 2
  });
};
