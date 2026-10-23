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
    check('payment_plan has 3 milestones', body.payment_plan?.length === 3, JSON.stringify(body.payment_plan?.map((m) => m.milestone_id)));
    const sum = (body.payment_plan ?? []).reduce((s, m) => s + m.amount, 0);
    check('payment_plan sums to quoted_price', Math.abs(sum - body.quoted_price) < 0.001, `${sum} vs ${body.quoted_price}`);
  }
}

// Case 6: milestone payments — per-stage idempotent replay + locked-stage gating.
// NOTE: this suite runs headless, so no PayPal capture happens here; the m2/m3 unlock
// path (capture → download → next stage) is proven by the live sandbox E2E run instead.
const case6 = evalSuite.cases.find((c) => c.type === 'milestone_payments');
console.log(`\nCase ${case6.id}: ${case6.name}`);
const acceptSession = decisionSessionIds[4];
let case6OrderId = null;
const hashOf = async (sid) => (await fetch(`${BASE_URL}/api/v1/sessions/${sid}`).then((r) => r.json())).decision.contract_hash;

if (!acceptSession) {
  check('case 4 session available for checkout', false, 'case 4 did not produce a session');
} else {
  const checkout = (milestoneId) =>
    fetch(`${BASE_URL}/api/v1/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: acceptSession, milestone_id: milestoneId }),
    });

  const first = await checkout('m1').then((r) => r.json());
  const second = await checkout('m1').then((r) => r.json());
  const early = await checkout('m2');

  if (first.error) {
    check('m1 checkout succeeds', false, first.message?.slice(0, 160));
  } else {
    check('m1 checkout returns an order id', Boolean(first.order_id), first.order_id);
    check('m1 custom_id = contract_hash:m1', first.custom_id === `${first.contract_hash}:m1`, first.custom_id);
    check('m1 amount = 40% of quote', first.amount === 200, `got ${first.amount}`);
    check('m1 replay returns the SAME order id', first.order_id === second.order_id, `${first.order_id} vs ${second.order_id}`);
    check('m1 replay flagged as replayed', second.replayed === true);
    check('m2 checkout locked before m1 capture+acceptance', early.status === 409, `got ${early.status}`);
    case6OrderId = first.order_id;
  }
}

// D3: delivery gateway + dispute dossier (dispatch -> tracked download -> export), now
// milestone-scoped: m1 dispatch/download feeds a dossier whose ledger covers all 3 stages.
console.log('\nD3: delivery tracking & dispute dossier export');
const sid = acceptSession;
if (!sid) {
  check('case 4 session available for delivery checks', false);
} else {
  const dispatchRes = await fetch(`${BASE_URL}/api/v1/delivery/${sid}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ milestone_id: 'm1', payer_email: 'sb-buyer@personal.example.com' }),
  });
  const dispatch = await dispatchRes.json();
  check('m1 dispatch HTTP 200', dispatchRes.status === 200, JSON.stringify(dispatch).slice(0, 120));
  check('m1 dispatch records milestone id', dispatch.milestone_id === 'm1', dispatch.milestone_id);
  check('m1 dispatch records payer email', dispatch.payer_email === 'sb-buyer@personal.example.com', dispatch.payer_email);
  check('m1 dispatch records artifact sha256 (64-char hex)', /^[0-9a-f]{64}$/.test(dispatch.artifact_sha256 ?? ''), dispatch.artifact_sha256);

  const artifactRes = await fetch(`${BASE_URL}/api/v1/delivery/${sid}/artifact?milestone=m1`);
  const artifactBody = await artifactRes.text();
  check('m1 artifact download HTTP 200', artifactRes.status === 200, `got ${artifactRes.status}`);
  check('artifact text names the milestone', artifactBody.includes('milestone_id:  m1'));
  const downloadedHash = crypto.createHash('sha256').update(artifactBody).digest('hex');
  check('downloaded artifact hash matches dispatch record', downloadedHash === dispatch.artifact_sha256);

  const dossierRes = await fetch(`${BASE_URL}/api/v1/sessions/${sid}/dossier?milestone=m1`);
  const dossier = await dossierRes.json();
  check('dossier export HTTP 200', dossierRes.status === 200, JSON.stringify(dossier).slice(0, 120));
  check('dossier scoped to milestone m1', dossier.milestone_id === 'm1', dossier.milestone_id);
  check('dossier anchors the m1 paypal order id', dossier.paypal_order_id === case6OrderId, `${dossier.paypal_order_id} vs ${case6OrderId}`);
  const contractHash = await hashOf(sid);
  check('dossier anchors the contract hash (custom_id prefix)', dossier.paypal_custom_id_anchor === contractHash);
  check('dossier ledger has all 3 milestones', dossier.payment_ledger?.length === 3, `got ${dossier.payment_ledger?.length}`);
  check('ledger row 1 custom_id = hash:m1', dossier.payment_ledger?.[0]?.custom_id === `${contractHash}:m1`, dossier.payment_ledger?.[0]?.custom_id);
  check('ledger row 1 order id matches m1 order', dossier.payment_ledger?.[0]?.order_id === case6OrderId);
  check('ledger row 2 shows the locked stage (NONE)', dossier.payment_ledger?.[1]?.status === 'NONE', dossier.payment_ledger?.[1]?.status);
  check('dossier cites Seller Protection Intangible-Goods clause', String(dossier.policy_compliance).includes('Intangible Goods Additional Requirements'));
  check('dossier snapshot max_revisions = 2', dossier.contract_snapshot?.max_revisions === 2);
  check('dossier log has client ip', Boolean(dossier.proof_of_delivery?.recipient_access_log?.client_ip), dossier.proof_of_delivery?.recipient_access_log?.client_ip);
  check('dossier log hash equals artifact hash', dossier.proof_of_delivery?.recipient_access_log?.artifact_sha256 === dispatch.artifact_sha256);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
