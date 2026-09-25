// Loads api/optimize with lib/platform auth stubbed so a fake Bearer token
// resolves to a Starter profile. optimize.js destructures platform functions
// at require time, so the stubs must be in place before it is (re)loaded.
const platform = require('../../lib/platform');

const TEST_TOKEN = 'test-token';

function loadOptimizeWithFakeAuth(profile = {}) {
  const user = { id: 'user-1', email: 'seller@example.com', user_metadata: {} };
  const stored = { id: user.id, email: user.email, full_name: 'Test Seller', plan: 'Starter', trial_used: 0, credits_used: 0, bonus_credits: 0, ...profile };
  platform.authEnabled = () => true;
  platform.getUserFromToken = async (token) => (token === TEST_TOKEN ? user : null);
  platform.getProfile = async () => stored;
  platform.upsertProfile = async (next) => Object.assign(stored, next);
  delete require.cache[require.resolve('../../api/optimize')];
  return require('../../api/optimize');
}

module.exports = { TEST_TOKEN, loadOptimizeWithFakeAuth };
