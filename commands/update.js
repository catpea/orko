#!/bin/env node
import fs from 'fs';
import path from 'path';
import { Command } from 'commander/esm.mjs';
import Conf from 'conf';
import oneOf from 'oneof';
import mkdirp from 'mkdirp';
import execa from 'execa';
import ms from 'ms';
import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en/index.js'

const DEVEL = true;

const program = new Command();
const config = new Conf({projectSuffix:'catpea'});
TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo('en-US');

program
  .version('1.0.0')
  .requiredOption('-u, --username <user>', 'specify the username')
  .option('-p, --repository <name>', 'specify a repository name instead of selecting one at random')
  .option('-c, --cooldown <miliseconds>', 'prevent hammering github API', 1000*60*45)
  .option('-f, --force', 'force things');

program.parse(process.argv);
const options = program.opts();

main();

async function main(){

  // cooldown check
  if(config.get(`github.${options.username}.refreshed`)){
    console.log(`The ${options.username} repository listing was last refreshed ${timeAgo.format(new Date(config.get(`github.${options.username}.refreshed`)))}.`);
  }else{
    console.error(`User ${options.username} is not in database, did you forget to run "orko refresh ${options.username};" to download the repositories?`);
    process.exit(1);
  }

  // cooldown check
  if(config.get(`github.${options.username}.updated`)){
    const countdown = Math.abs(new Date() - new Date(config.get(`github.${options.username}.updated`)));
    if(countdown < options.cooldown){
      console.error(`You are updating too often, please wait ${ms(options.cooldown - countdown, { long: true })} or set --cooldown to a lower value, cooldown is currently at ${ms(options.cooldown, { long: true })} (${options.cooldown} miliseconds).`);
      process.exit(1);
    }
  }

  // select repository
  const repositories = config.get(`github.${options.username}.repositories`);
  let name = '';
  let repository = '';
  if(options.repository){
    const selected = repositories.filter(i=>i.name===options.repository);
    if(selected.length){
      repository = selected[0].ssh_url;
      name = options.repository;
    }else{
      console.error(`Requested repository ${options.repository} was not found.`);
      process.exit(1);
    }
  }else{
    const selected = oneOf(repositories);
    repository = selected.ssh_url;
    name = selected.name;
  }
  console.log(`Selected: ${name}: ${repository}`);

  await mkdirp('.cache');
  const cloneExists = await exists(path.join('.cache', name));
  const freshlyCloned = false;

  // Download or update
  if(cloneExists){

    console.log(`${name}: has already been cloned. Running git pull inside repository`);
    try {
  		if(!DEVEL){
        const {stdout} = await execa('git', ['pull'], {cwd: path.join(process.cwd(), '.cache', name) });
        console.log(stdout);
      }
  	} catch (error) {
      console.error(`Error executing external command, program will exit with status of 1`);
      console.error(error);
      process.exit(1);
    }

  }else{

    console.log(`${name}: has never been cloned. Running git clone.`);
    try {
    	await execa('git', ['clone', repository], {cwd: path.join(process.cwd(), '.cache') });
      console.log('Repository clonned.');
  	} catch (error) {
      console.error(`Error executing external command, program will exit with status of 1`);
      console.error(error);
      process.exit(1);
    }

  }


  const isNpmPackage = await exists(path.join('.cache', name, 'package.json'));
  let isNpmMaintainer = false;
  let author = '';

  if(isNpmPackage){
    console.log('This is an npm package. But it is not yet known if it has been published yet.');

    try {
    	const {stdout} = await execa('npm', ['info', '--json', name]);
      const packageJson = JSON.parse(stdout);
      author = packageJson._npmUser;
  	} catch (error) {
      console.error(`Error executing external command, program will exit with status of 1`);
      console.error(error);
      process.exit(1);
    }

    isNpmMaintainer = author.startsWith(options.username);
    if(isNpmMaintainer){
      console.log(`Package is published to npm by ${author}.`);
    }else{
      console.log(`Package is not published to npm.`);
    }

  }else{
    console.log('Not an npm package, performing basic maintenance.');
  }


  if(isNpmPackage && isNpmMaintainer){
    const messages = [];
    try {
      console.log(`Running npm update...`);
  		if(!DEVEL){
        const {stdout} = await execa('npm', ['update'], {cwd: path.join(process.cwd(), '.cache', name) });
        messages.push('npm update')
      }
  	} catch (error) {
      console.error(`Error executing external command, program will exit with status of 1`);
      console.error(error);
      process.exit(1);
    }

    try {
      console.log(`Running npm audit fix, will ignore errors...`);
  		const {stdout} = await execa('npm', ['audit', 'fix', '--force'], {cwd: path.join(process.cwd(), '.cache', name) });
      messages.push('npm audit')
  	} catch (error) {
      console.error(`Audit fix failure, ignoring it...`);
      // console.error(error);
      //process.exit(1);
    }

    const packageJsonPath = path.join(process.cwd(), '.cache', name, 'package.json');
    const packageData = fs.readFileSync(packageJsonPath).toString();
    const packageJson = JSON.parse(packageData);

    if(packageJson.author != author){
      packageJson.author = author;
      messages.push('update package author')
    }

    const license = 'GPL-3.0';
    if(packageJson.license != license){
      packageJson.license = license;
      messages.push('set license')
    }

    if(!packageJson.scripts.save){
      packageJson.scripts.save = `"save": "git add .; git commit -m 'New Release'; git push; npm version patch; npm publish; git push;"`
      messages.push('save script')
    }

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, '  '))
    const message = messages.join(', ') + '.';
    console.log(message);


    ///TODO: test is there are changes to be made here.


    // try {
    //
    //   await execa('git', ['add', '.'], {cwd: path.join(process.cwd(), '.cache', name) });
    //   await execa('git', ['commit', '-m', '"Security an NPM Update"'], {cwd: path.join(process.cwd(), '.cache', name) });
    //   const {stdout} = await execa('git', ['push'], {cwd: path.join(process.cwd(), '.cache', name) });
    //   console.log(stdout);
    // } catch (error) {
    //   console.error(`Gir commit failure`);
    //   console.error(error);
    //   process.exit(1);
    // }
    //
    // try {
    //   await execa('npm', ['version', 'minor'], {cwd: path.join(process.cwd(), '.cache', name) });
    //   const {stdout} = await execa('npm', ['publish'], {cwd: path.join(process.cwd(), '.cache', name) });
    //   console.log(stdout);
    //   await execa('git', ['push'], {cwd: path.join(process.cwd(), '.cache', name) });
    // } catch (error) {
    //   console.error(`Npm publish failure...`);
    //   console.error(error);
    //   process.exit(1);
    // }


  }





}

let exists = s => new Promise(r=>fs.access(s, fs.constants.F_OK, e => r(!e)))
