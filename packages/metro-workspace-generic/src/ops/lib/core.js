'use strict';

// Single place where generic-pack ops reach into metro-core. Both packages
// ship together in the metro npm package, so the relative path is stable.

const CORE = '../../../../metro-core/src';

const lazy = (rel) => () => require(`${CORE}/${rel}`);

module.exports = {
  canonicalHash: require(`${CORE}/util/canonical-hash`),
  mode: require(`${CORE}/setup/mode`),
  tenant: require(`${CORE}/clients/metronome-tenant`),
  http: require(`${CORE}/clients/metronome-http`),
  retry: require(`${CORE}/clients/metronome-retry-client`),
  read: require(`${CORE}/clients/metronome-read`),
  write: require(`${CORE}/clients/metronome-write`),
  prodApply: require(`${CORE}/clients/production-apply`),
  customerResolve: require(`${CORE}/ops-live/customer-resolve`),
  files: require(`${CORE}/input/files`),
  // Lazy: these pull in the workspace loader, which may load this pack.
  loader: lazy('workspace/loader'),
  validators: lazy('validators'),
  preview: lazy('preview'),
};
