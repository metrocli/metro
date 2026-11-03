#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Default workspace pack is generic.
if (!process.env.METRO_DEFAULT_WORKSPACE_PACK) {
  process.env.METRO_DEFAULT_WORKSPACE_PACK = 'generic';
}

const fs = require('fs');
const path = require('path');

const bundled = path.resolve(__dirname, '..', 'packages', 'metro-core', 'src', 'cli.js');
const monorepo = path.resolve(__dirname, '..', '..', '..', 'packages', 'metro-core', 'src', 'cli.js');
const coreCli = fs.existsSync(bundled) ? bundled : monorepo;

// `metro init` (first-run setup) and the fresh-machine banner live in metro-core/src/init.
const initModule = path.join(path.dirname(coreCli), 'init');
const args = process.argv.slice(2);
if (args[0] === 'init') {
  require(initModule).runInit(args.slice(1)).then((code) => {
    process.exitCode = code;
  });
} else {
  if (args.length === 0) {
    const { isFreshMachine, startHereBanner } = require(initModule);
    if (isFreshMachine()) process.stdout.write(`${startHereBanner()}\n`);
  }
  const { main } = require(coreCli);
  main();
}
