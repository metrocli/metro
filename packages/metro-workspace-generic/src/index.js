'use strict';

module.exports = {
  ...require('./model'),
  ...require('./plan'),
  ...require('./catalog-bindings'),
  ...require('./audit-export'),
  // Live operations this pack provides, keyed by op name (see
  // metro-core/src/workspace/pack-ops.js). Each value is the op module or a
  // zero-argument loader returning it. Generic write ops are not ported yet;
  // commands that need one refuse with a clear message.
  ops: Object.freeze({}),
};
