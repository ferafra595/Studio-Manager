// Studio Manager Fase 1: API per ambiente di prova, solo ADMIN autenticato.
// Date e ore degli appuntamenti: ISO locale YYYY-MM-DDTHH:mm (fuso dello studio).
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(message,status=400)=>reply({error:message},status);
const uid=()=>crypto.randomUUID();
const clean=x=>String(x??'').trim();
const okDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T12:00:00Z'));
const okTime=x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(x);
const okStamp=x=>/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(x)&&okDate(x.slice(0,10));
const cents=x=>Math.round(Number(x)*100);
const addMin=(stamp,minutes)=>{const d=new Date(stamp+':00Z');d.setUTCMinutes(d.getUTCMinutes()+minutes);return d.toISOString().slice(0,16)};
const weekday=stamp=>new Date(stamp.slice(0,10)+'T12:00:00Z').getUTCDay();
async function audit(db,action,entity,id,detail=''){await db.prepare('INSERT INTO sm_audit(id,action,entity,entity_id,detail) VALUES(?,?,?,?,?)').bind(uid(),action,entity,id,detail).run()}
async function all(db,sql,...args){return (await db.prepare(sql).bind(...args).all()).results||[]}
async function one(db,sql,...args){return db.prepare(sql).bind(...args).first()}
async function body(req){if(Number(req.headers.get('content-length')||0)>100000)throw Error('Richiesta troppo grande');return req.json()}
function requireFields(o,fields){for(const f of fields)if(!clean(o[f]))throw Error('Campo obbligatorio: '+f)}
async function available(db,sid,start,end,exclude){
 const conflicts=await one(db,`SELECT id FROM sm_appointments WHERE specialist_id=? AND status!='annullato' AND start_at<? AND end_at>? AND id!=? LIMIT 1`,sid,end,start,exclude||'');
 if(conflicts)return 'Orario già occupato';
 const blocks=await one(db,'SELECT id FROM sm_blocks WHERE specialist_id=? AND start_at<? AND end_at>? LIMIT 1',sid,end,start);
 if(blocks)return 'Specialista non disponibile';
 const day=start.slice(0,10),d=weekday(start);
 const slots=await all(db,`SELECT start_time,end_time FROM sm_schedules WHERE specialist_id=? AND weekday=? AND (valid_from IS NULL OR valid_from<=?) AND (valid_until IS NULL OR valid_until>=?)`,sid,d,day,day);
 if(!slots.some(s=>start.slice(0,10)===end.slice(0,10)&&start.slice(11)>=s.start_time&&end.slice(11)<=s.end_time))return 'Fuori dagli orari di disponibilità';
 return null;
}
export async function phase1({request,env},path){
 const db=env.DB;if(!db)return fail('Binding DB non configurato',503);
 const method=request.method;
 try{
 if(method==='GET'&&path==='/api/v1/diagnostics'){const names=await all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sm_%' ORDER BY name");const required=['sm_disciplines','sm_specialists','sm_services','sm_patients','sm_assignments','sm_schedules','sm_blocks','sm_appointments','sm_clinical_notes','sm_shares','sm_audit','sm_documents'];return reply({ready:required.every(x=>names.some(n=>n.name===x)),missing:required.filter(x=>!names.some(n=>n.name===x))});}
 if(method==='GET'&&path==='/api/v1/bootstrap'){
  const [disciplines,specialists,services,patients,appointments,schedules,blocks]=await Promise.all([
   all(db,'SELECT * FROM sm_disciplines ORDER BY name'),all(db,'SELECT * FROM sm_specialists ORDER BY name'),all(db,'SELECT * FROM sm_services ORDER BY name'),all(db,'SELECT * FROM sm_patients ORDER BY last_name,first_name LIMIT 5000'),all(db,'SELECT * FROM sm_appointments ORDER BY start_at DESC LIMIT 10000'),all(db,'SELECT * FROM sm_schedules ORDER BY specialist_id,weekday,start_time'),all(db,'SELECT * FROM sm_blocks ORDER BY start_at DESC LIMIT 1000')]);
  return reply({disciplines,specialists,services,patients,appointments,schedules,blocks});
 }
 if(method==='GET'&&path==='/api/v1/clinical'){
  const pid=new URL(request.url).searchParams.get('patient');if(!pid)return fail('Paziente mancante');
  const notes=await all(db,'SELECT * FROM sm_clinical_notes WHERE patient_id=? ORDER BY created_at DESC',pid);
  return reply({notes});
 }
 if(method==='GET'&&path==='/api/v1/documents'){
  const pid=new URL(request.url).searchParams.get('patient');if(!pid)return fail('Paziente mancante');
  return reply({documents:await all(db,'SELECT id,patient_id,specialist_id,filename,mime,size_bytes,created_at FROM sm_documents WHERE patient_id=? ORDER BY created_at DESC',pid)});
 }
 if(method==='GET'&&path.startsWith('/api/v1/documents/')){
  if(!env.FILES)return fail('Archivio R2 non configurato',503);
  const id=path.split('/').pop(),doc=await one(db,'SELECT * FROM sm_documents WHERE id=?',id);if(!doc)return fail('Documento non trovato',404);
  const object=await env.FILES.get(doc.object_key);if(!object)return fail('File non disponibile',404);
  const safeName=doc.filename.replace(/[\r\n"\\]/g,'_');
  return new Response(object.body,{headers:{'content-type':doc.mime,'content-disposition':`attachment; filename="${safeName}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
 }
 if(method==='POST'&&path==='/api/v1/documents'){
  if(!env.FILES)return fail('Archivio R2 non configurato',503);
  const type=request.headers.get('content-type')||'';if(!type.startsWith('multipart/form-data'))return fail('Formato non valido');
  const form=await request.formData(),pid=clean(form.get('patient_id')),sid=clean(form.get('specialist_id')),file=form.get('file');
  if(!pid||!file||typeof file.arrayBuffer!=='function')return fail('Paziente e file obbligatori');
  const patient=await one(db,'SELECT id FROM sm_patients WHERE id=?',pid);if(!patient)return fail('Paziente non trovato',404);
  const allowed=['application/pdf','image/jpeg','image/png','image/webp'];if(!allowed.includes(file.type)||file.size>10*1024*1024||file.size===0)return fail('Formato non consentito o dimensione superiore a 10 MB');
  const id=uid(),key=`patients/${pid}/${id}`;
  await env.FILES.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
  try{await db.prepare('INSERT INTO sm_documents(id,patient_id,specialist_id,object_key,filename,mime,size_bytes) VALUES(?,?,?,?,?,?,?)').bind(id,pid,sid||null,key,clean(file.name).slice(0,180)||'documento',file.type,file.size).run()}
  catch(e){await env.FILES.delete(key);throw e}
  await audit(db,'upload','document',id);return reply({id},201);
 }
 if(method==='GET'&&path==='/api/v1/audit')return reply({items:await all(db,'SELECT * FROM sm_audit ORDER BY created_at DESC LIMIT 150')});
 if(method==='POST'&&path==='/api/v1/disciplines'){
  const b=await body(request);requireFields(b,['name']);const id=uid();await db.prepare('INSERT INTO sm_disciplines(id,name) VALUES(?,?)').bind(id,clean(b.name)).run();await audit(db,'create','discipline',id);return reply({id},201);
 }
 if(method==='POST'&&path==='/api/v1/specialists'){
  const b=await body(request);requireFields(b,['name']);if(b.email&& !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))return fail('Email specialista non valida');const id=uid();await db.prepare('INSERT INTO sm_specialists(id,name,discipline_id,email,phone) VALUES(?,?,?,?,?)').bind(id,clean(b.name),b.discipline_id||null,clean(b.email),clean(b.phone)).run();await audit(db,'create','specialist',id);return reply({id},201);
 }
 if(method==='PATCH'&&path.startsWith('/api/v1/specialists/')){
  const id=path.split('/').pop(),b=await body(request);const s=await one(db,'SELECT * FROM sm_specialists WHERE id=?',id);if(!s)return fail('Specialista non trovato',404);
  await db.prepare('UPDATE sm_specialists SET name=?,discipline_id=?,email=?,phone=?,active=? WHERE id=?').bind(clean(b.name??s.name),b.discipline_id??s.discipline_id,clean(b.email??s.email),clean(b.phone??s.phone),b.active===undefined?s.active:Number(!!b.active),id).run();await audit(db,'update','specialist',id);return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/v1/services'){
  const b=await body(request);requireFields(b,['name','specialist_id']);const duration=Number(b.duration),price=cents(b.price??0);
  if(!Number.isInteger(duration)||duration<5||duration>480||!Number.isSafeInteger(price)||price<0)return fail('Durata o prezzo non validi');
  const id=uid();await db.prepare('INSERT INTO sm_services(id,name,specialist_id,duration,price_cents) VALUES(?,?,?,?,?)').bind(id,clean(b.name),b.specialist_id,duration,price).run();await audit(db,'create','service',id);return reply({id},201);
 }
 if(method==='POST'&&path==='/api/v1/patients'){
  const b=await body(request);requireFields(b,['first_name','last_name']);const id=uid();
  if(b.birth_date&&!okDate(b.birth_date))return fail('Data di nascita non valida');
  await db.prepare('INSERT INTO sm_patients(id,first_name,last_name,birth_date,cf,email,phone,address,guardian_name,guardian_phone,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,clean(b.first_name),clean(b.last_name),b.birth_date||null,clean(b.cf).toUpperCase()||null,clean(b.email),clean(b.phone),clean(b.address),clean(b.guardian_name),clean(b.guardian_phone),clean(b.notes)).run();await audit(db,'create','patient',id);return reply({id},201);
 }
 if(method==='PATCH'&&path.startsWith('/api/v1/patients/')){
  const id=path.split('/').pop(),b=await body(request);const p=await one(db,'SELECT * FROM sm_patients WHERE id=?',id);if(!p)return fail('Paziente non trovato',404);
  const v={...p,...b};requireFields(v,['first_name','last_name']);
  await db.prepare('UPDATE sm_patients SET first_name=?,last_name=?,birth_date=?,cf=?,email=?,phone=?,address=?,guardian_name=?,guardian_phone=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(clean(v.first_name),clean(v.last_name),v.birth_date||null,clean(v.cf).toUpperCase()||null,clean(v.email),clean(v.phone),clean(v.address),clean(v.guardian_name),clean(v.guardian_phone),clean(v.notes),id).run();await audit(db,'update','patient',id);return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/v1/assignments'){
  const b=await body(request);requireFields(b,['patient_id','specialist_id']);await db.prepare('INSERT OR IGNORE INTO sm_assignments(patient_id,specialist_id) VALUES(?,?)').bind(b.patient_id,b.specialist_id).run();await audit(db,'assign','patient',b.patient_id,b.specialist_id);return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/v1/schedules'){
  const b=await body(request);requireFields(b,['specialist_id','start_time','end_time']);const day=Number(b.weekday);
  if(!Number.isInteger(day)||day<0||day>6||!okTime(b.start_time)||!okTime(b.end_time)||b.start_time>=b.end_time)return fail('Fascia oraria non valida');
  const id=uid();await db.prepare('INSERT INTO sm_schedules(id,specialist_id,weekday,start_time,end_time,valid_from,valid_until) VALUES(?,?,?,?,?,?,?)').bind(id,b.specialist_id,day,b.start_time,b.end_time,b.valid_from||null,b.valid_until||null).run();await audit(db,'create','schedule',id);return reply({id},201);
 }
 if(method==='DELETE'&&path.startsWith('/api/v1/schedules/')){
  const id=path.split('/').pop();const slot=await one(db,'SELECT * FROM sm_schedules WHERE id=?',id);if(!slot)return fail('Fascia non trovata',404);
  // Protegge appuntamenti futuri che perderebbero l'ultima fascia valida.
  const upcoming=await all(db,"SELECT start_at,end_at FROM sm_appointments WHERE specialist_id=? AND status!='annullato' AND start_at>=?",slot.specialist_id,new Date().toISOString().slice(0,16));
  for(const a of upcoming){if(weekday(a.start_at)!==slot.weekday)continue;const day=a.start_at.slice(0,10);if(slot.valid_from&&day<slot.valid_from||slot.valid_until&&day>slot.valid_until)continue;
   if(a.start_at.slice(11)<slot.start_time||a.end_at.slice(11)>slot.end_time)continue;
   const others=await all(db,'SELECT * FROM sm_schedules WHERE specialist_id=? AND weekday=? AND id!=?',slot.specialist_id,slot.weekday,id);
   if(!others.some(s=>(!s.valid_from||s.valid_from<=day)&&(!s.valid_until||s.valid_until>=day)&&s.start_time<=a.start_at.slice(11)&&s.end_time>=a.end_at.slice(11)))return fail('Prima riprogramma gli appuntamenti coinvolti',409);
  }
  await db.prepare('DELETE FROM sm_schedules WHERE id=?').bind(id).run();await audit(db,'delete','schedule',id);return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/v1/blocks'){
  const b=await body(request);requireFields(b,['specialist_id','start_at','end_at']);if(!okStamp(b.start_at)||!okStamp(b.end_at)||b.start_at>=b.end_at)return fail('Periodo non valido');
  const overlap=await one(db,"SELECT id FROM sm_appointments WHERE specialist_id=? AND status!='annullato' AND start_at<? AND end_at>? LIMIT 1",b.specialist_id,b.end_at,b.start_at);if(overlap)return fail('Prima riprogramma gli appuntamenti coinvolti',409);
  const id=uid();await db.prepare('INSERT INTO sm_blocks(id,specialist_id,start_at,end_at,reason) VALUES(?,?,?,?,?)').bind(id,b.specialist_id,b.start_at,b.end_at,clean(b.reason)).run();await audit(db,'create','block',id);return reply({id},201);
 }
 if(method==='POST'&&path==='/api/v1/appointments'){
  const b=await body(request);requireFields(b,['patient_id','specialist_id','start_at']);if(!okStamp(b.start_at))return fail('Data o ora non valida');
  const service=b.service_id?await one(db,'SELECT * FROM sm_services WHERE id=? AND active=1',b.service_id):null;
  if(b.service_id&&!service)return fail('Prestazione non disponibile');if(service&&service.specialist_id!==b.specialist_id)return fail('Prestazione non associata allo specialista');
  const duration=Number(b.duration??service?.duration??30),price=b.price===undefined?(service?.price_cents??0):cents(b.price);
  if(!Number.isInteger(duration)||duration<5||duration>480||!Number.isSafeInteger(price)||price<0)return fail('Durata o prezzo non validi');
  const repeat=Number(b.repeat??1),every=Number(b.every_days??7);
  if(!Number.isInteger(repeat)||repeat<1||repeat>52||!Number.isInteger(every)||![1,7,14,28].includes(every))return fail('Ricorrenza non valida');
  const created=[],conflicts=[],group=repeat>1?uid():null;
  for(let i=0;i<repeat;i++){
   const start=addMin(b.start_at,i*every*1440),end=addMin(start,duration),reason=await available(db,b.specialist_id,start,end);
   if(reason){conflicts.push({start_at:start,reason});continue}
   const id=uid();
   // INSERT con condizione anti-sovrapposizione: controllata anche nel database.
   const result=await db.prepare(`INSERT INTO sm_appointments(id,patient_id,specialist_id,service_id,start_at,end_at,price_cents,notes,recurrence_id)
   SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM sm_appointments WHERE specialist_id=? AND status!='annullato' AND start_at<? AND end_at>?)`).bind(id,b.patient_id,b.specialist_id,b.service_id||null,start,end,price,clean(b.notes),group,b.specialist_id,end,start).run();
   if(result.meta?.changes){created.push({id,start_at:start});await db.prepare('INSERT OR IGNORE INTO sm_assignments(patient_id,specialist_id) VALUES(?,?)').bind(b.patient_id,b.specialist_id).run();await audit(db,'create','appointment',id)}else conflicts.push({start_at:start,reason:'Orario occupato'});
  }
  return reply({created,conflicts},created.length?201:409);
 }
 if(method==='PATCH'&&path.startsWith('/api/v1/appointments/')){
  const id=path.split('/').pop(),b=await body(request),a=await one(db,'SELECT * FROM sm_appointments WHERE id=?',id);if(!a)return fail('Appuntamento non trovato',404);
  if(b.status==='annullato'){
   await db.prepare("UPDATE sm_appointments SET status='annullato',cancel_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(clean(b.cancel_reason),id).run();await audit(db,'cancel','appointment',id);return reply({ok:true});
  }
  if(b.status&&['prenotato','confermato','arrivato','in_visita','concluso','assente'].includes(b.status)){
   await db.prepare('UPDATE sm_appointments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(b.status,id).run();await audit(db,'status','appointment',id,b.status);return reply({ok:true});
  }
  return fail('Modifica non supportata');
 }
 if(method==='POST'&&path==='/api/v1/clinical'){
  const b=await body(request);requireFields(b,['patient_id','specialist_id','subject']);
  const assigned=await one(db,'SELECT 1 FROM sm_assignments WHERE patient_id=? AND specialist_id=?',b.patient_id,b.specialist_id);if(!assigned)return fail('Specialista non assegnato al paziente',403);
  const id=uid();await db.prepare('INSERT INTO sm_clinical_notes(id,patient_id,specialist_id,appointment_id,subject,anamnesis,assessment,treatment,free_text) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,b.patient_id,b.specialist_id,b.appointment_id||null,clean(b.subject),clean(b.anamnesis),clean(b.assessment),clean(b.treatment),clean(b.free_text)).run();await audit(db,'create','clinical_note',id);return reply({id},201);
 }
 if(method==='POST'&&path==='/api/v1/import'){
  const b=await body(request);if(!Array.isArray(b.rows)||b.rows.length>250)return fail('Importazione: massimo 250 righe per operazione');
  let created=0;const skipped=[];
  for(let i=0;i<b.rows.length;i++){const p=b.rows[i];if(!clean(p.first_name)||!clean(p.last_name)){skipped.push({row:i+1,reason:'Nome/cognome mancanti'});continue}
   const cf=clean(p.cf).toUpperCase();if(cf&&await one(db,'SELECT id FROM sm_patients WHERE upper(cf)=?',cf)){skipped.push({row:i+1,reason:'Codice fiscale già presente'});continue}
   const id=uid();try{await db.prepare('INSERT INTO sm_patients(id,first_name,last_name,cf,phone,email) VALUES(?,?,?,?,?,?)').bind(id,clean(p.first_name),clean(p.last_name),cf||null,clean(p.phone),clean(p.email)).run();created++}catch{skipped.push({row:i+1,reason:'Dato non valido o duplicato'})}
  }
  await audit(db,'import','patient','',`Creati ${created}; scartati ${skipped.length}`);return reply({created,skipped});
 }
 return fail('Endpoint inesistente',404);
 }catch(e){console.error('Studio Manager phase1 error',e?.message||String(e));return fail(/UNIQUE constraint/.test(String(e))?'Valore già esistente':/FOREIGN KEY constraint/.test(String(e))?'Riferimento non valido':/no such table/.test(String(e))?'Database non inizializzato: eseguire la migrazione 0002_phase1.sql in D1':/no such column/.test(String(e))?'Schema D1 non aggiornato: verifica migrazione':e?.message?.startsWith('Campo obbligatorio')?e.message:'Errore salvataggio sul server. Controlla i log Cloudflare.',/UNIQUE constraint/.test(String(e))?409:400)}
}
