// Interfaccia TS - solo bozze, nessun invio reale.
async function renderSistemaTS(){
 const main=$('#main');main.innerHTML='<section class="card"><h2>Sistema Tessera Sanitaria · Preparazione</h2><p>Ambiente di sviluppo. Nessuna trasmissione a TS. Usare esclusivamente pazienti fittizi.</p><div id="ts-status">Verifica database...</div><div class="form-actions"><button class="primary" id="ts-new">Nuova bozza TS</button><button id="ts-reload">Aggiorna</button><button id="ts-dry-run">Collauda SOAP (dati fittizi)</button><button id="ts-official-test" title="Invio esterno solo di dati sintetici al servizio TEST">Invio ufficiale TEST (demo)</button></div></section><section class="card"><h2>Fatture emesse · Preparazione TS (nessun invio)</h2><div id="ts-invoice-preparations">Caricamento...</div></section><section class="card"><h2>Documenti TS</h2><div id="ts-documents">Caricamento...</div></section>';
 tsInvoicePreparations();
 $('#ts-new').onclick=tsNew;$('#ts-reload').onclick=renderSistemaTS;
 $('#ts-official-test').onclick=async()=>{
  if(!window.confirm('Questo test invia davvero un documento SINTETICO al server TEST del Sistema TS, usando le credenziali demo del kit. Non saranno usate fatture o dati dei pazienti. Vuoi continuare?'))return;
  const btn=$('#ts-official-test');btn.disabled=true;btn.textContent='Invio demo in corso...';
  try{
   const r=await api('v1/ts/official-test','POST',{confirmation:'INVIA TEST UFFICIALE CON DATI FITTIZI'});
   const result=r.response||{};
   const esito=String(result.esito??'');
   const states={'0':'ACCOLTO senza segnalazioni','1':'SCARTATO: errore bloccante','2':'ACCOLTO con segnalazioni'};
   let summary=states[esito]||'ESITO NON DETERMINATO';
   if(result.soap_fault)summary='ERRORE SOAP';
   if((esito==='0'||esito==='2')&&!result.protocollo)summary='DA VERIFICARE: protocollo assente';
   const bits=[`Richiesta spedita: ${r.transmitted?'Sì':'No'}`,`Risposta server TS: ${r.official_response_received?'Ricevuta':'Non ricevuta'}`,
       `HTTP: ${r.http_status??'n/d'}`,`Esito TS: ${esito||'n/d'}`,`Stato documento: ${summary}`,
       `Protocollo: ${result.protocollo||'n/d'}`,`SOAP Fault: ${result.soap_fault?'Sì':'No'}`,
       `Errore di trasporto: ${r.transport_error_type||'nessuno'}`];
   const msgs=Array.isArray(result.messaggi)?result.messaggi.slice(0,50):[];
   const messageHtml=msgs.length?'<h3>Messaggi ufficiali TS</h3><ul>'+msgs.map(m=>
       `<li><b>${esc(String(m.tipo??''))} · ${esc(String(m.codice??''))}</b>: ${esc(String(m.descrizione??''))}</li>`).join('')+'</ul>':'<p>Nessun messaggio dettagliato presente nella risposta ricevuta.</p>';
   const faultHtml=result.soap_fault?`<p><b>SOAP Fault:</b> ${esc(String(result.code||''))} — ${esc(String(result.message||''))}</p>`:'';
   const note=esito==='0'&&result.protocollo?'<p><b>Confermato:</b> documento dimostrativo accolto dal TEST con protocollo. Nessuna fattura reale inviata.</p>':esito==='1'?'<p><b>Attenzione:</b> documento scartato. Non ripetere automaticamente l’invio.</p>':'<p><b>Attenzione:</b> verificare esito e protocollo ufficiali prima di considerare il documento acquisito.</p>';
   modal('Risposta del servizio ufficiale TEST',`<p>${bits.map(s=>esc(s)).join('</p><p>')}</p>${faultHtml}${messageHtml}${note}<p>Solo dati dimostrativi. Nessuna fattura reale inviata.</p>`);
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

async function tsInvoicePreparations(){
 const target=$('#ts-invoice-preparations');if(!target)return;
 try{
  const response=await api('v1/ts/invoice-preparations');const items=response.items||[];
  if(!items.length){target.innerHTML='<p>Non risultano fatture emesse.</p>';return}
  target.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Fattura</th><th>Paziente</th><th>Totale</th><th>Pagamenti</th><th>Preparazione TS</th><th>Revisione</th><th></th></tr></thead><tbody>${items.map(i=>{
   const full=i.paid_cents===i.total_cents&&i.payment_count===1;
   return `<tr><td>${esc(i.series+'/'+i.sequence+'/'+i.year)}</td><td>${esc(i.last_name)} ${esc(i.first_name)}</td><td>${euro(i.total_cents)}</td><td>${euro(i.paid_cents)} (${i.payment_count})</td><td>${esc(i.ts_status||'Non preparata')}</td><td>${i.preparation_id?(i.opposition?'Opposizione':i.reviewed_at?'Registrata (ricontrollare)':'Da verificare'):'—'}</td><td>${i.preparation_id&&!i.opposition?`<button data-ts-review=\"${esc(i.id)}\">Verifica</button>`:!i.preparation_id&&full?`<button data-ts-prepare="${esc(i.id)}">Prepara</button>`:'—'}</td></tr>`
  }).join('')}</tbody></table></div><p class="notice">Nessun invio reale: classificazione manuale e verifica fiscale obbligatoria. Fatture con pagamenti parziali o multipli non ancora supportate.</p>`;
  $$('[data-ts-prepare]').forEach(button=>button.onclick=()=>tsPrepareInvoice(button.dataset.tsPrepare));
  $$('[data-ts-review]').forEach(button=>button.onclick=()=>tsReviewInvoice(button.dataset.tsReview));
 }catch(e){target.textContent=e.message}
}
async function tsPrepareInvoice(invoiceId){
 try{
  const info=await api('v1/ts/invoice-preparations/'+encodeURIComponent(invoiceId));
  const tsTypes=['','TK','FC','FV','AS','SR','CT','PI','IC','AA','AD','SV','SP'];
  const fields=info.lines.map((line,i)=>select('Riga '+(i+1)+' — '+line.description+' ('+euro(line.taxable_cents+line.vat_cents)+')','type_'+i,tsTypes.map(t=>[t,t||'Seleziona codice TS']),'',true)).join('')+
   select('Opposizione del paziente alla trasmissione','opposition',[['','Seleziona espressamente'],['si','Sì, opposizione registrata'],['no','No, opposizione non manifestata']],'',true)+
   `<label><input type="checkbox" name="confirmed" value="1" required> Confermo di aver verificato fattura, pagamento, qualificazione sanitaria delle prestazioni e opposizione. La preparazione NON invia dati al TS.</label>`;
  modal('Prepara fattura '+info.invoice.number+' per verifica TS',form(fields,'Salva preparazione'),()=>bindForm(async f=>{
   if(!['si','no'].includes(f.opposition)||f.confirmed!=='1')throw Error('Conferma e opposizione obbligatorie');
   const types=info.lines.map((line,i)=>({line_id:line.id,expense_type:f['type_'+i]}));
   if(types.some(t=>!t.expense_type))throw Error('Seleziona un codice TS per ogni prestazione');
   await api('v1/ts/invoice-preparations/'+encodeURIComponent(invoiceId),'POST',{opposition:f.opposition==='si',review_confirmed:true,types});
   setTimeout(()=>{if(page==='sistema_ts')renderSistemaTS()},0);
  }));
 }catch(e){toast(e.message)}
}

async function tsReviewInvoice(invoiceId){
 try{
  const r=await api('v1/ts/invoice-preparations/'+encodeURIComponent(invoiceId)+'/review');
  const problems=(r.problems||[]).map(x=>'<li>'+esc(x)+'</li>').join('');
  if(r.opposition){modal('Opposizione del paziente','<p>Opposizione registrata. Nessun invio possibile da questo modulo.</p>');return}
  if(problems){modal('Revisione bloccata','<ul>'+problems+'</ul><p>Correggere la situazione amministrativa prima di procedere. Nessun dato è stato trasmesso.</p>');return}
  if(r.reviewed){modal('Revisione TS','<p>La verifica manuale è registrata e i dati risultano invariati.</p><p><b>Non è stata effettuata alcuna trasmissione.</b></p>');return}
  modal('Revisione documentale TS',form(
   '<p>Questa revisione non certifica la conformità fiscale e non abilita invii automatici.</p>'+
   '<label><input type="checkbox" name="payment_checked" value="1" required> Ho controllato incasso, data e metodo di pagamento.</label>'+
   '<label><input type="checkbox" name="classification_checked" value="1" required> Ho verificato personalmente la corretta tipologia TS di ogni prestazione.</label>'+
   '<label><input type="checkbox" name="issuer_checked" value="1" required> Ho verificato emittente, paziente e assenza di note di credito.</label>',
   'Registra verifica'),()=>bindForm(async f=>{
    if(f.payment_checked!=='1'||f.classification_checked!=='1'||f.issuer_checked!=='1')throw Error('Completa i tre controlli');
    const response=await api('v1/ts/invoice-preparations/'+encodeURIComponent(invoiceId)+'/review','POST',{
      confirmation:'CONFERMO VERIFICA FISCALE TS',payment_checked:true,classification_checked:true,issuer_checked:true
    });
    toast(response.reviewed?'Revisione registrata. Nessun invio effettuato.':'Revisione non riuscita');
    setTimeout(()=>{if(page==='sistema_ts')renderSistemaTS()},0);
   }));
 }catch(e){toast(e.message)}
}
