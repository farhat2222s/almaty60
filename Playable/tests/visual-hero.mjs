import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import {GLTFLoader} from '../public/vendor/GLTFLoader.js';
import {createHeroFromGLTF} from '../public/hero.mjs';
const file=fs.readFileSync(new URL('../public/assets/models/casual-character.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
const hero=createHeroFromGLTF(gltf);hero.root.updateMatrixWorld(true);
const model=hero.root.getObjectByName('AlmatyRunnerModel'),shirt=model.getObjectByName('Casual2_Body_1'),shoes=model.getObjectByName('Casual2_Feet_2'),eyes=model.getObjectByName('Casual2_Head_4'),pack=hero.root.getObjectByName('AlmatyBackpack');
const size=new THREE.Box3().setFromObject(model,true).getSize(new THREE.Vector3());
assert.ok(Math.abs(size.y-3.2)<.001);assert.equal(pack.parent.name,'Chest');
assert.ok(new THREE.Box3().setFromObject(eyes,true).getCenter(new THREE.Vector3()).z<0,'eyes face -Z');
const packStart=pack.getWorldPosition(new THREE.Vector3());assert.ok(packStart.distanceTo(new THREE.Vector3(0,2.15,.17))<1e-6,'chest.attach preserves backpack placement');
const shoeColor=shoes.material.color.getHex();hero.setSkin('#45b6bb');assert.equal(shirt.material.color.getHexString(),'45b6bb');assert.equal(shoes.material.color.getHex(),shoeColor,'wardrobe keeps footwear color');
const reports=[];
for(const [name,opts]of [['Idle',{}],['Walk',{moving:true}],['Run',{moving:true,sprint:true}],['Scooter idle',{vehicle:true}]]){
 let min=Infinity,max=-Infinity,packFinite=true;
 for(let i=0;i<180;i++){
  hero.update({dt:1/60,...opts});hero.root.updateMatrixWorld(true);
  const bounds=new THREE.Box3();for(const part of ['Casual2_Feet_1','Casual2_Feet_2'])bounds.union(new THREE.Box3().setFromObject(model.getObjectByName(part),true));
  min=Math.min(min,bounds.min.y);max=Math.max(max,bounds.min.y);
  const position=pack.getWorldPosition(new THREE.Vector3());packFinite&&=position.toArray().every(Number.isFinite);
 }
 assert.ok(packFinite);reports.push({animation:name,minimumSoleHeight:+min.toFixed(4),maximumSoleHeight:+max.toFixed(4)});
}
console.log(JSON.stringify({height:+size.y.toFixed(4),animationCount:hero.animationNames.length,front:'-Z',wardrobe:'body garment only',backpackParent:pack.parent.name,backpackInitial:packStart.toArray(),reports},null,2));hero.dispose();
