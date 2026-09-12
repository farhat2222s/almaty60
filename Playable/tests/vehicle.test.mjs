import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateCar, CAR} from '../public/vehicle.mjs';
const open=()=>true;

test('heading stays bounded while steering for a long time',()=>{
  const car={x:0,z:0,heading:0,speed:0};
  for(let i=0;i<600;i++)simulateCar(car,{x:1,z:-1,sprint:false},1/60,open);
  assert.ok(Math.abs(car.heading)<=Math.PI+1e-9,'heading wrapped to (-π, π]');assert.ok(car.speed>0);
});

test('releasing boost decelerates at brake rate instead of snapping 16 m/s in one tick',()=>{
  const car={x:0,z:0,heading:0,speed:CAR.maxBoost};
  simulateCar(car,{x:0,z:-1,sprint:false},.05,open);
  assert.ok(car.speed>CAR.maxForward+10&&car.speed<CAR.maxBoost,'first tick only shaves a little');
  let steps=0;while(car.speed>CAR.maxForward+.01&&steps++<100)simulateCar(car,{x:0,z:-1,sprint:false},.05,open);
  assert.ok(steps>=5&&steps<40,`took ${steps} ticks`);
});

test('a wall bounces the car back and records damage above the crash speed',()=>{
  const car={x:0,z:0,heading:0,speed:30};
  const r=simulateCar(car,{x:0,z:0,sprint:false},.1,(x,z)=>z>-1);
  assert.ok(r.hit);assert.ok(car.speed<0,'bounced backwards');assert.ok(car.damage>0);assert.ok(car.z>-1);
});

test('input is car-relative: the same key vector drives straight at any heading',()=>{
  for(const heading of [0,1.2,-2.5,3.1]){
    const car={x:0,z:0,heading,speed:0};
    for(let i=0;i<30;i++)simulateCar(car,{x:0,z:-1,sprint:false},.05,open);
    const d=Math.hypot(car.x,car.z),dir=[-Math.sin(heading),-Math.cos(heading)];
    assert.ok(d>10);assert.ok(Math.abs((car.x*dir[0]+car.z*dir[1])/d-1)<1e-6,'moved along its own forward vector');assert.equal(car.heading,heading);
  }
});
