import http from 'node:http';
import {randomUUID, randomInt} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createGameCore, GameError} from './public/game-core.mjs';
import {buildWorld} from './public/world-builder.mjs';
import {setWorld} from './public/world-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Real central Almaty from OpenStreetMap (geo/city-local.json): buildings, streets and the drive graph.
setWorld(buildWorld(JSON.parse(fs.readFileSync(path.join(HERE,'public','geo','city-local.json'),'utf8'))));
function reject(status,error,message){throw new GameError(status,error,message);}

/** Single local demo player. Rules live in public/game-core.mjs; this adds the on-disk save file. */
export function createGameService(options={}){
  const dataDir = options.dataDir===false ? null : (options.dataDir || path.join(HERE,'data'));
  const dataFile = dataDir && path.join(dataDir,'game-state.json');
  const storage = dataFile ? {
    load(){return fs.existsSync(dataFile)?fs.readFileSync(dataFile,'utf8'):null;},
    save(json){
      fs.mkdirSync(dataDir,{recursive:true});
      const tmp=`${dataFile}.${process.pid}.${randomUUID()}.tmp`;
      try{fs.writeFileSync(tmp,json,{mode:0o600});fs.renameSync(tmp,dataFile);}
      finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    }
  } : null;
  return createGameCore({...options,storage,clock:options.clock||{now:()=>Date.now(),monotonic:()=>performance.now()},random:{uuid:randomUUID,int:randomInt}});
}

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.webp':'image/webp'};

export function createGameServer(options={}){
  const game=options.game||createGameService(options);
  const publicDir=path.resolve(options.publicDir||path.join(HERE,'public'));
  const publicReal=fs.realpathSync(publicDir);
  function json(response,status,body){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(body));}
  const server=http.createServer(async(request,response)=>{
    try{
      const host=request.headers.host||'';
      // Bind on loopback and reject DNS rebinding to an arbitrary Host.
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))reject(403,'INVALID_HOST','Этот локальный прототип доступен только через localhost.');
      const pathname=new URL(request.url,`http://${host}`).pathname;
      const origin=request.headers.origin;
      if(origin){
        let parsed;
        try{parsed=new URL(origin);}catch{reject(403,'INVALID_ORIGIN','Недопустимый источник запроса.');}
        if(parsed.protocol!=='http:'||parsed.host!==host)reject(403,'INVALID_ORIGIN','Разрешены запросы только из этого локального прототипа.');
      }
      if(request.headers['sec-fetch-site']==='cross-site')reject(403,'INVALID_ORIGIN','Межсайтовые запросы не разрешены.');
      if(pathname.startsWith('/api/')){
        let body={};
        if(!['GET','HEAD'].includes(request.method)){
          if(!(request.headers['content-type']||'').toLowerCase().startsWith('application/json'))reject(415,'JSON_REQUIRED','Нужен Content-Type: application/json.');
          const parts=[];let bytes=0;
          for await(const part of request){bytes+=part.length;if(bytes>16*1024)reject(413,'BODY_TOO_LARGE','Запрос превышает 16 КБ.');parts.push(part);}
          try{body=JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}catch{reject(400,'INVALID_JSON','Некорректный JSON.');}
        }
        json(response,200,game.handle(request.method,pathname,body));return;
      }
      if(request.method!=='GET'&&request.method!=='HEAD')reject(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');
      let decoded;
      try{decoded=decodeURIComponent(pathname);}catch{reject(400,'INVALID_PATH','Некорректный адрес.');}
      if(decoded.includes('\0')||decoded.includes('\\'))reject(400,'INVALID_PATH','Некорректный адрес.');
      const file=path.resolve(publicDir,`.${decoded==='/'?'/index.html':decoded}`);
      if(!file.startsWith(publicDir+path.sep))reject(403,'FORBIDDEN','Доступ запрещён.');
      let stat;
      try{stat=fs.statSync(file);}catch{reject(404,'NOT_FOUND','Файл не найден.');}
      if(!stat.isFile()||!fs.realpathSync(file).startsWith(publicReal+path.sep))reject(403,'FORBIDDEN','Доступ запрещён.');
      response.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
      if(request.method==='HEAD')response.end();else fs.createReadStream(file).pipe(response);
    }catch(error){
      if(!error.status)console.error(error);
      if(!response.headersSent)json(response,error.status||500,{error:error.error||'INTERNAL_ERROR',message:error.status?error.message:'Ошибка локального сервера.',demo:true});else response.end();
      try{game.flush();}catch(persistError){console.error('Не удалось сохранить состояние:',persistError);}
    }
  });
  server.game=game;
  server.on('close',()=>game.close());
  return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||3060);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT должен быть номером от 1 до 65535.');
  const server=createGameServer();
  server.listen(port,'127.0.0.1',()=>console.log(`ALMATY 60 · локальная демо-игра: http://127.0.0.1:${port}`));
  const stop=()=>{server.game.flush();server.close(()=>process.exit(0));};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
