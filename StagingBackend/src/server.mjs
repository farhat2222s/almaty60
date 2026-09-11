import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createPool} from './db.mjs';
import {createService} from './service.mjs';
import {fail} from './security.mjs';

export function createHttpServer({pool,service,allowedOrigins=[],trustProxy=false}){
  const send=(res,status,body,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",...extra});res.end(JSON.stringify(body));};
  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();let user;res.setHeader('X-Request-Id',requestId);
    try{
      const path=new URL(req.url,'http://internal').pathname,method=req.method;
      const origin=req.headers.origin;
      if(origin&&!allowedOrigins.includes(origin))fail(403,'ORIGIN_FORBIDDEN');
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(method==='OPTIONS'){
        if(!origin)fail(400,'ORIGIN_REQUIRED');send(res,200,{ok:true},{'Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Idempotency-Key','Access-Control-Max-Age':'600'});return;
      }
      if(method==='GET'&&(path==='/health'||path==='/api/health')){send(res,200,{ok:true,service:'almaty60-staging',demoRewards:true});return;}
      if(method==='GET'&&path==='/ready'){
        try{const r=await pool.query('SELECT max(version) AS version FROM schema_migrations');if(r.rows[0].version!==1)throw new Error('schema');send(res,200,{ready:true,schemaVersion:1});}catch{send(res,503,{ready:false});}return;
      }
      const ip=trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',').at(-1).trim():req.socket.remoteAddress||'unknown';
      await service.rate(`http:${ip}`,3000);
      let body={};
      if(['POST','PATCH'].includes(method)){
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'JSON_REQUIRED');
        const chunks=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>16384)fail(413,'BODY_TOO_LARGE');chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{fail(400,'INVALID_JSON');}
        if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'INVALID_JSON_OBJECT');
      }
      if(method==='POST'&&path==='/api/auth/register'){send(res,201,await service.register(body,ip));return;}
      if(method==='POST'&&path==='/api/auth/login'){send(res,200,await service.login(body,ip));return;}
      const authorization=req.headers.authorization||'';if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))fail(401,'UNAUTHENTICATED');
      user=await service.authenticate(authorization.slice(7));
      const key=req.headers['idempotency-key'];let result,match;
      if(method==='POST'&&path==='/api/auth/logout')result=await service.logout(user);
      else if(method==='GET'&&path==='/api/me')result=await service.me(user);
      else if(method==='GET'&&path==='/api/history')result=await service.history(user);
      else if(method==='GET'&&path==='/api/missions')result=await service.missions();
      else if(method==='GET'&&(match=path.match(/^\/api\/missions\/([A-Za-z0-9_-]+)$/)))result=await service.missions(match[1]);
      else if(method==='POST'&&(match=path.match(/^\/api\/missions\/([A-Za-z0-9_-]+)\/start$/)))result=await service.start(user,match[1],key,body);
      else if(method==='GET'&&(match=path.match(/^\/api\/attempts\/([a-f0-9-]+)$/)))result=await service.getAttempt(user,match[1]);
      else if(method==='POST'&&(match=path.match(/^\/api\/attempts\/([a-f0-9-]+)\/input$/)))result=await service.input(user,match[1],body);
      else if(method==='POST'&&(match=path.match(/^\/api\/attempts\/([a-f0-9-]+)\/finish$/)))result=await service.finish(user,match[1],key,body);
      else if(method==='POST'&&path==='/api/rewards/inspect')result=await service.inspect(user,body.code);
      else if(method==='POST'&&path==='/api/rewards/redeem')result=await service.redeem(user,body.code,key);
      else if(method==='POST'&&path==='/api/campaigns')result=await service.campaign(user,body);
      else if(method==='PATCH'&&(match=path.match(/^\/api\/campaigns\/([a-f0-9-]+)$/)))result=await service.setCampaign(user,match[1],body);
      else if(method==='GET'&&path==='/api/analytics')result=await service.analytics(user);
      else if(method==='PATCH'&&(match=path.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/)))result=await service.blockUser(user,match[1],body);
      else fail(404,'NOT_FOUND');
      send(res,200,result);
    }catch(error){
      const status=error.status||500,code=error.status?error.code:'INTERNAL_ERROR';
      // Never log request bodies, passwords, bearer tokens, database URLs or coupon codes.
      if(status>=500)console.error(JSON.stringify({requestId,error:'request_failed',dbCode:typeof error.code==='string'?error.code:undefined}));
      if(user&&[400,403,409,429].includes(status))try{await service.audit(pool,user.id,'request_rejected',null,{requestId,code});}catch{}
      if(!res.headersSent)send(res,status,{error:code,message:error.status?error.message:'Service temporarily unavailable',requestId},status===429?{'Retry-After':'60'}:{});else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  return server;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const pool=createPool(),service=createService(pool,{tokenEncryptionKey:process.env.TOKEN_ENCRYPTION_KEY,sessionHours:Number(process.env.SESSION_HOURS||24)});
  const port=Number(process.env.PORT||3080);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const server=createHttpServer({pool,service,allowedOrigins:(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean),trustProxy:process.env.TRUST_PROXY==='true'});
  const ready=await pool.query('SELECT max(version) AS version FROM schema_migrations');if(ready.rows[0].version!==1)throw new Error('Run migrations before starting');
  const timer=setInterval(()=>service.sweep().catch(()=>console.error('Expiration sweep failed')),5000);timer.unref();
  server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`ALMATY 60 staging API listening on port ${port}; all rewards are demo-only.`));
  const stop=()=>{clearInterval(timer);server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
