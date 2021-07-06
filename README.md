# orko
Automatic Package And Repository Maintenance Bot

Orko is under development. It is going great, it loads repository lists from github, performs npm update an audits, and updates commonly broken fields in package.json.

What to expect:

```shell

orko -username test -package test;

cloning test
running npm update
running audit fix
fixing package.json
publishing to npm
pushing to gihub

```
