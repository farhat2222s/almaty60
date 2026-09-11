// Arcade car model shared by the game rules (server / static core) and the client prediction.
// Input is the same {x,z,sprint} vector as walking: z=-1 accelerates (W), z=+1 brakes / reverses (S), x steers.
export const CAR={accel:24,brake:46,reverse:.55,coast:7,turn:2.4,maxForward:48,maxBoost:64,maxReverse:12,bounce:.3,crashSpeed:12};
export function simulateCar(car,input,dt,canWalk){
  const throttle=-(Number(input.z)||0),steer=Number(input.x)||0,maxF=input.sprint?CAR.maxBoost:CAR.maxForward;
  let v=Number(car.speed)||0;
  if(throttle>.05)v+=(v<0?CAR.brake:CAR.accel)*throttle*dt;
  else if(throttle<-.05)v-=(v>0?CAR.brake:CAR.accel*CAR.reverse)*(-throttle)*dt;
  else v-=Math.sign(v)*Math.min(Math.abs(v),CAR.coast*dt);
  v=Math.max(-CAR.maxReverse,Math.min(maxF,v));
  // Heading convention: forward = (-sin h, -cos h). Increasing h turns left, so D (x=+1) decreases it.
  if(Math.abs(steer)>.05&&Math.abs(v)>.5)car.heading-=steer*CAR.turn*dt*Math.min(1,Math.abs(v)/18)*Math.sign(v);
  const fx=-Math.sin(car.heading),fz=-Math.cos(car.heading),step=v*dt,n=Math.max(1,Math.ceil(Math.abs(step)/.8));
  let hit=false;
  for(let i=0;i<n;i++){const nx=car.x+fx*step/n,nz=car.z+fz*step/n;if(canWalk(nx,nz)){car.x=nx;car.z=nz;}else{hit=true;break;}}
  if(hit){if(Math.abs(v)>CAR.crashSpeed)car.damage=Math.min(100,(car.damage||0)+Math.round(Math.abs(v)*.4));v=-v*CAR.bounce;}
  car.speed=Math.abs(v)<.05?0:v;
  return {hit,speed:car.speed};
}
