import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../public/vendor/three.module.js';
import {GeoWorld} from '../public/geo-world.mjs';
const context=Object.create(GeoWorld.prototype);Object.assign(context,{city:new THREE.Group(),ownedGeometries:new Set()});
context.city.position.set(4,2,-8);context.city.rotation.y=.4;const parent=new THREE.Scene();parent.add(context.city);
const material=new THREE.MeshStandardMaterial(),source=new THREE.BoxGeometry(2,3,4);let disposed=0;source.addEventListener('dispose',()=>disposed++);
context.ownedGeometries.add(source);
for(let i=0;i<4;i++){const mesh=new THREE.Mesh(source,material);mesh.position.set(i*7,i,3-i*9);mesh.rotation.y=i*.37;mesh.scale.set(1+i*.1,1,1+i*.2);mesh.castShadow=true;mesh.receiveShadow=true;context.city.add(mesh);}
const windowMesh=new THREE.InstancedMesh(source,material,1);windowMesh.name='keep-window-instance';context.city.add(windowMesh);
parent.updateMatrixWorld(true);const before=new THREE.Box3().setFromObject(context.city,true);const windowId=windowMesh.id;
context.mergeStaticMeshes();parent.updateMatrixWorld(true);const after=new THREE.Box3().setFromObject(context.city,true);
assert.ok(before.min.distanceTo(after.min)<.00002&&before.max.distanceTo(after.max)<.00002,'merge preserves world geometry under transformed parent');
assert.equal(context.city.children.filter(x=>!x.isInstancedMesh).length,1);assert.ok(context.city.children.some(x=>x.id===windowId));assert.equal(disposed,0,'shared window geometry stays alive');
const report={worldBoundsPreserved:true,windowInstancePreserved:true,sharedGeometryNotDisposed:true,batches:context.batchStats};console.log(JSON.stringify(report));
for(const geometry of context.ownedGeometries)geometry.dispose();material.dispose();
