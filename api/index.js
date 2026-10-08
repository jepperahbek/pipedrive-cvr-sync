// Vercel serverless function. The backend is bundled into a single,
// dependency-inlined CommonJS file at build time (`npm run build:serverless`)
// so @vercel/node does not need to trace cross-package `.ts` imports. A
// vercel.json rewrite funnels every /api/* request here; the Express app keeps
// its own /api/... route prefixes and reads the original path from req.url.
const mod = require('../packages/backend/dist/serverless.cjs');
module.exports = mod.default || mod;
