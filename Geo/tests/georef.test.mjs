import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeoReference,toECEF,fromECEF,validateWGS84,validateBBox,pointInBBox,projectGeoJSON} from '../../Playable/public/geo/georef.mjs';
const anchor={lon:76.943,lat:43.261,alt:0};
const ref=createGeoReference(anchor),close=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
test('origin maps exactly to zero and axes are east/south/up',()=>{
  assert.deepEqual(ref.toLocal(anchor),{x:0,y:0,z:-0});
  const east=ref.toLocal({...anchor,lon:anchor.lon+.001}),north=ref.toLocal({...anchor,lat:anchor.lat+.001}),up=ref.toLocal({...anchor,alt:100});
  assert.ok(east.x>80&&east.x<82);assert.ok(north.z< -110&&north.z> -112);close(up.y,100,1e-7);close(up.x,0,1e-7);
});
test('WGS84 round trip across Arbat-sized district keeps submillimeter accuracy',()=>{
  for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){
    const original={lon:76.9375+i*.00125,lat:43.2585+j*.00045,alt:(i+j)*3};
    const restored=ref.fromLocal(ref.toLocal(original));close(restored.lon,original.lon,1e-10);close(restored.lat,original.lat,1e-10);close(restored.alt,original.alt,1e-5);
  }
});
test('UE centimeter export round trips and preserves south-positive handedness',()=>{
  const p={lon:76.946,lat:43.260,alt:8},local=ref.toLocal(p),ue=ref.toUE(p);close(ue.X,local.x*100,1e-8);close(ue.Y,local.z*100,1e-8);
  const restored=ref.fromUE(ue);close(restored.lon,p.lon,1e-10);close(restored.lat,p.lat,1e-10);close(restored.alt,p.alt,1e-5);
});
test('ECEF valid surface including pole and malformed coordinates are guarded',()=>{
  const pole=fromECEF(toECEF({lon:0,lat:90,alt:10}));close(pole.lat,90,1e-9);close(pole.alt,10,1e-7);
  assert.throws(()=>validateWGS84({lon:NaN,lat:43}));assert.throws(()=>validateWGS84({lon:76,lat:143}));assert.throws(()=>validateBBox([2,2,1,1]));
  assert.equal(pointInBBox(anchor,[76.93,43.25,76.95,43.27]),true);assert.equal(pointInBBox(anchor,[76,40,76.5,41]),false);
});
test('GeoJSON projection retains IDs/provenance and never declares meter coordinates to be WGS84 GeoJSON',()=>{
  const original={type:'FeatureCollection',attribution:'© OpenStreetMap contributors',license:'ODbL-1.0',features:[{type:'Feature',id:'osm:node/1',properties:{source:'OpenStreetMap'},geometry:{type:'Point',coordinates:[anchor.lon,anchor.lat]}}]};
  const result=projectGeoJSON(original,anchor);assert.equal(result.type,'AL60LocalFeatureCollection');assert.equal(result.features[0].id,'osm:node/1');assert.equal(result.features[0].properties.source,'OpenStreetMap');
  assert.deepEqual(result.features[0].geometry.coordinates,[0,-0,0]);assert.equal(original.features[0].geometry.coordinates[0],anchor.lon);
});
