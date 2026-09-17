#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { stdout } from 'node:process';

const MIN_NODE_MAJOR = 20;

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
  console.error(`[setup] Node ${MIN_NODE_MAJOR}+ required (found v${process.versions.node}).`);
  process.exit(1);
}

stdout.write('\n[setup] Installing dependencies (npm install)\n');
execSync('npm install', { stdio: 'inherit' });

stdout.write('\n[setup] Done. There is no database to migrate.\n\n');
stdout.write(
  'Run a migration job:\n' +
    '  npm run handover -- <job-dir>          # writes proof/ and plain-export/\n' +
    '  npm run handover -- <job-dir> --check  # verify only\n' +
    '  npm run measure  -- <template-dir>     # survey a batch\n' +
    '  npm run components -- demo             # component-model walkthrough\n',
);
