#!/usr/bin/env node
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
const { main } = require(coreCli);
main();
