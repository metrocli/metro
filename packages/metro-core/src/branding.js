'use strict';

const CLI_NAME = 'metro';
const TAGLINE = 'Metronome in your terminal';
const POSITIONING = 'Command center for safe billing work - review locally before any API client loads.';
const PACKAGE_DESCRIPTION = `${TAGLINE} - command center for safe billing work.`;

function helpHeaderLines() {
  return [
    `${CLI_NAME} - ${TAGLINE}`,
    '',
    POSITIONING,
  ];
}

module.exports = {
  CLI_NAME,
  TAGLINE,
  POSITIONING,
  PACKAGE_DESCRIPTION,
  helpHeaderLines,
};
