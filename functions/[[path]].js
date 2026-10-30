// Cloudflare Pages Function: autenticazione server-side, NON autorizza ancora dati sanitari.
const encoder = new TextEncoder();
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
const hex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const digest = async str => hex(await crypto.subtle.digest('SHA-256', encoder.encode(str)));
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:100000},key,256));}
function safeEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
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
 if(path==='login'&&method==='POST'){
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine non consentita'},403);
  let body;try{body=await request.json()}catch{return json({error:'Richiesta non valida'},400)}
  const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  if(email.length>254||password.length>1024||!email||!password)return json({error:'Credenziali non valide'},401);
  // TODO: configurare rate limiting Cloudflare per /api/login prima dell'uso reale.
  const user=await db.prepare('SELECT * FROM users WHERE email=? AND active=1').bind(email).first();
  let valid=false;if(user){const hash=await passwordHash(password,user.password_salt);valid=safeEq(hash,user.password_hash)}
  if(!valid)return json({error:'Credenziali o codice MFA non validi'},401);
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await digest(token),now=Math.floor(Date.now()/1000);
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)').bind(tokenHash,user.id,now+28800,now,now).run();
  // Il log di accesso non deve impedire il login se il registro non è disponibile.
  try { await db.prepare('INSERT INTO auth_events(id,user_id,action) VALUES(?,?,?)').bind(crypto.randomUUID(),user.id,'login').run(); } catch (e) { console.error('Registrazione accesso fallita', e); }
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
