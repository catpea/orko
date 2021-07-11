#!/bin/env node

import fs from 'fs';
import axios from 'axios';
import ms from 'ms';
import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en/index.js'
import { Command } from 'commander/esm.mjs';
import Conf from 'conf';

const program = new Command();
const config = new Conf({projectName: 'orko', projectSuffix:'catpea'});
TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo('en-US');

program
  .version('1.0.0')
  .requiredOption('-u, --username <user>', 'specify the username')
  .option('-c, --cooldown <miliseconds>', 'prevent hammering github API', 1000*60*45)
  .option('-p, --per-page <interger>', 'specify how many per page (max was 100 in 2020)', 100)
  .option('-f, --force', 'force things');

program.parse(process.argv);
const options = program.opts();

main();

async function main(){

  //TODO: convert to functions

  // cooldown check
  if(config.get(`github.${options.username}.refreshed`)){
    console.log(`The ${options.username} repository listing was last refreshed ${timeAgo.format(new Date(config.get(`github.${options.username}.refreshed`)))}.`);
    const countdown = Math.abs(new Date() - new Date(config.get(`github.${options.username}.refreshed`)));
    if(countdown < options.cooldown){
      console.error(`You are refreshing too often, please wait ${ms(options.cooldown - countdown, { long: true })} or set --cooldown to a lower value, cooldown is currently at ${ms(options.cooldown, { long: true })} (${options.cooldown} miliseconds).`);
      process.exit(1);
    }
  }

  // download repositories and store data
  const repositories = [];
  let page = 1;
  let list = (await axios.get(`https://api.github.com/users/${options.username}/repos?type=source&per_page=${options.perPage}&page=${page}`)).data;
  list.map(i=>repositories.push(i));
  while(hasMore(list.length, options.perPage)){
    page++;
    await sleep(1000);
    list = (await axios.get(`https://api.github.com/users/${options.username}/repos?type=source&per_page=${options.perPage}&page=${page}`)).data;
    list.map(i=>repositories.push(i));
  } // while
  config.set(`github.${options.username}.refreshed`, (new Date()).toISOString());
  config.set(`github.${options.username}.repositories`, repositories);

}



function sleep(ms){
  return new Promise(function(resolve, reject){
    setTimeout(function(){
      resolve();
    },ms);
  })
}

function hasMore(returnedCount, per_page){
  let lastPage = false;
  let emptyPage = false;
  if(returnedCount < per_page) lastPage = true;
  if(returnedCount == 0) emptyPage = true;
  if(emptyPage||lastPage){
    return false;
  }else{
    return true;
  }
}
