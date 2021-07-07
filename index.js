#!/bin/env node
import { Command } from 'commander/esm.mjs';
const program = new Command();

program
  .version('1.0.0')
  .description('Automatic Package And Repository Maintenance Bot')
  .command('refresh', 'refresh repository list', { executableFile: 'commands/refresh.js', isDefault: true }).alias('r')
  .command('update', 'update a random package', { executableFile: 'commands/update.js', isDefault: true });

program.parse(process.argv);
