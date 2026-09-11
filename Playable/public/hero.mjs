import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

// Casual Character by Quaternius, CC0. See assets/models/LICENSE.md.
export async function loadHero() {
  const gltf=await new GLTFLoader().loadAsync(new URL('./assets/models/casual-character.glb',import.meta.url).href);
  return createHeroFromGLTF(gltf);
}

/** Separate construction also permits checking the real GLB without a browser renderer. */
export function createHeroFromGLTF(gltf,{height=3.2}={}) {
  if(!gltf?.scene?.isObject3D)throw new Error('The character model has no scene.');
  const root=new THREE.Group(),model=gltf.scene;
  root.name='AlmatyRunner';model.name='AlmatyRunnerModel';root.add(model);model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
  if(!Number.isFinite(size.y)||size.y<=0)throw new Error('The character has invalid bounds.');
  const normalizedHeight=Number.isFinite(height)&&height>0?height:3.2,scale=normalizedHeight/size.y;
  model.scale.multiplyScalar(scale);model.position.y-=bounds.min.y*scale;
  // The eye/nose geometry faces model +Z; CityWorld's forward direction is -Z.
  model.rotation.y=Math.PI;
  const jackets=[];
  model.traverse(o=>{
    if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;
    const convert=m=>{
      const next=m.clone();next.roughness=.83;next.metalness=0;
      // Casual2's garment is LightBrown; Red_Dark is its shoe trim, not its shirt.
      if(m.name==='LightBrown'&&o.name.startsWith('Casual2_Body')){next.color.set('#182d40');jackets.push(next);}
      if(m.name==='Red_Dark')next.color.set('#253849');
      if(m.name==='White')next.color.set('#adb5b6');
      if(m.name==='LightBlue')next.color.set('#294b68');
      return next;
    };
    o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);
  });
  const pack=new THREE.Group();pack.name='AlmatyBackpack';
  // Root-space attachment is at the upper back; chest.attach preserves this pose.
  const relative=normalizedHeight/3.2;pack.position.set(0,2.15*relative,.17*relative);pack.scale.setScalar(relative);
  const fabric=new THREE.MeshStandardMaterial({color:'#152638',roughness:.96});
  const trim=new THREE.MeshStandardMaterial({color:'#637785',roughness:.64});
  const accent=new THREE.MeshStandardMaterial({color:'#edc43d',roughness:.77});
  const packPart=(w,h,d,x,y,z,mat=fabric)=>{const part=new THREE.Mesh(new THREE.CapsuleGeometry(1,1,4,8),mat);part.scale.set(w/2,h/3,d/2);part.position.set(x,y,z);part.castShadow=true;pack.add(part);return part;};
  packPart(.72,.94,.40,0,0,.10);packPart(.54,.36,.18,0,-.23,.32);
  for(const x of [-.23,.23])packPart(.065,.85,.035,x,0,.33,trim);
  packPart(.11,.20,.03,0,.02,.315,accent);
  root.add(pack);root.updateMatrixWorld(true);
  const chest=model.getObjectByName('Chest');if(chest)chest.attach(pack);
  const mixer=new THREE.AnimationMixer(model),actions={};
  for(const clip of gltf.animations||[])actions[clip.name.split('|').at(-1)]=mixer.clipAction(clip);
  let active=null;
  const play=name=>{
    const next=actions[name]||actions.Idle||Object.values(actions)[0];if(!next||next===active)return;
    active?.fadeOut(.18);next.reset().setEffectiveTimeScale(name==='Run'?1.1:1).setEffectiveWeight(1).fadeIn(.18).play();active=next;
  };
  play('Idle');
  return {root,animationNames:Object.keys(actions),
    update({dt=0,moving=false,sprint=false,vehicle=false,jump=0}={}){play(vehicle?'Idle_Neutral':moving?(sprint?'Run':'Walk'):'Idle');mixer.update(Math.min(.1,Math.max(0,Number(dt)||0)));model.rotation.x=jump>0?-.09:0;},
    setSkin(hex){jackets.forEach(m=>m.color.set(hex));},
    dispose(){mixer.stopAllAction();mixer.uncacheRoot(model);const geometries=new Set(),materials=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
  };
}
