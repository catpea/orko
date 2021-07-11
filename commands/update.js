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
const config = new Conf({projectName: 'orko', projectSuffix:'catpea'});
TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo('en-US');

program
  .version('1.0.0')

  .requiredOption('-u, --username <user>', 'specify the github username')
  .requiredOption('-n, --npm-username <user>', 'specify the npm username')

  .option('-p, --repository <name>', 'specify a repository name instead of selecting one at random')
  .option('-c, --cooldown <miliseconds>', 'prevent hammering github API', 1000*60*45)
  .option('-l, --license <license>', 'set license field')
  .option('-f, --force', 'force things');

program.parse(process.argv);
const options = program.opts();

main();

async function main(){


  const state = {
    cachePath: path.join( process.cwd(), '.cache' ),

    // ... ... ... ... ... //
    repositoryName: null,
    repositoryUrl: null,
    repositoryPath: null,

    // ... ... ... ... ... //
    isPublished: false, // NOTE: this refers to published to npm registry.
    isElectron: false,

    // ... ... ... ... ... //
    packageAuthor: null,

    // ... ... ... ... ... //
    updateLog: [],
  };

  await checkData({ lastRefreshed: config.get(`github.${options.username}.refreshed`), username: options.username });
  await cooldownCheck({ lastUpdated: config.get(`github.${options.username}.updated`), cooldownPeriod: options.cooldown, });

  await selectRepository({ state, requestedRepository: options.repository, repositories: config.get(`github.${options.username}.repositories`), })
  await ensureRepository({ state, })
  await identifyRepository({ state, })

  if(!state.isPublished){
    console.log('Exiting... will not update unpublished npm packages, as they are considered alpha.');
    process.exit(1);
  }

  if(state.isElectron){
    console.log('Exiting... will not update electron packages.')
    process.exit(1);
  }

  await npmUpdate({ state, })
  await auditFix({ state, })
  await authorFix({ state, })
  await licenseFix({ state, license: options.license})
  await saveScript({ state, })

  const hasChanges = await checkForChanges({ state, });
  if(!hasChanges){
    console.log('Exiting... nothing to update.');
    process.exit(1);
  }

  console.log(`"Maintenance: ${state.updateLog.join(', ')}."`);
  await gitCommit({ state, });
  await gitPush({ state, });
  await npmPublish({ state, });

}

// Helpers

function exists(target){
  return new Promise(r=>fs.access(target, fs.constants.F_OK, e => r(!e)))
}

function checkData({lastRefreshed, username}){
  if(lastRefreshed){
    console.log(`The ${username} repository listing was last refreshed ${timeAgo.format(new Date(lastRefreshed))}.`);
  }else{
    console.error(`User ${username} data is not in database, did you forget to run "orko refresh ${username};" to download the user repositories?`);
    process.exit(1);
  }
}

function cooldownCheck({lastUpdated, cooldownPeriod}){
  if(lastUpdated){
    const countdown = Math.abs(new Date() - new Date(lastUpdated));
    if(countdown < cooldownPeriod){
      console.error(`You are updating too often, please wait ${ms( cooldownPeriod - countdown, { long: true })} or set --cooldown to a lower value, cooldown is currently at ${ms(cooldownPeriod, { long: true })} (${cooldownPeriod} miliseconds).`);
      process.exit(1);
    }else{
      const expiredAgo = new Date(lastUpdated);
      expiredAgo.setDate( expiredAgo.getDate() - cooldownPeriod );
      console.log(`Cooldown limit (${ms(cooldownPeriod, { long: true })}) has expired ${timeAgo.format(expiredAgo)}.`);
    }
  }else{
    console.log(`The repository set is new and has not yet logged any updates.`);
  }
}

function selectRepository({state, requestedRepository, repositories}){
  let selected = null;

  if(requestedRepository){
    const candidate = repositories.filter(i=>i.name===requestedRepository).shift();
    if(candidate){
      selected = candidate;
    }else{
      console.error(`Requested repository ${requestedRepository} was not found.`);
      process.exit(1);
    }
  }else{
    selected = oneOf(repositories);
  }
  state.repositoryName = selected.name;
  state.repositoryUrl = selected.ssh_url;
  console.log(`Selected: ${state.repositoryName}: ${state.repositoryUrl}`);
}

async function ensureRepository({state, }) {
  await mkdirp(state.cachePath);
  state.repositoryPath = path.join(state.cachePath, state.repositoryName);

  const cloneExists = await exists(state.repositoryPath);
  const firstTime = !cloneExists;

  if (firstTime) {
    console.log(`${state.repositoryName}: has never been cloned. Running git clone.`);
    try {
      await execa("git", ["clone", state.repositoryUrl], { cwd: state.cachePath });
      console.log("Repository cloned.");
    } catch (error) {
      console.error( `Error executing external command, program will exit with status of 1` );
      console.error(error);
      process.exit(1);
    }
  }

  if (cloneExists) {
    console.log(`${state.repositoryName}: has already been cloned. Running git pull inside repository`);
    try {
      const { stdout } = await execa("git", ["pull"], { cwd: state.repositoryPath, });
      console.log(stdout);
    } catch (error) {
      console.error( `Error executing external command, program will exit with status of 1` );
      console.error(error);
      process.exit(1);
    }
  }
  console.log(`Ensured: ${state.repositoryName}: ${state.repositoryPath}`);
}

