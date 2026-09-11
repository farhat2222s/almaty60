import * as THREE from './vendor/three.module.js';
import {createSurfaceLibrary} from './materials.mjs';
import {CityAtmosphere} from './atmosphere.mjs';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {EffectComposer} from './vendor/addons/postprocessing/EffectComposer.js';
import {RenderPass} from './vendor/addons/postprocessing/RenderPass.js';
import {SSAOPass} from './vendor/addons/postprocessing/SSAOPass.js';
import {UnrealBloomPass} from './vendor/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from './vendor/addons/postprocessing/OutputPass.js';
import { WORLD, SPEEDS, canWalk } from './world-data.mjs';
import {simulateCar} from './vehicle.mjs';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {insidePolygon,hash} from './world-builder.mjs';
const CAR_YAW=Math.PI; // Kenney car models face +Z; game heading 0 faces -Z.

const TAU = Math.PI * 2;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const mix = (a,b,t)=>a+(b-a)*t;
const angleLerp=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const seeded=(n)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
const isField=(e)=>e.target?.closest?.('input,textarea,select,[contenteditable="true"]');

/** Local, procedural 3D view. Gameplay and rewards remain owned by the server. */
export class CityWorld {
  constructor(canvas, {onInput=()=>{},onInteract=()=>{},onView=()=>{}}={}) {
    this.canvas=canvas;this.onInput=onInput;this.onInteract=onInteract;this.onView=onView;
    this.canvas.style.touchAction='none';this.keys=new Set();this.touch={x:0,z:0,sprint:false};this.paused=false;
    if(!WORLD)throw new Error('World is not loaded');this.world=WORLD;const SPAWN=WORLD.spawn;
    this.position={...SPAWN};this.serverPosition={...SPAWN};this.state={};this.heading=0;this.carState=null;this.lastDragTime=0;
    this.orbit={yaw:-Math.PI/2,pitch:.19,distance:10.5};this.cameraTarget=new THREE.Vector3();this.cameraRay=new THREE.Ray();this.cameraHit=new THREE.Vector3();this.cameraBoxes=WORLD.buildings.map(b=>new THREE.Box3(new THREE.Vector3(b.box.minX-.2,0,b.box.minZ-.2),new THREE.Vector3(b.box.maxX+.2,b.height+3,b.box.maxZ+.2)));
    this.lastInput=0;this.lastView=0;this.lastTime=0;this.walkTime=0;this.jump=0;this.jumpVelocity=0;
    this.materials=new Map();this.geometries=new Map();this.batches=new Map();this.collectibles=[];this.pedestrians=[];this.labels=[];
    try {
      this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
      this.maxPixelRatio=Math.min(window.devicePixelRatio||1,1.75);this.pixelRatio=this.maxPixelRatio;this.quality='auto';this.frameSamples=[];this.lastQualityCheck=0;this.metrics={};
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;
      this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure=1.12;
      this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    } catch(error) {
      this.error=error;
      const warning=document.createElement('div');warning.className='world-webgl-fallback';warning.setAttribute('role','alert');
      warning.style.cssText='position:absolute;inset:0;display:grid;place-content:center;background:#071b2e;color:#fff;text-align:center;padding:32px;font:16px system-ui;z-index:5';
      warning.innerHTML='<strong style="font-size:24px;color:#ffd338">Не удалось включить 3D</strong><p>Для игры нужен браузер с WebGL.<br>Откройте прототип в Chrome, Edge или Safari<br>с включённым аппаратным ускорением.</p>';
      canvas.parentNode?.append(warning);console.warn('ALMATY 60: WebGL unavailable',error);return;
    }
    this.surfaces=createSurfaceLibrary(THREE,this.renderer);
    this.scene=new THREE.Scene();this.scene.fog=new THREE.Fog('#bcd4e6',160,820);
    this.camera=new THREE.PerspectiveCamera(62,1,0.1,1300);
    this.camera.position.set(WORLD.spawn.x+.65,4,WORLD.spawn.z+10.5);
    this.postfx='auto';this.ssaoTooSlow=false;this.setupPostFX();
    this.setupLighting();this.buildEnvironment();this.buildCity();this.flushBatches();this.atmosphereController=new CityAtmosphere(THREE,this);
    this.player=this.makePerson('#142939',true);this.player.root.scale.setScalar(1.27);this.scene.add(this.player.root);
    this.scooter=this.makeScooter();this.scooter.visible=false;this.scene.add(this.scooter);
    this.playerShadow=new THREE.Mesh(new THREE.CircleGeometry(1.2,24),new THREE.MeshBasicMaterial({color:'#112432',transparent:true,opacity:0.18,depthWrite:false}));
    this.playerShadow.rotation.x=-Math.PI/2;this.scene.add(this.playerShadow);
    this.targetGroup=new THREE.Group();this.scene.add(this.targetGroup);
    this.waypointGroup=new THREE.Group();this.scene.add(this.waypointGroup);
    this.setupInput();this.resize();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
    this.frame=(time)=>{if(this.disposed)return;this.raf=requestAnimationFrame(this.frame);this.renderFrame(time)};
    this.raf=requestAnimationFrame(this.frame);
  }
  material(color, opts={}) {
    const surface=opts.surface||({'#586b72':'asphalt','#d9d2ba':'paving','#c7bca3':'paving','#d2c9ad':'paving','#d2c7a3':'paving','#b9945e':'wood','#7a6650':'wood'}[color]);
    const key=color+JSON.stringify(opts);
    if(!this.materials.has(key)){
      const properties={...opts};delete properties.surface;
      const material=new THREE.MeshStandardMaterial({color,roughness:.76,metalness:0,envMapIntensity:.7,...properties});
      if(surface){this.surfaces.apply(material,surface);material.userData.surface=surface;}
      this.materials.set(key,material);
    }
    return this.materials.get(key);
  }
  geometry(type) {
    if(!this.geometries.has(type))this.geometries.set(type, type==='box'?new THREE.BoxGeometry(1,1,1):type==='sphere'?new THREE.SphereGeometry(1,12,10):type==='foliage'?this.makeFoliageGeometry():type==='round'?new THREE.SphereGeometry(1,20,14):type==='cone'?new THREE.ConeGeometry(1,1,14,3):type==='cylinder'?new THREE.CylinderGeometry(1,1,1,10):type==='dome'?new THREE.SphereGeometry(1,14,8,0,TAU,0,Math.PI/2):new THREE.BoxGeometry(1,1,1));
    return this.geometries.get(type);
  }
  shape(type,color,x,y,z,sx=1,sy=1,sz=1,ry=0,opts={}) {
    const material=this.material(color,opts),geo=this.geometry(type),key=geo.uuid+material.uuid;
    if(!this.batches.has(key))this.batches.set(key,{geo,material,items:[]});
    this.batches.get(key).items.push({x,y,z,sx,sy,sz,ry});
  }
  flushBatches() {
    const dummy=new THREE.Object3D();
    for(const batch of this.batches.values()) {
      const mesh=new THREE.InstancedMesh(batch.geo,batch.material,batch.items.length);
      batch.items.forEach((a,i)=>{dummy.position.set(a.x,a.y,a.z);dummy.rotation.set(0,a.ry,0);dummy.scale.set(a.sx,a.sy,a.sz);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix)});
      mesh.castShadow=batch.items.some(a=>a.sy>1 && Math.min(a.sx,a.sz)>.65 && Math.max(a.sx,a.sz)<300);mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;this.scene.add(mesh);
    }
    this.batches.clear();
  }
  mesh(type,color,x,y,z,sx=1,sy=1,sz=1,opts={}) {
    const mesh=new THREE.Mesh(this.geometry(type),this.material(color,opts));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
  }
  setupLighting() {
    const sky=this.sky=new THREE.Mesh(new THREE.SphereGeometry(1100,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#2f7fd1')},bottom:{value:new THREE.Color('#dfe9f2')}},vertexShader:'varying vec3 vWorld; void main(){vec4 p=modelMatrix*vec4(position,1.0);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}',fragmentShader:'uniform vec3 top;uniform vec3 bottom;varying vec3 vWorld;void main(){float h=clamp(normalize(vWorld).y*1.5,0.0,1.0);gl_FragColor=vec4(mix(bottom,top,pow(h,0.55)),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'}));
    sky.renderOrder=-20;this.scene.add(sky);
    this.hemi=new THREE.HemisphereLight('#cfe6ff','#736b55',1.85);this.scene.add(this.hemi);
    const reflectionScene=new THREE.Scene();reflectionScene.background=new THREE.Color('#adc6d7');
    const reflectionSky=new THREE.Mesh(new THREE.SphereGeometry(100,24,12),new THREE.MeshBasicMaterial({color:'#bdd8ef',side:THREE.BackSide}));reflectionScene.add(reflectionSky);
    for(let i=0;i<14;i++){const wall=new THREE.Mesh(new THREE.BoxGeometry(12,20+(i%4)*8,8),new THREE.MeshBasicMaterial({color:i%2?'#e6e1d0':'#748b9c'}));const angle=i/14*TAU;wall.position.set(Math.sin(angle)*65,-15,Math.cos(angle)*65);reflectionScene.add(wall);}
    const envMaker=new THREE.PMREMGenerator(this.renderer);this.reflectionMap=envMaker.fromScene(reflectionScene,.03,.1,150);this.scene.environment=this.reflectionMap.texture;envMaker.dispose();reflectionScene.traverse(o=>{o.geometry?.dispose();o.material?.dispose()});
    this.sun=new THREE.DirectionalLight('#ffe9c0',3.1);this.sun.position.set(-90,145,70);this.sun.castShadow=true;
    this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-90,right:90,top:90,bottom:-90,near:1,far:420});
    this.sun.shadow.bias=-0.0004;this.sun.shadow.normalBias=0.04;this.scene.add(this.sun);this.scene.add(this.sun.target);
  }
  mountain(x,z,r,h,seed) {
    const rings=[];const count=9;const rock=new THREE.Color('#7195a6'),snow=new THREE.Color('#eaf5f5');
    for(let j=0;j<3;j++) {
      const ring=[];
      for(let i=0;i<count;i++) {
        const angle=i/count*TAU;
        const radius=r*[1,0.56,0.27][j]*(0.86+seeded(seed+i+j*11)*0.24);
        ring.push(new THREE.Vector3(Math.cos(angle)*radius,h*[0,0.42,0.69][j]+(j?seeded(seed+i*7)*h*0.11:0),Math.sin(angle)*radius));
      }rings.push(ring);
    }
    const positions=[],colors=[];
    const tri=(a,b,c,color)=>{for(const v of [a,b,c]){positions.push(v.x,v.y,v.z);colors.push(color.r,color.g,color.b)}};
    for(let j=0;j<2;j++)for(let i=0;i<count;i++) {
      const n=(i+1)%count,col=rock.clone().multiplyScalar(0.8+seeded(seed+i+j)*0.35);
      tri(rings[j][i],rings[j][n],rings[j+1][i],col);tri(rings[j][n],rings[j+1][n],rings[j+1][i],col);
    }
    for(let i=0;i<count;i++)tri(rings[2][i],rings[2][(i+1)%count],new THREE.Vector3(r*.05,h,0),snow.clone().multiplyScalar(0.87+seeded(seed+i)*0.16));
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true,side:THREE.DoubleSide}));mesh.position.set(x,-4,z);this.scene.add(mesh);(this.mountains??=[]).push(mesh);mesh.userData.distant=z<-430;
  }
  buildEnvironment() {
    const b=this.world.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,w=b.maxX-b.minX,d=b.maxZ-b.minZ;
    this.shape('box','#8da58f',cx,-1.6,cz,w+1800,2,d+1800);
    this.shape('box','#cfc8b4',cx,-0.2,cz,w+40,0.4,d+40);
    // Zailiysky Alatau rises south of the city (z grows southwards in this frame); Kok-Tobe with its TV tower sits south-east.
    const ridge=b.maxZ+420;
    for(let i=0;i<16;i++)this.mountain(b.minX-500+i*175,ridge+seeded(i)*120,150+seeded(i*3)*60,260+seeded(i*5)*160,i+1);
    for(let i=0;i<12;i++)this.mountain(b.minX-400+i*220,ridge-140-seeded(i+80)*60,130,120+seeded(i+63)*90,i+31);
    const tx=b.maxX+180,tz=b.maxZ+260;
    this.shape('cone','#5e8796',tx,55,tz,140,110,100);
    this.shape('cylinder','#bcc8ce',tx,180,tz,1.4,150,1.4);
    this.shape('cylinder','#345a70',tx,215,tz,7,8,7);
    this.shape('cone','#e8dbbc',tx,255,tz,.7,70,.7);
  }
  makeFoliageGeometry() {
    const geometry=new THREE.IcosahedronGeometry(1,1),p=geometry.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=1+Math.sin(x*13+y*8)*Math.sin(z*11-y*4)*.11+Math.sin(z*19+x*6)*.045;p.setXYZ(i,x*r,y*r,z*r)}
    geometry.computeVertexNormals();return geometry;
  }
  tree(x,z,seed=0,kind='leaf') {
    const scale=.82+seeded(seed+4)*.4;
    this.shape('cylinder','#756047',x,2.4*scale,z,.17*scale,4.8*scale,.17*scale,0,{surface:'wood'});
    if(kind==='pine') {
      for(let i=0;i<6;i++)this.shape('cone',i%2?'#345c45':'#456d50',x,(3.2+i*.77)*scale,z,(2.15-i*.27)*scale,2.8*scale,(2.15-i*.27)*scale,seed,{surface:'foliage'});
    } else {
      for(let i=0;i<4;i++){
        const a=i*2.399,spread=i===0?0:1.2*scale,y=(5.0+seeded(seed+i+83)*1.5)*scale;
        this.shape('foliage',['#627e43','#728c4e','#547b44','#8b9250'][(Math.abs(seed)+i)%4],x+Math.cos(a)*spread,y,z+Math.sin(a)*spread,1.6*scale,(1.6+seeded(i+seed)*.4)*scale,1.55*scale,a,{surface:'foliage',roughness:.95});
      }
    }
    this.shape('cylinder','#49594b',x,.08,z,1.0,.14,1.0);
    for(let i=0;i<3;i++)this.shape('cone','#7b9658',x+Math.sin(i*2.4)*.75,.2,z+Math.cos(i*2.4)*.75,.035,.34+seeded(seed+i)*.24,.18,i);
  }
  bench(x,z,ry=0) {
    const g=(dx,y,dz,sx,sy,sz,color)=>{const cx=x+dx*Math.cos(ry)+dz*Math.sin(ry),cz=z-dx*Math.sin(ry)+dz*Math.cos(ry);this.shape('box',color,cx,y,cz,sx,sy,sz,ry)};
    g(0,.65,0,2.8,.2,.8,'#b9945e');g(0,1.15,-.37,2.8,.75,.14,'#b9945e');
    g(-1,.3,0,.12,.65,.7,'#294858');g(1,.3,0,.12,.65,.7,'#294858');
  }
  lamp(x,z) {
    this.shape('cylinder','#365466',x,3.8,z,.1,7.6,.1);
    this.shape('box','#294858',x,7.6,z,.95,.16,.55);
    this.shape('box','#ffe5ae',x,7.5,z,.7,.06,.4,0,{emissive:'#ffdfa2',emissiveIntensity:.5});
  }
  building(b,i) {
    const {x,z,w,d,h}=b;
    const special=x===-94&&z===-32?'cathedral':x===94&&z===-32?'opera':x===94&&z===-94?'bazaar':null;
    if(special){this.landmarkBuilding(b,special);return;}
    const walls=['#dbd3bf','#b9c3c7','#d0bfa6','#c6d2d0'][i%4],trim='#e4dfd1';
    this.shape('box','#797d78',x,.24,z,w+.8,.48,d+.8,0,{surface:'stone'});
    this.shape('box',walls,x,h/2+.4,z,w,h,d,0,{surface:'stone'});
    this.shape('box','#435965',x,h+.55,z,w+1.0,.5,d+1,0,{roughness:.5});
    this.shape('box','#81918f',x,h+1.2,z,w*.55,1.3,d*.55,0,{surface:'stone'});
    for(const [dx,dz]of[[-7,-6],[6,7]]){this.shape('box','#a5aeb0',x+dx,h+1.1,z+dz,3.2,.9,2.2,.08,{metalness:.5});this.shape('cylinder','#526774',x+dx,h+1.62,z+dz,.8,.15,.8,0,{metalness:.5});}
    for(const side of [-1,1]) {
      const front=z+side*(d/2+.1);
      this.shape('box','#52626a',x,1.9,front,w,3.4,.18,0,{surface:'stone'});
      for(let k=-2;k<=2;k++) {
        const xx=x+k*4.6;
        this.shape('box','#365363',xx,1.82,front+side*.12,3.75,2.85,.12,0,{metalness:.73,roughness:.13,envMapIntensity:1.7});
        for(const dx of [-1.85,0,1.85])this.shape('box','#344955',xx+dx,1.85,front+side*.21,.07,2.88,.07,0,{metalness:.5,roughness:.3});
        this.shape('box',i%3?'#183d4b':'#b18a59',xx,3.6,front+side*.53,4.2,.17,1.15,0,{roughness:.7});
        this.shape('box',i%3?'#214c5a':'#c99d60',xx,3.43,front+side*1.0,4.2,.34,.08);
        for(let stripe=0;stripe<5;stripe++)this.shape('box','#e2d5b9',xx-1.75+stripe*.85,3.695,front+side*.54,.20,.016,1.1);
      }
      this.shape('box',trim,x,4.15,front,w+.12,.38,.32,0,{surface:'stone'});
      for(let k=-3;k<=3;k++)this.shape('box',trim,x+k*3.75,h*.52,front,.3,h-4.6,.27,0,{surface:'stone'});
      for(let y=6;y<h-1;y+=3.5)for(let k=-2;k<=2;k++) {
        const xx=x+k*4.4,lit=(k+i+Math.round(y))%6===0;
        const glass=['#61818c','#4b6977','#72878d','#405d70'][(k+i+Math.round(y)+30)%4];
        this.shape('box','#354d59',xx,y,front+side*.06,2.3,2.03,.13);
        this.shape('box',lit?'#aeab92':glass,xx,y,front+side*.15,2.07,1.83,.10,0,{metalness:.65,roughness:.17,envMapIntensity:1.8,...(lit?{emissive:'#ffd18e',emissiveIntensity:.09}:{})});
        this.shape('box','#c3c8c6',xx,y,front+side*.24,.065,1.87,.07,0,{metalness:.4});
        this.shape('box','#c3c8c6',xx,y+.2,front+side*.24,2.12,.065,.07,0,{metalness:.4});
        this.shape('box',trim,xx,y-1.06,front+side*.25,2.5,.16,.38,0,{surface:'stone'});
        if(i%3===1&&k%2===0){this.shape('box','#cad1cb',xx,y-1.12,front+side*.55,2.8,.18,1.08);this.shape('box','#466476',xx,y-.72,front+side*1.05,2.7,.64,.065,0,{metalness:.6,roughness:.2});for(const end of[-1,1])this.shape('box','#728686',xx+end*1.3,y-.69,front+side*.62,.055,.8,.85,0,{metalness:.5});}
      }
      for(let y=6;y<h-1;y+=3.5)for(let k=-2;k<=2;k++){
        this.shape('box','#4e6a77',x+side*(w/2+.04),y,z+k*4.1,.16,1.9,2.0,0,{metalness:.65,roughness:.18,envMapIntensity:1.7});
        this.shape('box',trim,x+side*(w/2+.1),y-1.07,z+k*4.1,.25,.14,2.3);
      }
    }
  }
  landmarkBuilding(b,type) {
    const{x,z,w,d}=b;
    this.shape('box','#d5c8a8',x,.45,z,w,.9,d);
    if(type==='cathedral') {
      this.shape('box','#f0d079',x,6.0,z,w,11.1,d);
      this.shape('box','#b2c5b3',x,12,z,w+1.2,1.1,d+1);
      this.shape('box','#e8d3a1',x,14,z,8,4,8);
      for(const [dx,dz,s]of [[0,0,1.4],[-8,-7,.82],[8,-7,.82],[-8,7,.82],[8,7,.82]]) {
        this.shape('cylinder','#e9c777',x+dx,15*s+(1-s)*10,z+dz,2.1*s,4*s,2.1*s);
        this.shape('round','#e0b642',x+dx,18*s+(1-s)*10,z+dz,2.7*s,3.0*s,2.7*s,0,{metalness:.65,roughness:.3});
        this.shape('cone','#ffdf69',x+dx,21.2*s+(1-s)*10,z+dz,.6*s,2.5*s,.6*s);
        this.shape('box','#d6a735',x+dx,23*s+(1-s)*10,z+dz,.18*s,2.5*s,.18*s);
        this.shape('box','#d6a735',x+dx,23.6*s+(1-s)*10,z+dz,1.2*s,.18*s,.18*s);
      }
      for(let k=-2;k<=2;k++)for(const side of [-1,1]) {
        this.shape('box','#436a6b',x+k*4.5,6.8,z+side*(d/2+.07),1.6,4,.16);
        this.shape('box','#fff1c3',x+k*4.5,9.2,z+side*(d/2+.18),2.5,.45,.35);
      }
    } else if(type==='opera') {
      this.shape('box','#d4c09a',x,6.6,z,w,12.3,d);
      this.shape('box','#eaddb9',x,13.1,z,w+1.2,.9,d+1);
      for(let k=-3;k<=3;k++) {
        this.shape('cylinder','#f1e6c9',x+k*3.1,6,z+d/2+.08,.55,10,.55);
        this.shape('box','#9eaa9c',x+k*3.1,5,z+d/2-.2,1.6,7.5,.12);
      }
      this.shape('cone','#b9a78a',x,16,z,14,5,12,Math.PI/4);
      this.shape('box','#d2c49e',x,1,z+d/2,25,2,.12);
    } else {
      this.shape('box','#d9c7a8',x,3.8,z,w,6.7,d);
      this.shape('box','#398c83',x,7.4,z,w+1.2,.6,d+1.2);
      for(let k=-2;k<=2;k++) {
        this.shape('box','#1f6872',x+k*4.6,3.3,z+d/2+.1,3.8,4.5,.18);
        this.shape('box',k%2?'#f4c863':'#e9e1c0',x+k*4.6,5.3,z+d/2+.9,4.6,.28,1.8);
        this.shape('box','#bd8758',x+k*4.6,1.1,z+d/2+.25,3.1,1.3,.35);
      }
      this.label('ЗЕЛЁНЫЙ БАЗАР',x,9.4,z+d/2+.25,{width:12,color:'#efffd4',background:'#145951',height:1.6});
    }
  }
  label(text,x,y,z,{color='#ffffff',background='#112d43',width=8,height=1.5,subtext='',opacity=1}={}) {
    const c=document.createElement('canvas');c.width=768;c.height=subtext?200:128;const ctx=c.getContext('2d');
    ctx.fillStyle=background;ctx.beginPath();ctx.roundRect(4,4,c.width-8,c.height-8,32);ctx.fill();
    ctx.strokeStyle=color;ctx.globalAlpha=.45;ctx.lineWidth=3;ctx.stroke();ctx.globalAlpha=1;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 53px system-ui, sans-serif';ctx.fillStyle=color;ctx.fillText(text,c.width/2,subtext?66:65,710);
    if(subtext){ctx.fillStyle='#c8e0e6';ctx.font='30px system-ui, sans-serif';ctx.fillText(subtext,c.width/2,142,704)}
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,opacity,depthWrite:false}));
    sprite.position.set(x,y,z);sprite.scale.set(width,height,1);this.scene.add(sprite);this.labels.push(sprite);return sprite;
  }
  buildCity() {
    const W=this.world,spawn=W.spawn;
    const dist=(x,z)=>Math.hypot(x-spawn.x,z-spawn.z);
    // --- Streets: asphalt ribbons with beige sidewalk strips, paving for pedestrian streets and paths.
    const ribbons={asphalt:[],sidewalk:[],paving:[],path:[],line:[]};
    const ribbon=(line,width,out,y)=>{for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.05)continue;const nx=-dz/len*width/2,nz=dx/len*width/2;out.push(a[0]+nx,y,a[1]+nz,b[0]+nx,y,b[1]+nz,b[0]-nx,y,b[1]-nz,a[0]+nx,y,a[1]+nz,b[0]-nx,y,b[1]-nz,a[0]-nx,y,a[1]-nz);}};
    const dashed=(line,width,out,y)=>{for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);const n=Math.floor(len/6);for(let k=0;k<n;k++){const t0=(k*6+1)/len,t1=(k*6+4)/len;ribbon([[a[0]+dx*t0,a[1]+dz*t0],[a[0]+dx*t1,a[1]+dz*t1]],width,out,y);}}};
    for(const r of W.roads){
      if(r.drive){ribbon(r.points,r.width+4.2,ribbons.sidewalk,.06);ribbon(r.points,r.width,ribbons.asphalt,.09);if(r.width>=7)dashed(r.points,.22,ribbons.line,.105);}
      else if(r.highway==='pedestrian')ribbon(r.points,r.width,ribbons.paving,.08);
      else if(r.highway==='service')ribbon(r.points,r.width,ribbons.asphalt,.07);
      else ribbon(r.points,r.width,ribbons.path,.075);
    }
    const flat=(positions,color,opts={})=>{if(!positions.length)return;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,this.material(color,opts));mesh.receiveShadow=true;this.scene.add(mesh);};
    flat(ribbons.sidewalk,'#d3cbb6',{surface:'paving'});flat(ribbons.asphalt,'#545f66',{surface:'asphalt'});flat(ribbons.paving,'#c9bfa4',{surface:'paving'});flat(ribbons.path,'#bfb79f');flat(ribbons.line,'#e7e2cf');
    // --- Parks and plazas.
    const polyMesh=(rings,y,color,opts)=>{const shape=new THREE.Shape(rings[0].map(c=>new THREE.Vector2(c[0],-c[1])));for(const hole of rings.slice(1))shape.holes.push(new THREE.Path(hole.map(c=>new THREE.Vector2(c[0],-c[1]))));const geo=new THREE.ShapeGeometry(shape,1);geo.rotateX(-Math.PI/2);geo.translate(0,y,0);return {geo,color,opts};};
    const flats={green:[],plaza:[]};
    for(const g of W.greens)flats.green.push(polyMesh(g.rings,.03,'#7c9a6d').geo);
    for(const g of W.plazas)flats.plaza.push(polyMesh(g.rings,.04,'#c7bea5').geo);
    if(flats.green.length){const m=new THREE.Mesh(mergeGeometries(flats.green,false),this.material('#7c9a6d',{surface:'foliage'}));m.receiveShadow=true;this.scene.add(m);}
    if(flats.plaza.length){const m=new THREE.Mesh(mergeGeometries(flats.plaza,false),this.material('#c7bea5',{surface:'paving'}));m.receiveShadow=true;this.scene.add(m);}
    // --- Buildings: extruded OSM footprints merged per colour; windows instanced, nearest buildings first.
    const palette=['#d9d2c3','#c8d0d3','#dccbb0','#cfd0c4','#c9c0ad','#e0d7c6','#bfc7cf'];
    const batches=new Map();const windows=[];const byDistance=[...W.buildings].sort((a,b)=>dist((a.box.minX+a.box.maxX)/2,(a.box.minZ+a.box.maxZ)/2)-dist((b.box.minX+b.box.maxX)/2,(b.box.minZ+b.box.maxZ)/2));
    for(const b of byDistance){
      const shape=new THREE.Shape(b.rings[0].map(c=>new THREE.Vector2(c[0],-c[1])));for(const hole of b.rings.slice(1))shape.holes.push(new THREE.Path(hole.map(c=>new THREE.Vector2(c[0],-c[1]))));
      const geo=new THREE.ExtrudeGeometry(shape,{depth:b.height,bevelEnabled:false,curveSegments:1,steps:1});geo.rotateX(-Math.PI/2);geo.translate(0,.12,0);
      const color=palette[b.seed%palette.length];if(!batches.has(color))batches.set(color,[]);batches.get(color).push(geo);
      if(windows.length<30000){const ring=b.rings[0];let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];const sign=area>=0?1:-1;
        for(let i=1;i<ring.length;i++){const a=ring[i-1],c=ring[i],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);if(len<4||len>220)continue;const count=Math.floor(len/3.4),spacing=len/count;
          for(let floor=0;floor<Math.min(18,Math.floor((b.height-1)/3.2));floor++)for(let k=0;k<count;k++){const t=(k+.5)*spacing/len;windows.push({x:a[0]+dx*t+sign*dz/len*.06,y:2.0+floor*3.2,z:a[1]+dz*t-sign*dx/len*.06,angle:-Math.atan2(dz,dx),warm:(k+floor+b.seed)%11===0});}}}
    }
    for(const [color,geos] of batches){const mesh=new THREE.Mesh(mergeGeometries(geos,false),this.material(color,{surface:'stone',roughness:.86}));mesh.castShadow=true;mesh.receiveShadow=true;this.scene.add(mesh);geos.forEach(g=>g.dispose());}
    const windowGeo=new THREE.PlaneGeometry(1.35,1.65),dummy=new THREE.Object3D();
    for(const warm of [false,true]){const items=windows.filter(w=>w.warm===warm);if(!items.length)continue;const mesh=new THREE.InstancedMesh(windowGeo,this.material(warm?'#d9cd9c':'#4d6e83',{metalness:.5,roughness:.22,side:THREE.DoubleSide,...(warm?{emissive:'#d3b88a',emissiveIntensity:.18}:{})}),items.length);items.forEach((it,i)=>{dummy.position.set(it.x,it.y,it.z);dummy.rotation.set(0,it.angle,0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});this.scene.add(mesh);if(warm)this.warmWindows=mesh;}
    // --- Street furniture along the roads: trees on pedestrian and residential streets, lamps on avenues, benches on promenades.
    let trees=0,lamps=0,benches=0;
    const alongRoad=(r,step,side,offset,cb,limit)=>{let acc=0,count=0;for(let i=1;i<r.points.length&&count<limit;i++){const a=r.points[i-1],b=r.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);let t=step-acc;while(t<len&&count<limit){const x=a[0]+dx*t/len+side*(-dz/len)*offset,z=a[1]+dz*t/len+side*(dx/len)*offset;if(W.canWalk(x,z)&&W.buildingsNear(x,z,3).every(bb=>!insidePolygon(x,z,bb.rings))){cb(x,z,Math.atan2(-dx,-dz));count++;}t+=step;}acc=(acc+len)%step;}};
    for(const r of W.roads){
      if(r.highway==='pedestrian'||(r.highway==='footway'&&r.width>2)||r.highway==='residential'||r.highway==='tertiary'){
        for(const side of [-1,1]){if(trees<380&&Math.hypot(r.points[0][0]-spawn.x,r.points[0][1]-spawn.z)<900)alongRoad(r,24+hash(r.id+side)%9,side,r.width/2+(r.drive?3.1:1.4),(x,z)=>{this.tree(x,z,hash(r.id)+trees,r.highway==='residential'&&hash(r.id)%3===0?'pine':'leaf');trees++;},14);}
      }
      if(r.drive&&['secondary','tertiary','residential'].includes(r.highway)&&lamps<220&&Math.hypot(r.points[0][0]-spawn.x,r.points[0][1]-spawn.z)<800)alongRoad(r,36,1,r.width/2+2.2,(x,z)=>{this.lamp(x,z);lamps++;},12);
      if(r.highway==='pedestrian'&&benches<140)alongRoad(r,41,-1,r.width/2-1.3,(x,z,h)=>{this.bench(x,z,h);benches++;},10);
    }
    for(const g of W.greens.filter(g=>Math.hypot(g.center.x-spawn.x,g.center.z-spawn.z)<1000)){if(trees>=560)break;const ring=g.rings[0],xs=ring.map(c=>c[0]),zs=ring.map(c=>c[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),area=(maxX-minX)*(maxZ-minZ);const count=Math.min(26,Math.floor(area/700));
      for(let i=0;i<count*3&&i<200;i++){const x=minX+seeded(g.seed+i)*(maxX-minX),z=minZ+seeded(g.seed+i*7+3)*(maxZ-minZ);if(insidePolygon(x,z,g.rings)&&W.canWalk(x,z)){this.tree(x,z,g.seed+i,i%4===0?'pine':'leaf');trees++;if(trees>=560)break;}}}
    // --- Brands, landmarks, NPCs, apples, cars.
    for(const b of W.brands)this.kiosk(b);
    for(const l of W.landmarks){
      this.label(l.name,l.x,9.4,l.z-3,{width:l.id==='cathedral'?13:11,height:1.6,color:l.color,background:'#183d4d',opacity:.95});
      const ring=new THREE.Mesh(new THREE.RingGeometry(3.8,3.98,48),new THREE.MeshBasicMaterial({color:l.color,transparent:true,opacity:.38,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.set(l.x,.27,l.z);this.scene.add(ring);
    }
    for(const npc of W.npcs){const human=this.makePerson(npc.color);human.root.position.set(npc.x,0,npc.z);human.root.rotation.y=Math.PI*.2;this.scene.add(human.root);this.label('!  '+npc.name,npc.x,5.5,npc.z,{color:npc.color,width:6,height:1.15,subtext:npc.role});}
    // Pedestrians patrol real footways and pedestrian streets near the spawn.
    const walkRoads=W.roads.filter(r=>(r.highway==='pedestrian'||r.highway==='footway')&&r.points.length>=2&&dist(r.points[0][0],r.points[0][1])<700).sort((a,b)=>dist(a.points[0][0],a.points[0][1])-dist(b.points[0][0],b.points[0][1]));
    for(let i=0;i<Math.min(28,walkRoads.length);i++){const r=walkRoads[Math.floor(i*walkRoads.length/Math.min(28,walkRoads.length))];const human=this.makePerson(['#ce8c68','#608e99','#aa99ba','#607667','#9c5a4a','#3f6b8e'][i%6]);human.root.scale.setScalar(.94+seeded(i+9)*.12);this.scene.add(human.root);
      const lengths=[];let total=0;for(let k=1;k<r.points.length;k++){const l=Math.hypot(r.points[k][0]-r.points[k-1][0],r.points[k][1]-r.points[k-1][1]);lengths.push(l);total+=l;}
      this.pedestrians.push({...human,road:r,lengths,total:Math.max(1,total),progress:seeded(i+3)*total,dir:i%2?1:-1,speed:1.2+seeded(i+87)*.9,phase:seeded(i)*TAU});}
    for(const item of W.collectibles){
      const root=new THREE.Group();root.position.set(item.x,1.65,item.z);
      const fruit=this.mesh('round','#ef795b',0,0,0,.54,.55,.54,{emissive:'#973d22',emissiveIntensity:.13});root.add(fruit);
      root.add(this.mesh('box','#725137',0,.57,0,.08,.24,.08));const leaf=this.mesh('sphere','#96c967',.2,.62,0,.25,.07,.14);leaf.rotation.z=.4;root.add(leaf);
      const ring=new THREE.Mesh(new THREE.RingGeometry(.72,.81,24),new THREE.MeshBasicMaterial({color:'#ffc95b',transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=-1.37;root.add(ring);
      root.traverse(m=>{m.castShadow=false});this.scene.add(root);this.collectibles.push({id:item.id,root,baseY:1.65,phase:seeded(item.x+item.z)*TAU});
    }
    this.parkedCars=[];this.traffic=[];
    for(const c of W.cars){const car=this.makeCar(c.color);car.position.set(c.x,.15,c.z);car.rotation.y=c.heading+CAR_YAW;this.scene.add(car);this.parkedCars.push({id:c.id,group:car,x:c.x,z:c.z,heading:c.heading,model:c.model,baseY:.15,wheels:[],spin:0});}
    this.loadCarModels();
    this.canvas.dataset.city=`${W.stats.buildings} зданий · ${trees} деревьев · ${windows.length} окон · ${lamps} фонарей`;
  }
  fountain(x,z,r) {
    this.shape('cylinder','#a2b9ba',x,.4,z,r,.65,r);
    this.shape('cylinder','#57bfca',x,.76,z,r-.3,.08,r-.3,0,{metalness:.2,roughness:.25});
    this.shape('cylinder','#e0d4b0',x,1.6,z,.35,1.9,.35);
    this.shape('cylinder','#9dafaa',x,2.3,z,1.45,.3,1.45);
    this.shape('cone','#b5eef2',x,2.65,z,.33,2.5,.33,0,{transparent:true,opacity:.55});
    for(let i=0;i<8;i++)this.shape('cylinder','#b8edf1',x+Math.cos(i/8*TAU)*1.16,1.42,z+Math.sin(i/8*TAU)*1.16,.035,1.85,.035,0,{transparent:true,opacity:.45});
  }
  kiosk(b) {
    // Kiosk stands beside the brand point on the first free spot around it.
    let x=b.x-12.5,z=b.z-5;
    for(const [dx,dz] of [[-12.5,-5],[12.5,-5],[-5,12],[5,-12],[0,0]]){if(this.world.canWalk(b.x+dx,b.z+dz)&&this.world.canWalk(b.x+dx+2.6,b.z+dz+2)&&this.world.canWalk(b.x+dx-2.6,b.z+dz-2)){x=b.x+dx;z=b.z+dz;break;}}
    this.shape('box','#123547',x,1.55,z,4.8,3.1,3.7);
    this.shape('box',b.color,x,3.32,z,5.3,.3,4.3);
    this.shape('box','#8bc8cb',x,1.95,z+1.89,3.8,1.3,.1,0,{metalness:.3,roughness:.25});
    this.shape('box','#deb674',x,.8,z+2.08,4.3,.15,.8);
    this.shape('box',b.color,x-1.7,1.8,z+2.02,.15,2.4,.12,0,{emissive:b.color,emissiveIntensity:.2});
    this.label(b.name,x,5.5,z,{color:b.color,width:7.5,height:1.85,subtext:'60 СЕК · ДЕМО-КАМПАНИЯ'});
    const marker=new THREE.Mesh(new THREE.OctahedronGeometry(.8,0),this.material(b.color,{emissive:b.color,emissiveIntensity:.35}));marker.position.set(b.x,4.2,b.z);this.scene.add(marker);
    if(!this.brandMarkers)this.brandMarkers=[];this.brandMarkers.push(marker);
    const ring=new THREE.Mesh(new THREE.RingGeometry(2.1,2.45,48),new THREE.MeshBasicMaterial({color:b.color,side:THREE.DoubleSide,transparent:true,opacity:.65,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.set(b.x,.28,b.z);this.scene.add(ring);
  }
  makePerson(jacket='#223e53',hero=false) {
    const root=new THREE.Group(),body=new THREE.Group();root.add(body);
    const skin=this.material('#c89572'),dark=this.material('#142c3e'),cloth=this.material(jacket),trousers=this.material('#304655'),shoe=this.material('#142330');
    const part=(geometry,material,x,y,z,sx,sy,sz,parent=body)=>{const m=new THREE.Mesh(this.geometry(geometry),material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=hero;parent.add(m);return m};
    const torso=part('box',cloth,0,1.68,0,.72,.92,.42);part('round',skin,0,2.47,-.025,.29,.35,.28);part('box',dark,0,2.71,.03,.54,.22,.5);
    part('box',skin,0,2.12,0,.22,.22,.22);
    if(hero) {
      part('box',this.material('#f6cb36'),-.25,1.73,-.23,.085,.62,.055);
      part('box',this.material('#d6ad31'),.25,1.73,-.23,.055,.62,.055);
      part('box',dark,0,1.7,.36,.56,.65,.25);
      part('box',this.material('#ffc92f'),0,1.73,.50,.17,.24,.03);
      part('box',this.material('#98b2bd'),.3,2.48,-.03,.025,.075,.3);
    }
    const limbs=[];
    for(const side of [-1,1]) {
      const arm=new THREE.Group();arm.position.set(side*.49,2.01,0);body.add(arm);
      part('box',cloth,0,-.32,0,.24,.68,.27,arm);part('round',skin,0,-.76,-.015,.13,.15,.13,arm);
      const leg=new THREE.Group();leg.position.set(side*.21,1.24,0);body.add(leg);
      part('box',trousers,0,-.44,0,.28,.85,.31,leg);part('box',shoe,0,-.94,-.09,.31,.2,.49,leg);
      limbs.push({arm,leg,side});
    }
    if(!hero){const shadow=new THREE.Mesh(new THREE.CircleGeometry(.62,12),new THREE.MeshBasicMaterial({color:'#162e39',transparent:true,opacity:.12,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.10;root.add(shadow);}
    return {root,body,limbs,torso,jacket:cloth};
  }
  animatePerson(person,phase,moving,sprint=false) {
    for(const{arm,leg,side}of person.limbs) {leg.rotation.x=Math.sin(phase)*side*(moving?(sprint?.82:.61):.015);arm.rotation.x=-Math.sin(phase)*side*(moving?(sprint?.88:.58):.025);arm.rotation.z=side*.08;}
    person.body.position.y=moving?Math.abs(Math.sin(phase))*.085:Math.sin(phase*.18)*.016;
    person.body.rotation.x=moving?(sprint?-.12:-.035):0;
  }
  makeScooter() {
    const group=new THREE.Group();
    const add=(type,color,x,y,z,sx,sy,sz,opts={})=>{const m=this.mesh(type,color,x,y,z,sx,sy,sz,opts);group.add(m);return m};
    add('box','#203f52',0,.38,.12,.78,.16,2.45,{metalness:.45,roughness:.35});
    add('box','#f1c737',0,.475,.12,.53,.03,1.85);
    add('box','#173349',0,1.24,-1.01,.13,1.93,.14,{metalness:.6,roughness:.3});
    add('box','#4bc9cb',0,1.75,-1.00,.15,.64,.15,{emissive:'#4bc9cb',emissiveIntensity:.1});
    add('box','#173349',0,2.23,-.89,1.32,.13,.14,{metalness:.4,roughness:.4});
    add('box','#ffd23c',-.51,2.23,-.89,.30,.16,.16);add('box','#ffd23c',.51,2.23,-.89,.30,.16,.16);
    add('box','#d7f7f4',0,2.07,-1.10,.15,.15,.06,{emissive:'#d7f7f4',emissiveIntensity:.7});
    for(const z of [-1.1,1.22]) {
      const wheel=add('cylinder','#1c303e',0,.3,z,.3,.15,.3);wheel.rotation.z=Math.PI/2;
      const hub=add('cylinder','#c1d0d0',0,.3,z,.15,.17,.15,{metalness:.6,roughness:.3});hub.rotation.z=Math.PI/2;
    }
    return group;
  }
  makeCar(color) {
    const group=new THREE.Group();
    const add=(type,c,x,y,z,sx,sy,sz,opts={})=>{const m=this.mesh(type,c,x,y,z,sx,sy,sz,opts);m.castShadow=type==='box'&&sy>.6&&sx>1.5;group.add(m);return m};
    add('box',color,0,.78,0,2.2,.73,4.1,{metalness:.4,roughness:.3});add('box',color,0,1.38,-.08,1.88,.6,2.12,{metalness:.4,roughness:.3});
    add('box','#66a9b7',0,1.46,-1.15,1.74,.47,.06,{metalness:.45,roughness:.25});add('box','#4d8d9f',0,1.46,1.0,1.74,.47,.06,{metalness:.45,roughness:.25});
    add('box','#385a6f',-1.0,1.47,-.08,.04,.43,1.78);add('box','#385a6f',1.0,1.47,-.08,.04,.43,1.78);
    add('box','#f8cc45',0,1.157,-1.61,.32,.025,.87);add('box','#e9e7cc',-.74,.9,-2.075,.45,.18,.035,{emissive:'#ffe6ab',emissiveIntensity:.3});add('box','#e9e7cc',.74,.9,-2.075,.45,.18,.035,{emissive:'#ffe6ab',emissiveIntensity:.3});
    add('box','#e88367',-.74,.86,2.075,.43,.15,.035);add('box','#e88367',.74,.86,2.075,.43,.15,.035);
    for(const side of [-1,1])for(const z of [-1.25,1.25]){const wheel=add('cylinder','#20313b',side*1.1,.44,z,.44,.22,.44);wheel.rotation.z=Math.PI/2;}
    return group;
  }
  async loadCarModels() {
    const names=['sedan','sedan-sports','hatchback-sports','suv','suv-luxury','taxi','van','delivery'],loader=new GLTFLoader();
    const models=await Promise.all(names.map(n=>loader.loadAsync(new URL(`./assets/models/kenney-cars/${n}.glb`,import.meta.url).href).then(g=>g.scene).catch(error=>{console.warn('Car model unavailable, procedural car stays:',n,error?.message);return null})));
    if(this.disposed)return;
    const ready=models.filter(Boolean);if(!ready.length)return;
    for(const spot of this.parkedCars||[]) {
      const model=ready[spot.model%ready.length].clone(true);
      const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),s=4.3/Math.max(size.x,size.z,.01);
      model.scale.setScalar(s);model.position.set(spot.x,.16-box.min.y*s,spot.z);model.rotation.y=spot.heading+CAR_YAW;spot.baseY=.16-box.min.y*s;
      spot.wheels=[];model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material.envMapIntensity=.9;}}if(/wheel/i.test(o.name))spot.wheels.push(o);});
      this.scene.add(model);if(spot.group)this.scene.remove(spot.group);spot.group=model;
    }
    this.carModels=ready;this.canvas.dataset.carModels=String(ready.length);
    this.spawnTraffic(ready);
  }
  spawnTraffic(models) {
    // AI traffic drives the real street graph: right-hand lane, random turns at nodes, simple signals at avenue crossings,
    // yields to cars ahead and to the player. Cosmetic: no collisions with the player.
    const W=this.world,{nodes,edges}=W.graph;if(!edges.length||this.traffic.length)return;
    const pool=edges.filter(e=>['secondary','tertiary','residential'].includes(e.road.highway)&&Math.hypot(nodes[e.a].x-W.spawn.x,nodes[e.a].z-W.spawn.z)<900);
    for(let i=0;i<22&&pool.length;i++){
      const e=pool[hash('traffic'+i)%pool.length];
      const model=models[(i*5+3)%models.length].clone(true);
      const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),s=4.1/Math.max(size.x,size.z,.01);
      model.scale.setScalar(s);model.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
      const wheels=[];model.traverse(o=>{if(/wheel/i.test(o.name))wheels.push(o);});this.scene.add(model);
      this.traffic.push({group:model,edge:e,t:(hash('t'+i)%100)/100,dir:e.oneway?1:(i%2?1:-1),speed:0,cruise:e.speed*(0.8+seeded(i)*0.4),baseY:.16-box.min.y*s,wheels,spin:0,id:i});
    }
  }
  updateTraffic(dt,time) {
    const W=this.world,{nodes,edges}=W.graph;
    for(const car of this.traffic){
      const e=car.edge,from=car.dir>0?nodes[e.a]:nodes[e.b],to=car.dir>0?nodes[e.b]:nodes[e.a];
      const dx=to.x-from.x,dz=to.z-from.z,len=Math.max(.01,e.len);
      const remaining=(1-car.t)*len;
      // Signal: avenue crossings alternate axes every 6 s; cars hold within 7 m of a red node.
      let hold=false;
      if(to.signal&&remaining<7){const axis=Math.abs(dx)>Math.abs(dz)?0:1;if(((Math.floor(time/6)+to.id)%2)!==axis)hold=true;}
      const px=from.x+dx*car.t,pz=from.z+dz*car.t;
      // Yield to the car ahead in the same lane direction, and to the player.
      const fx=dx/len,fz=dz/len;
      for(const other of this.traffic){if(other===car)continue;const ox=other.group.position.x-px,oz=other.group.position.z-pz;const ahead=ox*fx+oz*fz;if(ahead>0&&ahead<9&&Math.abs(-ox*fz+oz*fx)<3){hold=true;break;}}
      const plx=this.position.x-px,plz=this.position.z-pz;const pa=plx*fx+plz*fz;if(pa>0&&pa<8&&Math.abs(-plx*fz+plz*fx)<3.5)hold=true;
      car.speed=hold?Math.max(0,car.speed-18*dt):Math.min(car.cruise,car.speed+6*dt);
      car.t+=car.speed*dt/len;
      if(car.t>=1){
        // Choose the next edge at the node: prefer continuing straight, never immediately U-turn unless dead end.
        const candidates=to.edges.map(id=>edges[id]).filter(n=>n!==e||to.edges.length===1).filter(n=>!n.oneway||n.a===to.id).filter(n=>['secondary','tertiary','residential','living_street','unclassified','primary'].includes(n.road.highway));
        if(!candidates.length){car.dir*=-1;car.t=0;continue;}
        const pick=candidates.map(n=>{const nf=n.a===to.id?nodes[n.b]:nodes[n.a];const ang=Math.atan2(nf.z-to.z,nf.x-to.x)-Math.atan2(dz,dx);const dev=Math.abs(Math.atan2(Math.sin(ang),Math.cos(ang)));return {n,score:dev+((hash(car.id+':'+to.id+':'+Math.floor(time))%5)/5)};}).sort((a,b)=>a.score-b.score)[0].n;
        car.edge=pick;car.dir=pick.a===to.id?1:-1;car.t=0;continue;
      }
      const right=[-fz,fx],offset=e.road.width*.25+.3;
      car.group.position.set(from.x+dx*car.t+right[0]*offset,car.baseY,from.z+dz*car.t+right[1]*offset);
      car.group.rotation.y=Math.atan2(-fx,-fz)+CAR_YAW;
      car.spin+=car.speed*dt/.45;for(const w of car.wheels)w.rotation.x=car.spin;
    }
  }
  setupPostFX() {
    // Bloom + SSAO through EffectComposer. In three r180 SSAOPass post-processes the RenderPass result (it no longer renders the
    // scene itself), so RenderPass stays enabled in every mode.
    this.composer=new EffectComposer(this.renderer);this.composer.setPixelRatio(this.pixelRatio);
    this.renderPass=new RenderPass(this.scene,this.camera);this.composer.addPass(this.renderPass);
    this.ssaoPass=new SSAOPass(this.scene,this.camera,1,1);this.ssaoPass.kernelRadius=3;this.ssaoPass.minDistance=.0002;this.ssaoPass.maxDistance=.02;this.composer.addPass(this.ssaoPass);
    this.bloomPass=new UnrealBloomPass(new THREE.Vector2(1,1),.18,.55,.86);this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());this.renderer.info.autoReset=false;this.updatePostFX();
  }
  updatePostFX() {
    if(!this.composer)return;
    const coarse=window.matchMedia?.('(pointer:coarse)').matches;
    const ssao=this.postfx==='high'||(this.postfx==='auto'&&!coarse&&!this.ssaoTooSlow);
    this.ssaoPass.enabled=ssao;this.renderPass.enabled=true;this.bloomPass.enabled=this.postfx!=='off';
    this.canvas.dataset.postfx=this.postfx+(ssao?' +ssao':'')+(this.bloomPass.enabled?' +bloom':'');
  }
  setPostFX(mode='auto') {
    if(!['auto','high','off'].includes(mode))return false;
    this.postfx=mode;this.ssaoTooSlow=false;this.frameSamples=[];this.updatePostFX();return true;
  }
  applyPixelRatio(value) {
    this.pixelRatio=value;this.renderer.setPixelRatio(value);this.composer?.setPixelRatio(value);this.resize();
  }
  setRemotePlayers(list) {
    // Other online players: simple avatars with name labels, positions eased between 2 s presence updates.
    if(!this.remotePlayers)this.remotePlayers=new Map();
    const now=performance.now(),seen=new Set();
    for(const p of list||[]){
      seen.add(p.id);let r=this.remotePlayers.get(p.id);
      if(!r){const human=this.makePerson(['#d97d4e','#4e8fd9','#8f5ad9','#3fa86a','#d94e7d'][hash(p.id)%5]);human.root.position.set(p.x,0,p.z);this.scene.add(human.root);
        const label=this.label(p.name||'Игрок',p.x,3.6,p.z,{color:'#ffe08a',width:5.5,height:1.05,background:'#183d4d',opacity:.95});
        r={human,label,target:{x:p.x,z:p.z},heading:p.heading||0,moving:false,phase:hash(p.id)%100/10,updated:now};this.remotePlayers.set(p.id,r);}
      r.moving=Math.hypot(r.target.x-p.x,r.target.z-p.z)>.3;r.target={x:p.x,z:p.z};r.heading=p.heading||0;r.updated=now;
    }
    for(const [id,r] of this.remotePlayers){if(!seen.has(id)&&now-r.updated>8000){this.scene.remove(r.human.root);this.scene.remove(r.label);r.label.material.map?.dispose();r.label.material.dispose();this.remotePlayers.delete(id);}}
  }
  setHero(hero) {
    if(!hero?.root?.isObject3D)return false;
    if(this.hero){this.scene.remove(this.hero.root);this.hero.dispose?.();}
    this.hero=hero;this.scene.add(hero.root);this.player.root.visible=false;hero.setSkin?.(this.skinColor||'#142939');return true;
  }
  setAtmosphere(mode) {return this.atmosphereController?.set(mode)||false}
  setBackdrop(url) {
    return new Promise(resolve=>new THREE.TextureLoader().load(url,texture=>{
      texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
      if(this.backdrop){this.backdrop.material.map?.dispose();this.backdrop.geometry.dispose();this.backdrop.material.dispose();this.scene.remove(this.backdrop);}
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1320,495),new THREE.MeshBasicMaterial({map:texture,fog:false,depthWrite:false,toneMapped:false}));
      const wb=this.world.bounds;mesh.position.set((wb.minX+wb.maxX)/2,190,wb.maxZ+760);mesh.rotation.y=Math.PI;mesh.renderOrder=-5;this.scene.add(mesh);this.backdrop=mesh;for(const mountain of this.mountains||[])if(mountain.userData.distant)mountain.visible=false;resolve(true);
    },undefined,()=>{console.warn('Mountain panorama unavailable; procedural mountain fallback remains active.');resolve(false)}));
  }
  setupInput() {
    this.keyDown=(e)=>{
      if(isField(e)||this.paused)return;
      const key=e.code;
      if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyE'].includes(key))e.preventDefault();
      if(key==='KeyE'&&!e.repeat){this.onInteract();return;}
      if(key==='Space'&&!e.repeat&&this.jump===0&&!this.state.player?.vehicle&&!this.state.player?.driving)this.jumpVelocity=7.5;
      this.keys.add(key);
    };
    this.keyUp=(e)=>{this.keys.delete(e.code)};
    this.blur=()=>{this.drag=null;this.keys.clear();this.touch={x:0,z:0,sprint:false};this.emitInput(performance.now(),true)};
    window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);window.addEventListener('blur',this.blur);
    this.visibility=()=>{if(document.hidden)this.blur()};document.addEventListener('visibilitychange',this.visibility);
    this.pointerDown=e=>{if(this.paused||e.button>0||(e.pointerType==='touch'&&e.clientX<this.canvas.clientWidth*.45))return;this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};this.canvas.setPointerCapture(e.pointerId);};
    this.pointerMove=e=>{if(!this.drag||e.pointerId!==this.drag.id)return;this.lastDragTime=performance.now();this.orbit.yaw-=(e.clientX-this.drag.x)*.0045;this.orbit.pitch=clamp(this.orbit.pitch+(e.clientY-this.drag.y)*.003,-.06,.68);this.drag.x=e.clientX;this.drag.y=e.clientY;};
    this.pointerUp=e=>{if(this.drag?.id===e.pointerId)this.drag=null;};
    this.wheel=e=>{if(this.paused)return;e.preventDefault();this.orbit.distance=clamp(this.orbit.distance+e.deltaY*.008,6,18);};
    this.canvas.addEventListener('pointerdown',this.pointerDown);this.canvas.addEventListener('pointermove',this.pointerMove);this.canvas.addEventListener('pointerup',this.pointerUp);this.canvas.addEventListener('pointercancel',this.pointerUp);this.canvas.addEventListener('wheel',this.wheel,{passive:false});
  }
  input() {
    if(this.paused)return{x:0,z:0,sprint:false};
    let x=(this.keys.has('KeyD')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('KeyA')||this.keys.has('ArrowLeft')?1:0)+Number(this.touch.x||0);
    let z=(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0)-(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)+Number(this.touch.z||0);
    const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}
    const cos=Math.cos(this.orbit.yaw),sin=Math.sin(this.orbit.yaw),cameraX=x*cos+z*sin,cameraZ=-x*sin+z*cos;
    return{x:cameraX,z:cameraZ,sprint:!!(this.touch.sprint||this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'))};
  }
  emitInput(time,force=false) {
    if(force||time-this.lastInput>=100){this.lastInput=time;this.onInput(this.input())}
  }
  setInput(input={}) {this.touch={x:clamp(Number(input.x)||0,-1,1),z:clamp(Number(input.z)||0,-1,1),sprint:!!input.sprint}}
  setPaused(value) {this.paused=!!value;if(value){this.drag=null;this.keys.clear();this.touch={x:0,z:0,sprint:false};this.onInput({x:0,z:0,sprint:false})}}
  getPosition() {return{...this.position}}
  updateState(state) {
    if(!state)return;
    const oldAttempt=this.state?.activeAttempt;this.state=state;
    const pos=state.player?.position;
    if(pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.z)) {
      this.serverPosition={x:pos.x,z:pos.z};
      if(!this.hasState||Math.hypot(this.position.x-pos.x,this.position.z-pos.z)>14)this.position={...this.serverPosition};
      this.hasState=true;
    }
    if(this.error)return;
    const collected=new Set(state.player?.collected||[]);
    for(const item of this.collectibles)item.root.visible=!collected.has(item.id);
    for(const car of state.cars||[]){
      if(state.player?.driving===car.id&&this.carState&&this.carState.id===car.id&&Math.abs(this.carState.speed-car.speed)>14)this.carState.speed=car.speed;
      const spot=this.parkedCars?.find(s=>s.id===car.id);if(!spot||state.player?.driving===car.id)continue;
      spot.x=car.x;spot.z=car.z;spot.heading=car.heading;spot.group.position.set(car.x,spot.baseY,car.z);spot.group.rotation.y=car.heading+CAR_YAW;
    }
    if(this.player) {
      const skin=state.player?.skin||state.player?.equippedSkin;
      const color=skin==='yellow'||skin==='sun'||skin==='gold'?'#e5bd39':skin==='cyan'||skin==='mint'?'#39a5a7':'#142939';
      if(this.skinColor!==color){this.player.torso.material=this.material(color);this.hero?.setSkin?.(color);this.skinColor=color;}
    }
    const attempt=state.activeAttempt;
    const targetKey=JSON.stringify(attempt?{id:attempt.id,type:attempt.type,targets:attempt.targets,index:attempt.targetIndex,current:attempt.currentTarget,status:attempt.status}:null);
    if(targetKey!==this.targetKey){this.targetKey=targetKey;this.buildTargets(attempt)}
  }
  clearGroup(group) {
    while(group?.children.length){const child=group.children[0];group.remove(child);child.traverse(o=>{if(o.userData.ownedGeometry)o.geometry?.dispose();if(o.userData.ownedMaterial){o.material?.map?.dispose();o.material?.dispose()}})}
  }
  buildTargets(attempt) {
    this.clearGroup(this.targetGroup);this.targetMarkers=[];
    if(!attempt||['WON','LOST','FAILED','EXPIRED','CANCELLED','won','lost','failed','expired','cancelled'].includes(attempt.status))return;
    const targets=attempt.targets||[];
    const type=attempt.type||attempt.mission?.type||this.state.missions?.find?.(m=>m.id===attempt.missionId)?.type;
    const nextIndex=targets.findIndex(t=>!(t.done||t.completed||t.collected||t.reached));
    targets.forEach((t,i)=>{
      if(t.done||t.completed||t.collected||t.reached)return;
      if(!Number.isFinite(t.x)||!Number.isFinite(t.z))return;
      const root=new THREE.Group();root.position.set(t.x,.28,t.z);
      const next=type==='collect'||i===nextIndex;
      const color=type==='collect'?'#47e8dc':next?'#ffda43':'#88a6ad';
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1.7,.12,7,36),this.material(color,{emissive:color,emissiveIntensity:.25}));ring.rotation.x=-Math.PI/2;root.add(ring);ring.userData.ownedGeometry=true;
      const beam=new THREE.Mesh(new THREE.CylinderGeometry(.1,1.7,6,24,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:next?.095:.022,depthWrite:false,side:THREE.DoubleSide}));beam.position.y=3;beam.userData.ownedGeometry=true;beam.userData.ownedMaterial=true;root.add(beam);
      if(type==='collect') {
        const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.75),this.material(color,{emissive:color,emissiveIntensity:.4}));crystal.position.y=1.65;crystal.userData.ownedGeometry=true;root.add(crystal);
      } else if(type==='delivery'&&i===0) {
        const packageBox=this.mesh('box','#d7ac65',0,1.3,0,1.2,1.2,1.2);root.add(packageBox);root.add(this.mesh('box','#ffe09a',0,1.31,0,.22,1.22,1.22));
      }
      const label=this.numberSprite(i+1,color);label.position.y=4.1;label.material.opacity=next?1:.55;root.add(label);
      this.targetGroup.add(root);this.targetMarkers.push({root,ring,label});
    });
  }
  numberSprite(number,color) {
    const c=document.createElement('canvas');c.width=128;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#102e42';ctx.beginPath();ctx.arc(64,64,55,0,TAU);ctx.fill();ctx.lineWidth=5;ctx.strokeStyle=color;ctx.stroke();ctx.fillStyle=color;ctx.font='bold 68px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(number),64,67);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false}));sprite.scale.set(2.25,2.25,1);sprite.userData.ownedMaterial=true;return sprite;
  }
  setWaypoint(waypoint) {
    if(this.error)return;
    this.waypoint=waypoint;this.clearGroup(this.waypointGroup);
    if(!waypoint||!Number.isFinite(waypoint.x)||!Number.isFinite(waypoint.z))return;
    this.waypointGroup.position.set(waypoint.x,.35,waypoint.z);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(3,.15,8,48),this.material('#4be8dc',{emissive:'#4be8dc',emissiveIntensity:.35}));ring.rotation.x=-Math.PI/2;ring.userData.ownedGeometry=true;this.waypointGroup.add(ring);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(1,2,4),this.material('#4be8dc',{emissive:'#4be8dc',emissiveIntensity:.25}));cone.rotation.z=Math.PI;cone.position.y=7;cone.userData.ownedGeometry=true;this.waypointGroup.add(cone);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,25,16,1,true),new THREE.MeshBasicMaterial({color:'#4be8dc',opacity:.16,transparent:true,depthWrite:false,side:THREE.DoubleSide}));beam.position.y=12.5;beam.userData.ownedGeometry=true;beam.userData.ownedMaterial=true;this.waypointGroup.add(beam);
  }
  resize() {
    if(!this.renderer)return;
    const rect=this.canvas.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.composer?.setSize(width,height);
  }
  setQuality(quality='auto') {
    if(!['auto','high','low'].includes(quality)||!this.renderer)return;
    this.quality=quality;this.frameSamples=[];
    this.applyPixelRatio(quality==='low'?Math.min(1,this.maxPixelRatio):this.maxPixelRatio);
    const shadowSize=quality==='low'?1024:2048;if(this.sun.shadow.mapSize.x!==shadowSize){this.sun.shadow.mapSize.set(shadowSize,shadowSize);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;}
  }
  getMetrics() {return{...this.metrics,quality:this.quality,pixelRatio:this.pixelRatio}}
  samplePerformance(time,frameMs) {
    if(document.hidden||frameMs<=0||frameMs>250){this.frameSamples=[];return;}
    this.frameSamples.push(frameMs);if(this.frameSamples.length>120)this.frameSamples.shift();
    if(time-this.lastQualityCheck<12000||this.frameSamples.length<90)return;
    this.lastQualityCheck=time;
    const average=this.frameSamples.reduce((a,b)=>a+b,0)/this.frameSamples.length;
    const calls=this.renderer.info.render.calls,triangles=this.renderer.info.render.triangles;
    this.metrics={sampledFps:Math.round(1000/average),drawCalls:calls,triangles};
    this.canvas.dataset.renderFps=String(this.metrics.sampledFps);this.canvas.dataset.drawCalls=String(calls);
    // Adjust resolution from sustained measurements, never from a device-name guess.
    if(average>26&&this.postfx==='auto'&&this.ssaoPass?.enabled){this.ssaoTooSlow=true;this.updatePostFX();this.frameSamples=[];return;}
    if(this.quality==='auto') {
      const next=average>28?Math.max(.85,this.pixelRatio*.8):average<18?Math.min(this.maxPixelRatio,this.pixelRatio+.15):this.pixelRatio;
      if(Math.abs(next-this.pixelRatio)>.05)this.applyPixelRatio(next);
    }
    this.canvas.dataset.renderQuality=this.quality+' @ '+this.pixelRatio.toFixed(2);
  }
  renderFrame(time) {
    if(document.body.classList.contains('geo-active')){this.lastTime=time;return;}
    const frameMs=time-(this.lastTime||time);
    const dt=Math.min(frameMs/1000,.045);this.lastTime=time;const t=time/1000;
    this.emitInput(time);
    const input=this.input(),moving=Math.hypot(input.x,input.z)>.02;
    const drivingId=this.state.player?.driving||null,driving=!!drivingId,vehicle=!driving&&!!this.state.player?.vehicle;
    let speed=vehicle?SPEEDS.scooter:input.sprint?SPEEDS.sprint:SPEEDS.walk;
    if(driving){
      // Same arcade model as the rules: the client predicts, the server position reconciles below.
      if(!this.carState||this.carState.id!==drivingId){const sc=(this.state.cars||[]).find(c=>c.id===drivingId)||{};this.carState={id:drivingId,x:this.position.x,z:this.position.z,heading:sc.heading??this.heading,speed:sc.speed||0};}
      simulateCar(this.carState,input,dt,canWalk);
      this.position.x=this.carState.x;this.position.z=this.carState.z;this.heading=this.carState.heading;speed=Math.abs(this.carState.speed);
    } else {
      this.carState=null;
      if(moving) {
        const nx=this.position.x+input.x*speed*dt,nz=this.position.z+input.z*speed*dt;
        if(canWalk(nx,this.position.z))this.position.x=nx;
        if(canWalk(this.position.x,nz))this.position.z=nz;
        this.heading=angleLerp(this.heading,Math.atan2(-input.x,-input.z),1-Math.exp(-12*dt));
      }
    }
    const drivenCar=driving?this.parkedCars?.find(s=>s.id===drivingId):null;
    if(drivenCar){
      drivenCar.group.position.set(this.position.x,drivenCar.baseY,this.position.z);drivenCar.group.rotation.y=this.heading+CAR_YAW;
      drivenCar.spin+=speed*dt/.45*Math.sign(this.carState?.speed||1);for(const w of drivenCar.wheels)w.rotation.x=drivenCar.spin;
      if(!this.drag&&performance.now()-this.lastDragTime>2500)this.orbit.yaw=angleLerp(this.orbit.yaw,this.heading,1-Math.exp(-2.2*dt));
    }
    if(this.hasState) {
      const error=Math.hypot(this.position.x-this.serverPosition.x,this.position.z-this.serverPosition.z);
      // Reconcile modest prediction drift without making movement dependent on round-trip time.
      const factor=1-Math.exp(-(moving?1.8:12)*dt);
      if(error>(moving||driving?1.8:.015)){this.position.x=mix(this.position.x,this.serverPosition.x,factor);this.position.z=mix(this.position.z,this.serverPosition.z,factor);if(this.carState){this.carState.x=this.position.x;this.carState.z=this.position.z;}}
    }
    this.walkTime+=dt*(moving?(input.sprint?17:12):2);
    if(this.jumpVelocity||this.jump){this.jump=Math.max(0,this.jump+this.jumpVelocity*dt);this.jumpVelocity-=21*dt;if(this.jump===0)this.jumpVelocity=0;}
    this.player.root.visible=!this.hero&&!driving;this.scooter.visible=vehicle;if(this.hero)this.hero.root.visible=!driving;
    if(this.hero){
      this.hero.root.position.set(this.position.x,.19+(vehicle?.45:0)+this.jump,this.position.z);this.hero.root.rotation.y=this.heading;
      this.hero.update?.({dt,time:t,moving:moving&&!vehicle,sprint:input.sprint,vehicle,jump:this.jump});
    }else{
      this.player.root.position.set(this.position.x,(vehicle?.38:-.05)+this.jump,this.position.z);this.player.root.rotation.y=this.heading;
      this.animatePerson(this.player,this.walkTime,moving&&!vehicle,input.sprint);
      for(const limb of this.player.limbs){limb.leg.position.x=limb.side*(vehicle?.13:.21);if(vehicle){limb.arm.rotation.x=.95;limb.arm.rotation.z=limb.side*.02;limb.leg.rotation.x=limb.side*.12;}}
      if(vehicle){this.player.body.rotation.x=-.025;this.player.body.position.y=0;}
    }
    this.scooter.position.set(this.position.x,.18,this.position.z);this.scooter.rotation.y=this.heading;
    this.playerShadow.position.set(this.position.x,.275,this.position.z);this.playerShadow.scale.setScalar(driving?2.2:vehicle?1.1:1-this.jump*.08);

    for(const ped of this.pedestrians) {
      ped.progress+=ped.dir*ped.speed*dt;if(ped.progress>=ped.total){ped.progress=ped.total;ped.dir=-1;}else if(ped.progress<=0){ped.progress=0;ped.dir=1;}
      let acc=0,seg=0;while(seg<ped.lengths.length-1&&acc+ped.lengths[seg]<ped.progress){acc+=ped.lengths[seg];seg++;}
      const a=ped.road.points[seg],b=ped.road.points[seg+1],u=Math.min(1,(ped.progress-acc)/Math.max(.01,ped.lengths[seg]));
      ped.root.position.set(a[0]+(b[0]-a[0])*u,0,a[1]+(b[1]-a[1])*u);ped.root.rotation.y=Math.atan2(-(b[0]-a[0])*ped.dir,-(b[1]-a[1])*ped.dir);this.animatePerson(ped,t*5.5+ped.phase,true);
    }
    this.updateTraffic(dt,t);
    for(const r of this.remotePlayers?.values()||[]){const pos=r.human.root.position,k=1-Math.exp(-4*dt);pos.x=mix(pos.x,r.target.x,k);pos.z=mix(pos.z,r.target.z,k);r.human.root.rotation.y=angleLerp(r.human.root.rotation.y,r.heading,k);r.label.position.set(pos.x,3.6,pos.z);this.animatePerson(r.human,t*5.5+r.phase,r.moving);}
    for(const item of this.collectibles)if(item.root.visible){item.root.position.y=item.baseY+Math.sin(t*2+item.phase)*.16;item.root.rotation.y=t*.8+item.phase;}
    for(const m of this.brandMarkers||[]){m.rotation.y=t*.7;m.position.y=4.2+Math.sin(t*1.8)*.18;const near=this.camera.position.distanceTo(m.position);m.scale.setScalar(clamp((near-3)/6,.1,1));}
    for(const m of this.targetMarkers||[]){m.ring.scale.setScalar(1+Math.sin(t*3)*.05);m.label.position.y=4.1+Math.sin(t*2)*.2;}
    if(this.waypoint){this.waypointGroup.children[0].scale.setScalar(1+Math.sin(t*2)*.04);this.waypointGroup.children[1].rotation.y=t*.8;}
    const cameraEase=1-Math.exp(-9*dt),portrait=this.camera.aspect<.85;
    const {yaw,pitch}=this.orbit,distance=this.orbit.distance*(portrait?1.1:1)*(driving?1.45:1),horizontal=Math.cos(pitch)*distance;
    this.cameraTarget.set(this.position.x,(driving?2.3:1.8)+this.jump*.25,this.position.z);
    const desired=new THREE.Vector3(this.position.x+Math.sin(yaw)*horizontal+Math.cos(yaw)*.65,1.8+Math.sin(pitch)*distance,this.position.z+Math.cos(yaw)*horizontal-Math.sin(yaw)*.65);
    const direction=desired.clone().sub(this.cameraTarget).normalize();this.cameraRay.set(this.cameraTarget,direction);
    let maxDistance=desired.distanceTo(this.cameraTarget);
    for(const box of this.cameraBoxes){const hit=this.cameraRay.intersectBox(box,this.cameraHit);if(hit)maxDistance=Math.min(maxDistance,Math.max(2.1,hit.distanceTo(this.cameraTarget)-.45));}
    desired.copy(this.cameraTarget).addScaledVector(direction,maxDistance);
    this.camera.position.lerp(desired,cameraEase);this.camera.lookAt(this.cameraTarget);
    this.atmosphereController?.update(dt,t,this.position);
    if(time-this.lastView>180){this.lastView=time;this.onView({position:{...this.position},heading:this.heading,moving,speed:driving?speed:moving?speed:0,vehicle,driving,damage:(this.state.cars||[]).find(c=>c.id===drivingId)?.damage||0});}
    this.renderer.info.reset();
    if(this.composer&&this.postfx!=='off')this.composer.render(dt);else this.renderer.render(this.scene,this.camera);
    this.samplePerformance(time,frameMs);
  }
  dispose() {
    this.disposed=true;this.composer?.dispose?.();this.hero?.dispose?.();this.atmosphereController?.dispose();this.surfaces?.dispose();this.reflectionMap?.dispose();cancelAnimationFrame(this.raf);this.resizeObserver?.disconnect();
    window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('blur',this.blur);document.removeEventListener('visibilitychange',this.visibility);
    this.canvas.removeEventListener('pointerdown',this.pointerDown);this.canvas.removeEventListener('pointermove',this.pointerMove);this.canvas.removeEventListener('pointerup',this.pointerUp);this.canvas.removeEventListener('pointercancel',this.pointerUp);this.canvas.removeEventListener('wheel',this.wheel);
    this.scene?.traverse(o=>{if(o.geometry&&!o.isInstancedMesh)o.geometry.dispose();if(o.material?.map)o.material.map.dispose()});for(const m of this.materials.values())m.dispose();for(const g of this.geometries.values())g.dispose();this.renderer?.dispose();
  }
}
