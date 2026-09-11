/** WGS84 geodetic ↔ Earth-centered Cartesian ↔ local tangent plane.
 * Game axes: x east, z south, y up, in meters. UE axes: X=x*100,Y=z*100,Z=y*100.
 * This is georeferencing, not a terrain/elevation or GPS-presence verification service.
 */
export const WGS84=Object.freeze({semiMajorAxis:6378137,inverseFlattening:298.257223563});
const A=WGS84.semiMajorAxis,F=1/WGS84.inverseFlattening,E2=F*(2-F),B=A*(1-F),RAD=Math.PI/180;
function finite(value,name){if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${name} must be finite`);return value;}
export function validateWGS84(point){
  if(!point||typeof point!=='object')throw new TypeError('WGS84 point required');
  const lon=finite(point.lon,'longitude'),lat=finite(point.lat,'latitude'),alt=finite(point.alt??0,'altitude');
  if(lon< -180||lon>180||lat< -90||lat>90||alt< -12000||alt>100000)throw new RangeError('WGS84 coordinates out of range');
  return {lon,lat,alt};
}
export function toECEF(point){
  const {lon,lat,alt}=validateWGS84(point),phi=lat*RAD,lambda=lon*RAD,s=Math.sin(phi),c=Math.cos(phi),n=A/Math.sqrt(1-E2*s*s);
  return {x:(n+alt)*c*Math.cos(lambda),y:(n+alt)*c*Math.sin(lambda),z:(n*(1-E2)+alt)*s};
}
export function fromECEF(point){
  const x=finite(point.x,'x'),y=finite(point.y,'y'),z=finite(point.z,'z'),p=Math.hypot(x,y);
  if(Math.hypot(p,z)<B/2)throw new RangeError('ECEF point is outside the supported Earth-surface neighborhood');
  if(p<1e-8)return {lon:0,lat:z>=0?90:-90,alt:Math.abs(z)-B};
  let lat=Math.atan2(z,p*(1-E2));
  for(let i=0;i<20;i++){const s=Math.sin(lat),n=A/Math.sqrt(1-E2*s*s),next=Math.atan2(z+E2*n*s,p);if(Math.abs(next-lat)<1e-15){lat=next;break;}lat=next;}
  const s=Math.sin(lat),n=A/Math.sqrt(1-E2*s*s);
  return {lon:Math.atan2(y,x)/RAD,lat:lat/RAD,alt:p/Math.cos(lat)-n};
}
export function createGeoReference(origin){
  origin=Object.freeze(validateWGS84(origin));const base=toECEF(origin),phi=origin.lat*RAD,lambda=origin.lon*RAD;
  const sp=Math.sin(phi),cp=Math.cos(phi),sl=Math.sin(lambda),cl=Math.cos(lambda);
  function toENU(point){const p=toECEF(point),dx=p.x-base.x,dy=p.y-base.y,dz=p.z-base.z;return {east:-sl*dx+cl*dy,north:-sp*cl*dx-sp*sl*dy+cp*dz,up:cp*cl*dx+cp*sl*dy+sp*dz};}
  function fromENU(point){const e=finite(point.east,'east'),n=finite(point.north,'north'),u=finite(point.up??0,'up');return fromECEF({x:base.x-sl*e-sp*cl*n+cp*cl*u,y:base.y+cl*e-sp*sl*n+cp*sl*u,z:base.z+cp*n+sp*u});}
  const toLocal=point=>{const p=toENU(point);return {x:p.east,y:p.up,z:-p.north};};
  const fromLocal=point=>fromENU({east:point.x,north:-point.z,up:point.y??0});
  const toUE=point=>{const p=toLocal(point);return {X:p.x*100,Y:p.z*100,Z:p.y*100};};
  const fromUE=point=>fromLocal({x:finite(point.X,'X')/100,z:finite(point.Y,'Y')/100,y:finite(point.Z??0,'Z')/100});
  return Object.freeze({origin,toENU,fromENU,toLocal,fromLocal,toUE,fromUE});
}
export function validateBBox(bbox){
  if(!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite))throw new TypeError('bbox must be [west,south,east,north]');
  const [w,s,e,n]=bbox;if(w< -180||e>180||s< -90||n>90||w>=e||s>=n)throw new RangeError('Invalid bbox');return bbox;
}
export const pointInBBox=(point,bbox)=>{validateBBox(bbox);const p=validateWGS84(point);return p.lon>=bbox[0]&&p.lon<=bbox[2]&&p.lat>=bbox[1]&&p.lat<=bbox[3];};
export function projectGeoJSON(collection,origin){
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))throw new TypeError('FeatureCollection required');
  const reference=createGeoReference(origin);
  function coordinates(value){
    if(!Array.isArray(value))throw new TypeError('Invalid coordinates');
    if(typeof value[0]==='number'){const p=reference.toLocal({lon:value[0],lat:value[1],alt:value[2]??0});return [p.x,p.z,p.y];}
    return value.map(coordinates);
  }
  return {type:'AL60LocalFeatureCollection',version:1,coordinateSystem:{datum:'WGS84',sourceCRS:'EPSG:4326',projection:'ECEF to local ENU',origin:reference.origin,units:'meters',coordinateOrder:['east','south','up'],ueCoordinateOrder:['X=east*100','Y=south*100','Z=up*100']},attribution:collection.attribution,license:collection.license,features:collection.features.map(f=>({type:'Feature',id:f.id,properties:structuredClone(f.properties||{}),geometry:{type:f.geometry.type,coordinates:coordinates(f.geometry.coordinates)}}))};
}