async function identifyRepository({state, }) {
  const hasNpmPackage = await exists(path.join(state.repositoryPath, 'package.json'));
  let packageJson = '';
  if(hasNpmPackage){
    try {
      const {stdout} = await execa('npm', ['info', '--json', state.repositoryName]);
      packageJson = JSON.parse(stdout);
    } catch (error) {
      console.error(`Error executing external command, program will exit with status of 1`);
      console.error(error);
      process.exit(1);
    }
    state.packageAuthor = packageJson._npmUser;
    const isOwner = packageJson._npmUser.startsWith(options.npmUsername);
    if(isOwner){
      state.isPublished = true;
      console.log(`Package is published to npm by: ${packageJson._npmUser}`);
    }else{
      state.isPublished = false;
      console.log(`Package is not published to npm.`);
    }
    const electronSpec = packageJson.dependencies?.electron||packageJson.devDependencies?.electron;
    const hasElectron = (electronSpec);
    if(hasElectron){
      state.isElectron = true;
      console.log(`Package contains electron (ver: ${electronSpec}).`);
    }else{
      state.isElectron = false;
      console.log(`Package does not seem to rely on electron.`);
    }
  }else{
    //TODO: blacklist non npm packages?
    console.log('Not an npm package. Should be blacklisted');
  }
}

async function npmUpdate({state, }) {
  try {
    console.log(`Running npm update, this will take a while...`);
    const {stdout} = await execa('npm', ['update'], {cwd: state.repositoryPath });
    state.updateLog.push('npm update');
  } catch (error) {
    console.error(`Error executing npm update, program will exit with status of 1`);
    console.error(error);
    process.exit(1);
  }
}

async function auditFix({state, }) {
  try {
    console.log(`Running npm audit fix, will ignore errors...`);
    const {stdout} = await execa('npm', ['audit', 'fix', '--force'], {cwd: state.repositoryPath });
    state.updateLog.push('npm audit')
  } catch (error) {
    console.error(`Audit fix failure, ignoring it...`);
  }
}

async function authorFix({state, }) {
  const packageJson = await fs.readJson(path.join(state.repositoryPath, 'package.json'));
  if(packageJson.author != state.packageAuthor){
    packageJson.author = state.packageAuthor;
    state.updateLog.push('update package author');
  }
  await fs.writeJson(path.join(state.repositoryPath, 'package.json'), packageJson, {spaces: 2});
}

async function licenseFix({state, license}) {
  if(!license) return;
  const packageJson = await fs.readJson(path.join(state.repositoryPath, 'package.json'));
  if(packageJson.license != license){
    packageJson.license = license;
    state.updateLog.push('update license');
  }
  await fs.writeJson(path.join(state.repositoryPath, 'package.json'), packageJson, {spaces: 2});
}

async function saveScript({state, }) {
  const packageJson = await fs.readJson(path.join(state.repositoryPath, 'package.json'));
  if(!packageJson.scripts.save){
    packageJson.scripts.save = `"save": "git add .; git commit -m 'New Release'; git push; npm version patch; npm publish; git push;"`
    state.updateLog.push('add save script');
  }
  await fs.writeJson(path.join(state.repositoryPath, 'package.json'), packageJson, {spaces: 2})
}

async function gitCommit({state, }) {
  const commitMessage = `"Maintenance: ${state.updateLog.join(', ')}."`;
  try {
    await execa('git', ['add', '.'], {cwd: state.repositoryPath });
    await execa('git', ['commit', '-m', commitMessage], {cwd: state.repositoryPath });
  } catch (error) {
    console.error(`Gir commit failure`);
    console.error(error);
    process.exit(1);
  }
}

async function gitPush({state, }) {
  try {
    const {stdout} = await execa('git', ['push'], {cwd: state.repositoryPath });
  } catch (error) {
    console.error(`Git push failure, program will exit with status of 1`);
    console.error(error);
    process.exit(1);
  }
}

async function npmPublish({state, }) {
  try {
    await execa('npm', ['version', 'minor'], {cwd: state.repositoryPath });
    const {stdout} = await execa('npm', ['publish'], {cwd: state.repositoryPath });
    console.log(stdout);
    await execa('git', ['push'], {cwd: state.repositoryPath });
  } catch (error) {
    console.error(`Npm publish failure... program will exit with status of 1`);
    console.error(error);
    process.exit(1);
  }
}

async function checkForChanges({state, }) {
  let changes = 0;
  try {
    const {stdout} = await execa('git', ['status', '-s'], {cwd: state.repositoryPath });
    changes = stdout.trim().split('\n').filter(i=>i).length;
  } catch (error) {
    console.error(`Error executing git status -s command, program will exit with status of 1`);
    console.error(error);
    process.exit(1);
  }
  return changes;
}


//
