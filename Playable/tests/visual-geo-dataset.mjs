import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import {GeoWorld} from '../public/geo-world.mjs';
import {createGeoReference} from '../public/geo/georef.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../public/geo/district-local.json',import.meta.url)));
const original=JSON.parse(fs.readFileSync(new URL('../public/geo/arbat.geojson',import.meta.url)));
const reference=createGeoReference(data.coordinateSystem.origin);
const view=Object.create(GeoWorld.prototype);Object.assign(view,{city:new THREE.Group(),scene:new THREE.Scene(),ownedGeometries:new Set(),materials:new Map(),labels:[],credit:{textContent:''},windowTransforms:[],colliders:[],reference});
view.material=(color,opts={})=>{const key=color+JSON.stringify(opts);if(!view.materials.has(key)){const {surface,...props}=opts;view.materials.set(key,new THREE.MeshStandardMaterial({color,...props}));}return view.materials.get(key);};
view.label=()=>{view.labels.push(new THREE.Sprite(new THREE.SpriteMaterial()));};
view.build(data);
assert.equal(view.stats.buildings,165);assert.equal(view.stats.green,108);assert.equal(view.stats.pois,461);assert.equal(view.stats.estimatedHeights,158);assert.ok(view.canWalk(view.position.x,view.position.z));
let triangles=0,invalid=0;view.city.traverse(mesh=>{const a=mesh.geometry?.attributes.position;if(a){for(let i=0;i<a.array.length;i++)if(!Number.isFinite(a.array[i]))invalid++;triangles+=(mesh.geometry.index?.count||a.count)/3*(mesh.isInstancedMesh?mesh.count:1);}});assert.equal(invalid,0);
const flatten=(coords,out=[])=>{if(typeof coords[0]==='number')out.push(coords);else coords.forEach(c=>flatten(c,out));return out;};
const originals=new Map(original.features.map(f=>[f.id,f]));let points=0,maxDeg=0;
for(const feature of data.features){const local=flatten(feature.geometry.coordinates),wgs=flatten(originals.get(feature.id).geometry.coordinates);assert.equal(local.length,wgs.length);for(let i=0;i<local.length;i++){const p=reference.fromLocal({x:local[i][0],z:local[i][1],y:local[i][2]});maxDeg=Math.max(maxDeg,Math.abs(p.lon-wgs[i][0]),Math.abs(p.lat-wgs[i][1]));points++;}}
assert.ok(maxDeg<1e-7);assert.ok(view.batchStats.staticMeshesAfter<40);const report={stats:view.stats,bounds:view.bounds,walkableSpawn:view.getPosition(),finiteGeometry:true,triangleEstimate:Math.round(triangles),windowInstances:view.windowTransforms.length,sceneMeshes:view.city.children.length,verifiedVertices:points,maxRoundtripErrorDegrees:maxDeg};console.log(JSON.stringify(report,null,2));
for(const g of view.ownedGeometries)g.dispose();for(const m of view.materials.values())m.dispose();
