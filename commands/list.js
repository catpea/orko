#!/bin/env node
import fs from 'fs-extra';
import path from 'path';
import { readFile } from 'fs/promises';

import { Command } from 'commander/esm.mjs';
import Conf from 'conf';
import oneOf from 'oneof';
import mkdirp from 'mkdirp';
import execa from 'execa';
import ms from 'ms';
import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en/index.js'
import startCase from 'lodash/startCase.js'

const program = new Command();
const config = new Conf({projectSuffix:'catpea'});
TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo('en-US');

program
  .version('1.0.0')
  .requiredOption('-u, --username <user>', 'specify the username')
  .option('-p, --repository <name>', 'specify a repository name instead of selecting one at random')
  .option('-c, --cooldown <miliseconds>', 'prevent hammering github API', 1000*60*45)
  .option('-l, --license <license>', 'set license field')
  .option('-f, --force', 'force things');

program.parse(process.argv);
const options = program.opts();

main();

async function main(){

  await checkData({ lastRefreshed: config.get(`github.${options.username}.refreshed`), username: options.username });

  const repositories = config.get(`github.${options.username}.repositories`);

  //console.log(JSON.stringify(repositories.map(i=>({name:i.name})), null, '  '));

  repositories
  .map(i=>({name:i.name}))
  .map(i=>console.log(i.name))
}

// Helpers

function exists(target){
  return new Promise(r=>fs.access(target, fs.constants.F_OK, e => r(!e)))
}

function checkData({lastRefreshed, username}){
  if(lastRefreshed){
    console.log(`# The ${username} repository listing was last refreshed ${timeAgo.format(new Date(lastRefreshed))}.`);
  }else{
    console.error(`User ${username} data is not in database, did you forget to run "orko refresh ${username};" to download the user repositories?`);
    process.exit(1);
  }
}



//
