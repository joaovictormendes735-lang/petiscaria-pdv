import { database } from './db.js';
import { createApp } from './app.js';
const db=database();
if(!(await db.query('SELECT version FROM schema_migrations WHERE version=3')).rows.length)throw Error('Execute npm run db:migrate antes de iniciar a versão 3.0.');
const server=createApp(db);
server.requestTimeout=20000;
server.headersTimeout=10000;
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`PDV disponível em ${process.env.APP_ORIGIN||'http://localhost:3000'}`));
let stopping=false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  if (stopping) return; stopping=true;
  const timer=setTimeout(()=>process.exit(1),10000); timer.unref();
  server.close(async()=>{ await db.end(); clearTimeout(timer); process.exit(0); });
});
