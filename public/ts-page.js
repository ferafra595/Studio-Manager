// Interfaccia TS - solo bozze, nessun invio reale.
async function renderSistemaTS(){
 const main=$('#main');main.innerHTML='<section class="card"><h2>Sistema Tessera Sanitaria · Preparazione</h2><p>Ambiente di sviluppo. Nessuna trasmissione a TS. Usare esclusivamente pazienti fittizi.</p><div id="ts-status">Verifica database...</div><div class="form-actions"><button class="primary" id="ts-new">Nuova bozza TS</button><button id="ts-reload">Aggiorna</button><button id="ts-dry-run">Collauda SOAP (dati fittizi)</button><button id="ts-official-test" title="Invio esterno solo di dati sintetici al servizio TEST">Invio ufficiale TEST (demo)</button></div></section><section class="card"><h2>Documenti TS</h2><div id="ts-documents">Caricamento...</div></section>';
 $('#ts-new').onclick=tsNew;$('#ts-reload').onclick=renderSistemaTS;
 $('#ts-official-test').onclick=async()=>{
  if(!window.confirm('Questo test invia davvero un documento SINTETICO al server TEST del Sistema TS, usando le credenziali demo del kit. Non saranno usate fatture o dati dei pazienti. Vuoi continuare?'))return;
  const btn=$('#ts-official-test');btn.disabled=true;btn.textContent='Invio demo in corso...';
  try{
   const r=await api('v1/ts/official-test','POST',{confirmation:'INVIA TEST UFFICIALE CON DATI FITTIZI'});
   const result=r.response||{};
   const bits=[`Richiesta spedita: ${r.transmitted?'Sì':'No'}`,`Risposta server TS: ${r.official_response_received?'Ricevuta':'Non ricevuta'}`,
       `HTTP: ${r.http_status??'n/d'}`,`Esito TS: ${result.esito??'n/d'}`,`Protocollo: ${result.protocollo??'n/d'}`,
       `SOAP Fault: ${result.soap_fault?'Sì':'No'}`,`Errore di trasporto: ${r.transport_error_type||'nessuno'}`];
   modal('Risposta del servizio ufficiale TEST',`<p>${bits.map(s=>esc(s)).join('</p><p>')}</p><p>Solo dati dimostrativi. Nessuna fattura reale inviata.</p>`);
  }catch(e){toast(e.message)}finally{if(page==='sistema_ts')renderSistemaTS()}
 };
 $('#ts-dry-run').onclick=async()=>{try{
  const b=$('#ts-dry-run');b.disabled=true;b.textContent='Verifica in corso...';
  const r=await api('v1/ts/test-dry-run','POST',{});
  modal('Collaudo SOAP locale',`<p><b>${r.ok?'Schema XSD superato':'Verifica non riuscita'}</b></p><p>SOAPAction verificata: ${r.soap_action_verified?'Sì':'No'}</p><p><b>Nessun dato trasmesso al TS.</b> Il test utilizza esclusivamente dati sintetici.</p>`)
 }catch(e){toast(e.message)}finally{if(page==='sistema_ts')renderSistemaTS()}};
 try{const [status,docs]=await Promise.all([api('v1/ts/status'),api('v1/ts/documents')]);if(page!=='sistema_ts')return;
 $('#ts-status').textContent=status.schema_ready?'Database TS disponibile · Invio reale disabilitato':'Database TS non pronto: applicare la migrazione 0004_sistema_ts.sql';
 const rows=docs.items||[];$('#ts-documents').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>Documento</th><th>Data</th><th>Paziente</th><th>Importo</th><th>Stato</th><th>Operazioni</th></tr></thead><tbody>${rows.map(d=>`<tr><td>${esc(d.document_number)}</td><td>${esc(d.document_date)}</td><td>${esc(d.last_name)} ${esc(d.first_name)}</td><td>${euro(d.total_cents)}</td><td>${esc(d.status)}</td><td><button data-ts-validate="${esc(d.id)}">Verifica</button> <button data-ts-history="${esc(d.id)}">Storico</button></td></tr>`).join('')}</tbody></table></div>`:'<p>Nessuna bozza TS. I documenti TS non sono ancora fatture fiscali emesse dal gestionale.</p>';
 $$('[data-ts-validate]').forEach(b=>b.onclick=async()=>{try{const r=await api('v1/ts/documents/'+b.dataset.tsValidate+'/validate','POST',{});modal('Verifica preliminare TS',`<p>Invio possibile: <b>NO</b></p><ul>${(r.problems||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>Nessun dato trasmesso.</p>`);await renderSistemaTS()}catch(e){toast(e.message)}});
 $$('[data-ts-history]').forEach(b=>b.onclick=async()=>{try{const r=await api('v1/ts/documents/'+b.dataset.tsHistory+'/events');modal('Storico documento TS',r.items.length?`<ul>${r.items.map(x=>`<li>${esc(x.created_at)} · ${esc(x.event_type)} ${esc(x.outcome||'')}</li>`).join('')}</ul>`:'<p>Nessun evento</p>')}catch(e){toast(e.message)}});
 }catch(e){if(page==='sistema_ts')$('#ts-documents').textContent=e.message}
}
function tsNew(){const pts=state.patients||[];if(!pts.length){toast('Crea prima un paziente fittizio');return}
 modal('Nuova bozza TS (non è una fattura)',`<div class="notice">Solo dati fittizi. Questa bozza NON emette una fattura e NON invia dati al Sistema TS.</div>`+form(
 select('Paziente','patient_id',pts.map(p=>[p.id,fullname(p)]))+
 field('Numero documento','document_number','','text',true,'maxlength="80"')+
 field('Data documento','document_date',today(),'date',true)+
 field('Data pagamento','payment_date',today(),'date',true)+
 select('Pagamento','payment_method',[['tracciabile','Tracciabile'],['contanti','Contanti'],['altro','Altro']])+
 field('Importo in euro (es. 50.00)','amount_eur','','number',true,'min="0.01" step="0.01"')+
 field('Codice tipologia spesa TS (da verificare)','expense_type','','text',true,'maxlength="5"')+
 select('Opposizione','opposition',[['0','No'],['1','Sì']]),'Salva bozza'),()=>bindForm(async f=>{
 const v=String(f.amount_eur||'');if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('Importo non valido');const [whole,dec='']=v.split('.');const cents=Number(whole)*100+Number(dec.padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents<=0)throw Error('Importo non valido');
 await api('v1/ts/documents','POST',{patient_id:f.patient_id,document_number:f.document_number,document_date:f.document_date,payment_date:f.payment_date,payment_method:f.payment_method,total_cents:cents,expense_type:f.expense_type,opposition:f.opposition==='1'});setTimeout(()=>{if(page==='sistema_ts')renderSistemaTS()},0)
 }))
}
