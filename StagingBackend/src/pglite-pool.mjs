import {PGlite} from '@electric-sql/pglite';
/** Integration-only embedded PostgreSQL. Serializes whole transactions. */
export function createPGlitePool(dataDir){
  const engine=new PGlite(dataDir);let queue=Promise.resolve();
  const queryDirect=async(sql,params)=>!params&&sql.includes(';')?(await engine.exec(sql)).at(-1)||{rows:[]}:engine.query(sql,params);
  async function acquire(){let unlock;const next=new Promise(resolve=>{unlock=resolve;}),before=queue;queue=before.then(()=>next);await before;return unlock;}
  return {
    async query(sql,params){const release=await acquire();try{return await queryDirect(sql,params);}finally{release();}},
    async connect(){const release=await acquire();return {query:queryDirect,release};},
    async end(){await queue;await engine.close();}
  };
}
