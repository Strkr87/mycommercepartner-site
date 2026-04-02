const { authEnabled, paymentsEnabled, json } = require("./_lib/platform");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  json(res, 200, {
    authEnabled: authEnabled(),
    paymentsEnabled: paymentsEnabled(),
    trialLimit: 2
  });
};
