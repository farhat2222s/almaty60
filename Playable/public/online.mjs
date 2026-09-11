// Online presence: the browser game talks to StagingBackend (accounts + /api/presence) and shows nearby players.
// The backend URL comes from backend-config.json or the player's own setting; nothing works until a server is deployed.
const KEY_URL='al60-backend-url',KEY_TOKEN='al60-online-token',KEY_NAME='al60-online-name';
const read=k=>{try{return localStorage.getItem(k)||''}catch{return ''}};
const write=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch{}};

export function createOnline({getPosition,onPlayers=()=>{},onStatus=()=>{}}={}){
  let config={url:''},token=read(KEY_TOKEN),name=read(KEY_NAME),timer=null,status={state:'off',online:0,error:''},failures=0;
  const url=()=>(read(KEY_URL)||config.url||'').replace(/\/$/,'');
  const set=(patch)=>{status={...status,...patch};onStatus(status);};
  async function call(path,body,{auth=true}={}){
    const base=url();if(!base)throw new Error('Адрес сервера не задан');
    const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth&&token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    let data={};try{data=await res.json()}catch{}
    if(res.status===401&&auth){token='';write(KEY_TOKEN,'');stop();set({state:'off',error:'Сессия истекла, войди снова'});}
    if(!res.ok)throw new Error(data.message||data.error||`HTTP ${res.status}`);
    return data;
  }
  async function loadConfig(){try{const r=await fetch('backend-config.json');if(r.ok)config=await r.json()}catch{}return {url:url(),configured:!!url(),token:!!token,name};}
  async function register(email,password,displayName){const d=await call('/api/auth/register',{email,password,name:displayName},{auth:false});token=d.token;name=d.user?.name||displayName;write(KEY_TOKEN,token);write(KEY_NAME,name);start();return d;}
  async function login(email,password){const d=await call('/api/auth/login',{email,password},{auth:false});token=d.token;name=d.user?.name||'';write(KEY_TOKEN,token);write(KEY_NAME,name);start();return d;}
  async function logout(){stop();const t=token;token='';write(KEY_TOKEN,'');try{if(t)await fetch(url()+'/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:'{}'})}catch{}onPlayers([]);set({state:'off',online:0,error:''});}
  async function tick(){
    if(!token)return;const p=getPosition();if(!p)return;
    try{const d=await call('/api/presence',{x:p.x,z:p.z,heading:p.heading||0,driving:!!p.driving});failures=0;onPlayers(d.players||[]);set({state:'on',online:d.online||1,error:''});}
    catch(e){failures++;if(failures>=3){onPlayers([]);set({state:token?'error':'off',error:e.message});}}
  }
  function start(){stop();if(!token||!url())return;set({state:'connecting',error:''});tick();timer=setInterval(tick,2000);}
  function stop(){if(timer)clearInterval(timer);timer=null;}
  function setUrl(value){write(KEY_URL,(value||'').trim());if(token)start();}
  return {loadConfig,register,login,logout,start,stop,setUrl,url,get token(){return !!token},get name(){return name},get status(){return status}};
}
