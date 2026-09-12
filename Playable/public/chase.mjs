// Chase missions: a brand courier drives a fixed street route; the player must catch up and hold position for a moment.
// The route lives in the mission template, so the rules (server or static core) and the renderer derive the same courier
// position from elapsed seconds alone — no per-frame state has to be synchronised.
export const CHASE={speed:20,catchRadius:12,holdSeconds:2,duration:75,startRadius:22};
const cache=new WeakMap();
function metrics(route){
  let m=cache.get(route);if(m)return m;
  const cum=[0];for(let i=1;i<route.length;i++)cum.push(cum[i-1]+Math.hypot(route[i].x-route[i-1].x,route[i].z-route[i-1].z));
  m={cum,total:cum[cum.length-1]||0};cache.set(route,m);return m;
}
export function routeLength(route){return Array.isArray(route)&&route.length>1?metrics(route).total:0;}
/** Courier pose after `seconds` on `route` at `speed` m/s. Heading uses the world convention: forward = (-sin h, -cos h). */
export function courierAt(route,seconds,speed=CHASE.speed){
  if(!Array.isArray(route)||!route.length)return {x:0,z:0,heading:0,done:true,progress:1};
  if(route.length===1)return {x:route[0].x,z:route[0].z,heading:0,done:true,progress:1};
  const {cum,total}=metrics(route);
  const d=Math.max(0,Math.min(total,(Number(seconds)||0)*(Number(speed)||CHASE.speed)));
  let i=1;while(i<cum.length-1&&cum[i]<d)i++;
  const a=route[i-1],b=route[i],len=Math.max(1e-6,cum[i]-cum[i-1]),u=Math.max(0,Math.min(1,(d-cum[i-1])/len));
  return {x:a.x+(b.x-a.x)*u,z:a.z+(b.z-a.z)*u,heading:Math.atan2(-(b.x-a.x),-(b.z-a.z)),done:d>=total,progress:total?d/total:1};
}
