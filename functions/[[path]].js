import { sistemaTS } from './sistema-ts.js';
import {phase1} from './phase1.js';
// Studio Manager - Cloudflare Pages Functions. ACCESSO DEMO SOLO ADMIN.
// Le credenziali risiedono esclusivamente in Cloudflare Secrets: ADMIN_EMAIL e ADMIN_PASSWORD.
const encoder = new TextEncoder();
const json = (data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const hex = bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const unhex = value=>Uint8Array.from(value.match(/.{2}/g)||[],b=>parseInt(b,16));
function same(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=encoder.encode(a),y=encoder.encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;}
async function hmacKey(env){const material=encoder.encode('studio-manager/session/v1\0'+env.ADMIN_EMAIL.toLowerCase()+'\0'+env.ADMIN_PASSWORD);const digest=await crypto.subtle.digest('SHA-256',material);return crypto.subtle.importKey('raw',digest,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
const cookie=(request)=>request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('sm_session='))?.slice(11)||'';
const setCookie=(value,age)=>`sm_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${age}`;
async function issue(env){const expires=Math.floor(Date.now()/1000)+8*3600;const nonce=hex(crypto.getRandomValues(new Uint8Array(16)));const payload=expires+'.'+nonce;const sig=hex(await crypto.subtle.sign('HMAC',await hmacKey(env),encoder.encode(payload)));return payload+'.'+sig;}
async function isAuthenticated(request,env){const token=cookie(request);if(!/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token))return false;const [exp,nonce,sig]=token.split('.');const now=Math.floor(Date.now()/1000),expires=Number(exp);if(expires<=now||expires>now+8*3600)return false;return crypto.subtle.verify('HMAC',await hmacKey(env),unhex(sig),encoder.encode(exp+'.'+nonce));}
const admin=()=>({id:'cloudflare-admin',name:'Super Admin',role:'admin'});
export async function onRequest({request,env}){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/'))return json({error:'Percorso non API'},404);
 if(path==='/api/health'&&request.method==='GET')return json({status:'ready'});
 if(!env.ADMIN_EMAIL||!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<16)return json({error:'Configura ADMIN_EMAIL e ADMIN_PASSWORD (almeno 16 caratteri) nei Secrets Cloudflare.'},503);
 if(path==='/api/login'&&request.method==='POST'){
  if(request.headers.get('origin')!==url.origin)return json({error:'Origine non consentita'},403);
  if(Number(request.headers.get('content-length')||0)>4096)return json({error:'Richiesta troppo grande'},413);
  let body;try{body=await request.json()}catch{return json({error:'Richiesta non valida'},400)}
  const email=String(body?.email||'').trim().toLowerCase(),password=String(body?.password||'');
  if(email.length>254||password.length>1024||!same(email,env.ADMIN_EMAIL.trim().toLowerCase())||!same(password,env.ADMIN_PASSWORD))return json({error:'Email o password non corretti'},401);
  return json({user:admin()},200,{'set-cookie':setCookie(await issue(env),8*3600)});
 }
 if(path.startsWith('/api/v1/')){
  if(!await isAuthenticated(request,env))return json({error:'Accesso richiesto'},401);
  if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'Origine non consentita'},403);
  if(path.startsWith('/api/v1/ts/'))return sistemaTS({request,env},path);
  return phase1({request,env},path);
 }
 if(path==='/api/me'&&request.method==='GET')return await isAuthenticated(request,env)?json({user:admin()}):json({error:'Accesso richiesto'},401);
 if(path==='/api/logout'&&request.method==='POST'){
  if(request.headers.get('origin')!==url.origin)return json({error:'Origine non consentita'},403);
  return json({ok:true},200,{'set-cookie':setCookie('',0)});
 }
 return json({error:'Endpoint inesistente'},404);
}
