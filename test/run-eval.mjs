// Gatekeeper evaluation runner (Master Spec §7.2): drives the 6 canonical cases against a
// running gateway and asserts expected verdicts.
//
//   node src/server.js            # terminal 1
//   node test/run-eval.mjs        # terminal 2  (BASE_URL=http://... to target a deploy)

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const { readFileSync } = await import('node:fs');
const crypto = await import('node:crypto');
const evalSuite = JSON.parse(readFileSync(new URL('./eval-cases.json', import.meta.url), 'utf8'));

let failures = 0;

function check(label, pass, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
}

async function negotiate(buyerInput) {
  const res = await fetch(`${BASE_URL}/api/v1/scope/negotiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buyerInput),
  });
  return { http: res.status, body: await res.json() };
}

const adjudication = evalSuite.cases.filter((c) => c.type === 'adjudication');
const decisionSessionIds = {};

for (const testCase of adjudication) {
  console.log(`\nCase ${testCase.id}: ${testCase.name}`);
  const { http, body } = await negotiate(testCase.buyer_input);
  check('HTTP 200', http === 200, `got ${http} ${JSON.stringify(body).slice(0, 120)}`);
  if (http !== 200) continue;

  decisionSessionIds[testCase.id] = body.session_id;
  check(`decision = ${testCase.expected.decision}`, body.decision === testCase.expected.decision, `got ${body.decision}`);
  check(`gate_mode = ${body.gate_meta?.mode}`, Boolean(body.gate_meta?.mode), `mode=${body.gate_meta?.mode}`);

  if (testCase.expected.quoted_price !== undefined) {
    check(`quoted_price = ${testCase.expected.quoted_price}`, body.quoted_price === testCase.expected.quoted_price, `got ${body.quoted_price}`);
  }
  if (Array.isArray(testCase.expected.risk_flags)) {
    for (const flag of testCase.expected.risk_flags) {
      check(`risk_flag includes ${flag}`, body.risk_flags.includes(flag), `got [${body.risk_flags}]`);
    }
  }
  if (body.decision !== 'REJECT') {
    check('contract_hash is 64-char hex', /^[0-9a-f]{64}$/.test(body.contract_hash ?? ''), `got ${body.contract_hash}`);
  }
}

// Case 6: idempotent replay — same session_id must resolve to the same PayPal order.
const case6 = evalSuite.cases.find((c) => c.type === 'idempotency_replay');
console.log(`\nCase ${case6.id}: ${case6.name}`);
const acceptSession = decisionSessionIds[4];
let case6OrderId = null;
if (!acceptSession) {
  check('case 4 session available for checkout', false, 'case 4 did not produce a session');
} else {
  const first = await fetch(`${BASE_URL}/api/v1/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: acceptSession }),
  }).then((r) => r.json());

  if (first.error) {
    check('first checkout succeeds', false, first.message?.slice(0, 160));
  } else {
    const second = await fetch(`${BASE_URL}/api/v1/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: acceptSession }),
    }).then((r) => r.json());

    check('first checkout returns an order id', Boolean(first.order_id), first.order_id);
    check('replay returns the SAME order id', first.order_id === second.order_id, `${first.order_id} vs ${second.order_id}`);
    check('replay flagged as replayed', second.replayed === true);
    case6OrderId = first.order_id;
  }
}

// D3: delivery gateway + dispute dossier (dispatch -> tracked download -> export).
console.log('\nD3: delivery tracking & dispute dossier export');
const sid = acceptSession;
if (!sid) {
  check('case 4 session available for delivery checks', false);
} else {
  const dispatchRes = await fetch(`${BASE_URL}/api/v1/delivery/${sid}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payer_email: 'sb-buyer@personal.example.com' }),
  });
  const dispatch = await dispatchRes.json();
  check('dispatch HTTP 200', dispatchRes.status === 200, JSON.stringify(dispatch).slice(0, 120));
  check('dispatch records payer email', dispatch.payer_email === 'sb-buyer@personal.example.com', dispatch.payer_email);
  check('dispatch records artifact sha256 (64-char hex)', /^[0-9a-f]{64}$/.test(dispatch.artifact_sha256 ?? ''), dispatch.artifact_sha256);

  const artifactRes = await fetch(`${BASE_URL}/api/v1/delivery/${sid}/artifact`);
  const artifactBody = await artifactRes.text();
  check('artifact download HTTP 200', artifactRes.status === 200, `got ${artifactRes.status}`);
  const downloadedHash = crypto.createHash('sha256').update(artifactBody).digest('hex');
  check('downloaded artifact hash matches dispatch record', downloadedHash === dispatch.artifact_sha256);

  const dossierRes = await fetch(`${BASE_URL}/api/v1/sessions/${sid}/dossier`);
  const dossier = await dossierRes.json();
  check('dossier export HTTP 200', dossierRes.status === 200, JSON.stringify(dossier).slice(0, 120));
  check('dossier anchors the paypal order id', dossier.paypal_order_id === case6OrderId, `${dossier.paypal_order_id} vs ${case6OrderId}`);
  const sessionRecord = await fetch(`${BASE_URL}/api/v1/sessions/${sid}`).then((r) => r.json());
  check('dossier anchors the contract hash (custom_id)', dossier.paypal_custom_id_anchor === sessionRecord.decision.contract_hash, `${dossier.paypal_custom_id_anchor} vs ${sessionRecord.decision.contract_hash}`);
  check('dossier cites Seller Protection Intangible-Goods clause', String(dossier.policy_compliance).includes('Intangible Goods Additional Requirements'));
  check('dossier snapshot max_revisions = 2', dossier.contract_snapshot?.max_revisions === 2);
  check('dossier log has client ip', Boolean(dossier.proof_of_delivery?.recipient_access_log?.client_ip), dossier.proof_of_delivery?.recipient_access_log?.client_ip);
  check('dossier log hash equals artifact hash', dossier.proof_of_delivery?.recipient_access_log?.artifact_sha256 === dispatch.artifact_sha256);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
