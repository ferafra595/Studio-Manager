// Cloudflare Pages Function: autenticazione server-side, NON autorizza ancora dati sanitari.
const encoder = new TextEncoder();
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
const hex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const digest = async str => hex(await crypto.subtle.digest('SHA-256', encoder.encode(str)));
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:310000},key,256));}
function safeEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function base32(s){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out=[];for(const c of s.toUpperCase().replace(/\s/g,'')){const n=alphabet.indexOf(c);if(n<0)throw Error('Invalid TOTP key');value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-=8))&255)}}return new Uint8Array(out)}
async function totp(secret,step){const key=await crypto.subtle.importKey('raw',base32(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);const msg=new Uint8Array(8);let v=BigInt(step);for(let i=7;i>=0;i--){msg[i]=Number(v&255n);v>>=8n}const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,msg));const off=mac[19]&15;return String((((mac[off]&127)<<24)|(mac[off+1]<<16)|(mac[off+2]<<8)|mac[off+3])%1000000).padStart(6,'0')}
async function validTotp(secret,code){if(!/^\d{6}$/.test(code||''))return false;const now=Math.floor(Date.now()/30000);for(let d=-1;d<=1;d++)if(safeEq(await totp(secret,now+d),code))return true;return false}
function cookie(request){const value=request.headers.get('cookie')||'';return value.split(';').map(s=>s.trim()).find(s=>s.startsWith('sm_session='))?.slice(11)||''}
const secureCookie=(value,maxAge)=>`sm_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${maxAge}`;
async function sessionUser(db,request){const token=cookie(request);if(!/^[a-f0-9]{64}$/.test(token))return null;const hash=await digest(token);const row=await db.prepare('SELECT u.id,u.email,u.display_name,u.role,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(hash,Math.floor(Date.now()/1000)).first();return row||null}
export async function onRequest({request,env,context}){
 const pathname=new URL(request.url).pathname;
 if(!pathname.startsWith('/api/'))return json({error:'Percorso non API'},404);
 const path=pathname.slice('/api/'.length);
 if(!env.DB)return json({error:'Database D1 non configurato.'},503);
 const db=env.DB, method=request.method;
 if(path==='health'&&method==='GET')return json({status:'ready'});
 // Inizializzazione UNA SOLA VOLTA, protetta da BOOTSTRAP_TOKEN impostato come Secret Cloudflare.
 if(path==='setup/status'&&method==='GET'){
  const existing=await db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
  return json({configured:!!existing,available:!existing&&!!env.BOOTSTRAP_TOKEN});
 }
 if(path==='setup/prepare'&&method==='POST'||path==='setup/complete'&&method==='POST'){
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin)return json({error:'Origine non consentita'},403);
  if(!env.BOOTSTRAP_TOKEN||String(env.BOOTSTRAP_TOKEN).length<32)return json({error:'Configurare il Secret BOOTSTRAP_TOKEN di almeno 32 caratteri'},503);
  let body;try{body=await request.json()}catch{return json({error:'Richiesta non valida'},400)}
  const supplied=String(body.bootstrapToken||'');
  if(supplied.length>1024||!safeEq(await digest(supplied),await digest(String(env.BOOTSTRAP_TOKEN))))return json({error:'Codice inizializzazione non valido'},403);
  const existing=await db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
  if(existing)return json({error:'Amministratore già configurato. Inizializzazione disabilitata.'},409);
  if(path==='setup/prepare'){
   const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bytes=crypto.getRandomValues(new Uint8Array(20));let bits=0,value=0,secret='';
   for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;secret+=alphabet[(value>>>bits)&31]}}
   return json({secret});
  }
  const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),secret=String(body.secret||'').trim(),code=String(body.code||'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<16||password.length>256||!/^[A-Z2-7]{32}$/.test(secret)||!await validTotp(secret,code))return json({error:'Dati non validi o codice autenticatore errato'},400);
  const salt=b64(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(password,salt);
  // Inserimento condizionale atomico: due richieste concorrenti non creano due admin.
  const result=await db.prepare("INSERT INTO users(id,email,display_name,role,password_salt,password_hash,totp_secret,active) SELECT ?,?,'Super Admin','admin',?,?,?,1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='admin')").bind(crypto.randomUUID(),email,salt,hash,secret).run();
  if(result.meta?.changes!==1)return json({error:'Inizializzazione già completata'},409);
  return json({ok:true});
 }

 if(path==='login'&&method==='POST'){
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine non consentita'},403);
  let body;try{body=await request.json()}catch{return json({error:'Richiesta non valida'},400)}
  const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),code=String(body.code||'');
  if(email.length>254||password.length>1024)return json({error:'Credenziali non valide'},401);
  // Rate limiting distribuito da configurare con WAF Cloudflare prima dell'uso effettivo.
  const user=await db.prepare('SELECT * FROM users WHERE email=? AND active=1').bind(email).first();
  let valid=false;if(user){const hash=await passwordHash(password,user.password_salt);valid=safeEq(hash,user.password_hash)&&await validTotp(user.totp_secret,code)}
  if(!valid)return json({error:'Credenziali o codice MFA non validi'},401);
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await digest(token),now=Math.floor(Date.now()/1000);
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)').bind(tokenHash,user.id,now+28800,now,now).run();
  await db.prepare('INSERT INTO auth_events(id,user_id,action) VALUES(?,?,?)').bind(crypto.randomUUID(),user.id,'login').run();
  return json({user:{id:user.id,name:user.display_name,role:user.role}},200,{'set-cookie':secureCookie(token,28800)});
 }
 if(path==='me'&&method==='GET'){const user=await sessionUser(db,request);return user?json({user:{id:user.id,name:user.display_name,role:user.role}}):json({error:'Accesso richiesto'},401)}
 if(path==='logout'&&method==='POST'){
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine non consentita'},403);
  const token=cookie(request);if(/^[a-f0-9]{64}$/.test(token))await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  return json({ok:true},200,{'set-cookie':secureCookie('',0)});
 }
 return json({error:'Endpoint inesistente'},404)
}
