import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { database, transaction } from '../src/db.js';
import { passwordHash, validPassword } from '../src/security.js';
export async function migrate(db) {
  await transaction(db, async client => { await client.query(await readFile(new URL('../db/001-init.sql',import.meta.url),'utf8')); });
}
export async function seed(db) {
  await transaction(db,async client=>{
    for (const name of ['Petiscos','Porções','Bebidas','Outros']) await client.query('INSERT INTO categories(name) VALUES($1) ON CONFLICT DO NOTHING',[name]);
    // A carga inicial só ocorre se ainda não há produtos: não reativa nem duplica cadastros.
    const count=(await client.query('SELECT count(*) AS n FROM products')).rows[0].n;
    if (Number(count)>0) return;
    const products=[['Bolinho de bacalhau',1200,'Petiscos'],['Coxinha da casa',800,'Petiscos'],['Pastel de queijo',900,'Petiscos'],['Espetinho de frango',1400,'Petiscos'],['Batata frita',2500,'Porções'],['Mandioca frita',2200,'Porções'],['Iscas de frango',3200,'Porções'],['Calabresa acebolada',2900,'Porções'],['Refrigerante lata',600,'Bebidas'],['Água mineral',400,'Bebidas'],['Suco natural',1000,'Bebidas'],['Cerveja long neck',1200,'Bebidas'],['Molho extra',300,'Outros'],['Embalagem para viagem',200,'Outros']];
    for (const [name,price,category] of products) await client.query('INSERT INTO products(name,price_cents,category_id) SELECT $1,$2,id FROM categories WHERE name=$3',[name,price,category]);
  });
}
async function interactiveUser(db,command) {
  let muted=false;
  const output=new Writable({ write(chunk,encoding,callback) { if (!muted) process.stdout.write(chunk,encoding); callback(); } });
  const rl=createInterface({ input:process.stdin,output,terminal:Boolean(process.stdin.isTTY) });
  try {
    const username=(await rl.question('Usuário (letras, números, ponto ou hífen): ')).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) throw Error('Usuário inválido.');
    if (command==='disable') {
      await transaction(db,async client=>{
        await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
        const user=(await client.query('SELECT * FROM users WHERE username=$1',[username])).rows[0];
        if (!user) throw Error('Conta não encontrada.');
        const admins=(await client.query("SELECT count(*) AS n FROM users WHERE active=true AND role='admin'")).rows[0];
        if (user.active && user.role==='admin' && Number(admins.n)<=1) throw Error('Não é possível desativar o último administrador.');
        await client.query('UPDATE users SET active=false WHERE id=$1',[user.id]);
        await client.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
      }); console.log('Conta desativada e sessões encerradas.'); return;
    }
    let name,role;
    if (command==='user') {
      name=(await rl.question('Nome: ')).trim();
      role=(await rl.question('Perfil (admin/operator): ')).trim();
      if (!name || name.length>80 || !['admin','operator'].includes(role)) throw Error('Nome ou perfil inválido.');
    }
    process.stdout.write('Senha (mínimo 12 caracteres; não será exibida): '); muted=true;
    const password=await rl.question(''); muted=false; process.stdout.write('\n');
    if (!validPassword(password)) throw Error('Use de 12 a 128 caracteres.');
    process.stdout.write('Repita a senha: '); muted=true;
    const confirm=await rl.question(''); muted=false; process.stdout.write('\n');
    if (confirm!==password) throw Error('As senhas não coincidem.');
    const encoded=await passwordHash(password);
    if (command==='reset') {
      await transaction(db,async client=>{
        const result=await client.query('UPDATE users SET password_hash=$1 WHERE username=$2 RETURNING id',[encoded,username]);
        if (!result.rows.length) throw Error('Conta não encontrada.');
        await client.query('DELETE FROM sessions WHERE user_id=$1',[result.rows[0].id]);
      }); console.log('Senha atualizada. Sessões encerradas.');
    } else {
      await db.query('INSERT INTO users(name,username,password_hash,role) VALUES($1,$2,$3,$4)',[name,username,encoded,role]); console.log('Conta criada.');
    }
  } finally { muted=false; rl.close(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const db=database();
  try {
    const command=process.argv[2];
    if (command==='migrate') { await migrate(db); console.log('Banco atualizado.'); }
    else if (command==='seed') { await seed(db); console.log('Produtos de demonstração cadastrados.'); }
    else if (['user','reset','disable'].includes(command)) await interactiveUser(db,command);
    else throw Error('Use migrate, seed, user, reset ou disable.');
  } catch(error) { console.error(error.code==='23505'?'Usuário já cadastrado.':error.message); process.exitCode=1; }
  finally { await db.end(); }
}
