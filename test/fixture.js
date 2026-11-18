import { PGlite } from '@electric-sql/pglite';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { passwordHash } from '../src/security.js';
import { migrate, seed } from '../scripts/manage.js';
export const password='Senha-de-teste-42!';
// PostgreSQL embarcado para testes; serializa transações em sua conexão única.
// Produção usa pg.Pool com conexões PostgreSQL independentes.
export async function fixture({staticRoot='public',port=0,origin='http://localhost:3000'}={}) {
  const engine=new PGlite();
  let tail=Promise.resolve();
  async function lock(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return release;}
  const db={
    async query(sql,args){const release=await lock();try{return await engine.query(sql,args);}finally{release();}},
    async connect(){const release=await lock();return {query:(sql,args)=>args?engine.query(sql,args):engine.exec(sql).then(r=>r[0]||{rows:[]}),release};},
    end:()=>engine.close()
  };
  await migrate(db);await seed(db);
  const encoded=await passwordHash(password);
  for(const [username,role] of [['admin','admin'],['caixa','operator']])await db.query('INSERT INTO users(name,username,password_hash,role) VALUES($1,$2,$3,$4)',[username==='admin'?'João':'Operador',username,encoded,role]);
  const server=createApp(db,{origin,staticRoot:resolve(staticRoot)});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {db,server,base,async close(){await new Promise(r=>server.close(r));await db.end();}};
}
export async function client(base,username='admin'){
  let cookie='',csrf='';
  const call=async(path,{method='GET',data,headers={}}={})=>{
    const response=await fetch(base+path,{method,headers:{origin:'http://localhost:3000','Content-Type':'application/json',cookie,'X-CSRF-Token':csrf,...headers},body:data===undefined?undefined:JSON.stringify(data)});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    const result=await response.json();if(result.csrf)csrf=result.csrf;
    return {status:response.status,data:result,headers:response.headers};
  };
  await call('/api/login',{method:'POST',data:{username,password}});
  return call;
}
