'use strict';

/**
 * Routing for pack ops that follow the preflight/apply contract and have no
 * dedicated command module: provisioning (customer, rate card, package,
 * contract, subscription) and package clone-version.
 *
 *   metro <noun> <verb> preflight ...   read-only plan + sha256 hash
 *   metro <noun> <verb> apply ...       dry run, or --apply with typed confirmation
 */

const { loadPackOp, refusePackOpUnavailable } = require('../workspace/pack-ops');

const ROUTES = Object.freeze([
  { words: ['customer', 'create'], op: 'customer-create' },
  { words: ['ratecard', 'create'], op: 'ratecard-create' },
  { words: ['rate-card', 'create'], op: 'ratecard-create' },
  { words: ['ratecard', 'add-rates'], op: 'ratecard-add-rates' },
  { words: ['rate-card', 'add-rates'], op: 'ratecard-add-rates' },
  { words: ['package', 'create'], op: 'package-create' },
  { words: ['package', 'clone-version'], op: 'package-clone-version' },
  { words: ['contract', 'create'], op: 'contract-create' },
  { words: ['subscription', 'add'], op: 'subscription-add' },
  { words: ['subscription', 'set-quantity'], op: 'subscription-set-quantity' },
  { words: ['subscription', 'seats'], op: 'subscription-seats' },
]);

function matchProvisionRoute(positional) {
  return ROUTES.find((r) => positional[0] === r.words[0] && positional[1] === r.words[1]) || null;
}

function runProvisionCommand(positional, flags, streams, argv = []) {
  const route = matchProvisionRoute(positional);
  const name = `metro ${route.words.join(' ')}`;
  const action = positional[2];
  if (action !== 'preflight' && action !== 'apply') {
    streams.stderr.write([
      'Usage:',
      `  ${name} preflight ... (--sandbox|--prod) [--out=<plan.json>] [--json]`,
      `  ${name} apply --file <plan.json> --confirm-hash <sha256:...> (--sandbox|--prod) [--json]`,
      `  ${name} apply ... --apply --confirm-live-apply=I_UNDERSTAND_THIS_WILL_WRITE_LIVE_METRONOME_SANDBOX   (sandbox)`,
      `  ${name} apply ... --prod --apply --confirm-prod-apply=I_UNDERSTAND_BILLING_SIDE_EFFECTS              (production)`,
      'Start with --sandbox. See docs/metronome-cli/PROVISIONING.md.',
    ].join('\n') + '\n');
    return flags.help ? 0 : 1;
  }
  const ops = loadPackOp(route.op);
  if (!ops) {
    return refusePackOpUnavailable(streams, { command: positional.join(' '), op: route.op, purpose: `needed for ${name}` });
  }
  const run = action === 'preflight' ? ops.runPreflight : ops.runApply;
  return Promise.resolve(run({ ...flags, argv }, streams)).then(
    (r) => r.exitCode,
    (err) => {
      streams.stderr.write(`\nFATAL: ${err.message}\n`);
      return 1;
    },
  );
}

module.exports = {
  PROVISION_ROUTES: ROUTES,
  matchProvisionRoute,
  runProvisionCommand,
};
