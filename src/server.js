import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', service: 'scopegate', time: new Date().toISOString() });
});

// Core admission endpoint: natural-language buyer request -> ACCEPT | COUNTER | REJECT.
// Wired to the Gatekeeper evaluator in D2 (Master Spec §6.1); contract in openapi.json.
app.post('/api/v1/scope/negotiate', (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    message: 'Gatekeeper evaluator lands in D2. Contract: POST { buyer_message, budget_usd?, session_id? } -> decision payload (schemas/decision.schema.json).',
  });
});

app.listen(PORT, () => {
  console.log(`[scopegate] listening on :${PORT}`);
});
