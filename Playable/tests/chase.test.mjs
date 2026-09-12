// Chase missions on a synthetic world: rules only, no city dataset needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameCore, GameError} from '../public/game-core.mjs';
import {courierAt, routeLength, CHASE} from '../public/chase.mjs';

function world(){
  return {version:3,spawn:{x:0,z:0},landmarks:[],brands:[{id:'b',name:'B',category:'c',symbol:'B',color:'#fff',x:0,z:0}],npcs:[],collectibles:[],
    // heading -π/2 faces east (forward = (-sin h, -cos h)); the courier route runs east then south.
    cars:[{id:'car-0',x:5,z:0,heading:-Math.PI/2,model:0,color:'#fff',speed:0,damage:0}],
    missions:[{id:'b-chase',brandId:'b',title:'Догони',type:'chase',duration:CHASE.duration,difficulty:'Hard',xp:300,coins:160,rewardLabel:'R',start:{x:0,z:0},targets:[],route:[{x:20,z:0},{x:1500,z:0},{x:1500,z:400}],courierSpeed:22,campaignId:'campaign-b',active:true,mode:'virtual',maxRewards:500}],
    canWalk:(x,z)=>Number.isFinite(x)&&Number.isFinite(z)};
}
function fixture(){
  let mono=0,n=0;
  const c=createGameCore({world:world(),clock:{now:()=>Date.UTC(2026,8,11),monotonic:()=>mono},random:{uuid:()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0'),int:()=>0}});
  return {advance:ms=>{mono+=ms;},get:()=>c.handle('GET','/api/state'),post:(u,b={})=>c.handle('POST',u,b)};
}

test('courierAt walks the route at constant speed, keeps the heading convention and stops at the end',()=>{
  const route=[{x:0,z:0},{x:100,z:0},{x:100,z:50}];
  assert.equal(routeLength(route),150);
  const a=courierAt(route,0,10);assert.deepEqual([a.x,a.z,a.done],[0,0,false]);
  const b=courierAt(route,5,10);assert.equal(b.x,50);assert.equal(b.z,0);assert.ok(Math.abs(b.heading-Math.atan2(-1,-0))<1e-9,'east = heading -π/2');
  const c=courierAt(route,12,10);assert.equal(c.x,100);assert.ok(Math.abs(c.z-20)<1e-9);
  const d=courierAt(route,100,10);assert.deepEqual([d.x,d.z,d.done],[100,50,true]);
  assert.equal(courierAt(route,NaN,10).x,0);assert.equal(courierAt([],5).done,true);assert.equal(courierAt([{x:3,z:4}],5).x,3);
});

test('chase: starts only behind the wheel, the courier moves with time, holding contact for 2 s wins',()=>{
  const f=fixture();
  assert.throws(()=>f.post('/api/missions/b-chase/start'),e=>e instanceof GameError&&e.error==='NEED_CAR');
  f.post('/api/car');assert.equal(f.get().player.driving,'car-0');
  let s=f.post('/api/missions/b-chase/start');const a=s.activeAttempt;
  assert.equal(a.type,'chase');assert.equal(a.total,1);assert.equal(a.route.length,3);assert.equal(a.chase.courier.x,20);assert.equal(a.chase.needed,CHASE.holdSeconds);
  assert.equal(s.missions.find(m=>m.id==='b-chase').route,undefined,'routes are not shipped with the mission list');
  f.advance(1000);s=f.get();assert.ok(Math.abs(s.activeAttempt.chase.courier.x-42)<1e-6,'22 m/s');assert.equal(s.activeAttempt.chase.contact,0);
  // Pursuit controller: aim for the courier's speed plus a share of the gap; no steering.
  let result=null,steps=0;
  while(!result&&steps++<400){
    f.advance(250);const st=f.get();if(!st.activeAttempt){result=st.lastAttempt;break;}
    const gap=st.activeAttempt.chase.courier.x-st.player.position.x,car=st.cars.find(c=>c.id==='car-0');
    const want=22+(gap-3)*.8,z=car.speed<want?-1:car.speed>want+2?1:0;
    const r=f.post('/api/input',{x:0,z,sprint:gap>40});if(!r.activeAttempt)result=r.lastAttempt;
  }
  assert.ok(result,'chase ended');assert.equal(result.status,'won');assert.equal(result.reason,'courier_caught');assert.ok(steps<200,'caught within 50 s');
  const st=f.get();
  assert.ok(st.player.achievements.some(x=>x.id==='hunter'));assert.equal(st.rewards.length,1);assert.equal(st.rewards[0].title,'R');assert.ok(st.player.xp>=300);
  assert.equal(st.player.driving,'car-0','still driving after the win');
});

test('chase: no contact before the timer ends fails the attempt without a reward',()=>{
  const f=fixture();f.post('/api/car');f.post('/api/missions/b-chase/start');
  f.advance(30_000);let s=f.get();assert.equal(s.activeAttempt.status,'active');assert.ok(s.activeAttempt.chase.courier.x>600);
  f.advance(CHASE.duration*1000);s=f.get();
  assert.equal(s.activeAttempt,null);assert.equal(s.lastAttempt.status,'failed');assert.equal(s.lastAttempt.reason,'timeout');assert.equal(s.rewards.length,0);
});

test('chase: contact decays when the player falls behind, so a drive-by does not count',()=>{
  const f=fixture();f.post('/api/car');f.post('/api/missions/b-chase/start');
  // Full throttle with boost: the car blows past the courier and keeps going.
  for(let i=0;i<40;i++){f.advance(250);f.post('/api/input',{x:0,z:-1,sprint:true});}
  const s=f.get();assert.equal(s.activeAttempt.status,'active');assert.ok(s.activeAttempt.chase.contact<CHASE.holdSeconds);
  assert.ok(s.player.position.x>s.activeAttempt.chase.courier.x+50,'player is far ahead');
});
