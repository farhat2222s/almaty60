// Static-build smoke: the browser bundle must run the rules without Node-only code.
// Builds the real-city world from the shipped dataset, creates the core in memory and plays a few inputs.
import fs from 'node:fs';
import {buildWorld} from '../public/world-builder.mjs';
import {setWorld} from '../public/world-data.mjs';
import {createGameCore} from '../public/game-core.mjs';
const world=setWorld(buildWorld(JSON.parse(fs.readFileSync(new URL('../public/geo/city-local.json',import.meta.url),'utf8'))));
let mono=0;const core=createGameCore({clock:{now:()=>Date.UTC(2026,8,11),monotonic:()=>mono},random:{uuid:()=>'00000000-0000-4000-8000-'+String(++mono).padStart(12,'0'),int:n=>0}});
const state=core.handle('GET','/api/state');
if(state.missions.length!==25||state.cars.length!==12||!world.canWalk(state.player.position.x,state.player.position.z))throw new Error('unexpected world state');
mono+=250;const moved=core.handle('POST','/api/input',{x:1,z:0,sprint:true});
if(Math.hypot(moved.player.position.x-state.player.position.x,moved.player.position.z-state.player.position.z)<1)throw new Error('input did not move the player');
console.log('static smoke ok:',state.missions.length,'missions,',world.stats.buildings,'buildings, spawn walkable');
