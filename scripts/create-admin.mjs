// Eseguire SOLO sul proprio computer. NON caricare su GitHub il file SQL generato.
import {randomBytes, pbkdf2Sync, randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
const rl=createInterface({input:process.stdin,output:process.stdout});
const email=(await rl.question('Email amministratore: ')).trim().toLowerCase();
const password=await rl.question('Password lunga e unica (min 16 caratteri): ');
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<16){console.error('Email/password non valide');process.exit(1)}
const salt=randomBytes(16).toString('base64'),hash=pbkdf2Sync(password,Buffer.from(salt,'base64'),310000,32,'sha256').toString('hex');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const bytes=randomBytes(20);let bits=0,v=0,secret='';for(const b of bytes){v=(v<<8)|b;bits+=8;while(bits>=5){secret+=alphabet[(v>>>(bits-=5))&31]}}if(bits)secret+=alphabet[(v<<(5-bits))&31];
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const sql=`INSERT INTO users (id,email,display_name,role,password_salt,password_hash,totp_secret,active) VALUES (${quote(randomUUID())},${quote(email)},'Super Admin','admin',${quote(salt)},${quote(hash)},${quote(secret)},1);\n`;
writeFileSync('admin-setup.PRIVATO.sql',sql,{mode:0o600});
console.log('\nConfigurazione autenticatore TOTP:');console.log('Chiave segreta (CONSERVARE PRIVATAMENTE):',secret);console.log('otpauth://totp/StudioManager:'+encodeURIComponent(email)+'?secret='+secret+'&issuer=StudioManager');
console.log('Creato admin-setup.PRIVATO.sql. NON inviarlo né caricarlo su GitHub.');rl.close();
