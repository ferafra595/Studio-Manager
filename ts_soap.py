"""Studio Manager: preparazione SOAP offline dal WSDL 20240214.
NON effettua invii. I campi sensibili richiedono cifratura TS prima della trasmissione.
"""
import re
import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal, InvalidOperation

NS='http://documentospesap730.sanita.finanze.it'
SOAP='http://schemas.xmlsoap.org/soap/envelope/'
ET.register_namespace('soapenv', SOAP)
ET.register_namespace('ts', NS)
OPERATIONS={
 'inserimento':('inserimentoDocumentoSpesaRequest','idInserimentoDocumentoFiscale','inserimento.documentospesap730.sanita.finanze.it'),
 'variazione':('variazioneDocumentoSpesaRequest','idVariazioneDocumentoFiscale','variazione.documentospesap730.sanita.finanze.it'),
 'rimborso':('rimborsoDocumentoSpesaRequest','DocumentoSpesa','rimborso.documentospesap730.sanita.finanze.it'),
 'cancellazione':('cancellazioneDocumentoSpesaRequest','idCancellazioneDocumentoFiscale','cancellazione.documentospesap730.sanita.finanze.it'),
}
EXPENSE_CODES={'TK','FC','FV','AS','SR','CT','PI','IC','AA','AD','SV','SP'}

def child(parent, name, value=None):
    node=ET.SubElement(parent, f'{{{NS}}}{name}')
    if value is not None: node.text=str(value)
    return node

def validate(d, operation='inserimento'):
    problems=[]
    if operation not in OPERATIONS: return ['Operazione non supportata']
    if not re.fullmatch(r'\d{11}',str(d.get('partita_iva',''))): problems.append('Partita IVA: 11 cifre obbligatorie')
    try:
        issued=date.fromisoformat(d['data_emissione'])
        if issued < date(2014,1,1): problems.append('Data emissione fuori tracciato')
    except (ValueError,KeyError,TypeError): problems.append('Data emissione non valida')
    if not re.fullmatch(r'\d{1,3}',str(d.get('dispositivo',''))) or not 1<=int(d.get('dispositivo') or 0)<=999: problems.append('Dispositivo: 1–999')
    if not d.get('numero_documento') or len(str(d['numero_documento']))>20: problems.append('Numero documento mancante o troppo lungo')
    if operation!='cancellazione':
        try: date.fromisoformat(d['data_pagamento'])
        except (ValueError,KeyError,TypeError): problems.append('Data pagamento non valida')
        if not d.get('cf_cittadino_cifrato') and d.get('opposizione') not in (True,1): problems.append('Codice fiscale cifrato assente: verificare le regole TS per opposizione')
        entries=d.get('voci_spesa')
        if not isinstance(entries,list) or not entries: problems.append('Almeno una voce spesa obbligatoria')
        else:
            for i,entry in enumerate(entries,1):
                if entry.get('tipo') not in EXPENSE_CODES: problems.append(f'Voce {i}: tipo spesa non previsto nello XSD')
                try:
                    amount=Decimal(str(entry['importo']))
                    if not amount.is_finite() or amount<=0 or amount.as_tuple().exponent < -2: raise InvalidOperation
                except (InvalidOperation,KeyError,ValueError): problems.append(f'Voce {i}: importo non valido')
        if d.get('pagamento_tracciato') not in ('SI','NO'): problems.append('Pagamento tracciato: SI o NO')
    return problems

def fiscal_id(parent,d):
    child(parent,'pIva',d['partita_iva'])
    child(parent,'dataEmissione',d['data_emissione'])
    nd=child(parent,'numDocumentoFiscale')
    child(nd,'dispositivo',d['dispositivo'])
    child(nd,'numDocumento',d['numero_documento'])

def build(d, operation='inserimento', *, pincode_cifrato):
    """Genera solo XML in memoria. pincode_cifrato deve essere già cifrato secondo specifiche TS.
    Vietato trasmettere questo XML prima della validazione XSD e della cifratura ufficiale.
    """
    errors=validate(d,operation)
    if errors: raise ValueError('; '.join(errors))
    if not pincode_cifrato or not pincode_cifrato.startswith('ENC:'):
        raise ValueError('PINCODE non cifrato: preparazione bloccata')
    root=ET.Element(f'{{{SOAP}}}Envelope')
    body=ET.SubElement(root,f'{{{SOAP}}}Body')
    req_name, field, action=OPERATIONS[operation]
    req=child(body,req_name)
    child(req,'pincode',pincode_cifrato[4:])
    if d.get('proprietario'):
        owner=child(req,'Proprietario')
        for key in ('codiceRegione','codiceAsl','codiceSSA','cfProprietario'):
            if d['proprietario'].get(key): child(owner,key,d['proprietario'][key])
    if operation=='rimborso': fiscal_id(child(req,'idRimborsoDocumentoFiscale'),d)
    target=child(req,field)
    if operation=='cancellazione': fiscal_id(target,d)
    else:
        fiscal_id(child(target,'idSpesa'),d)
        child(target,'dataPagamento',d['data_pagamento'])
        if d.get('cf_cittadino_cifrato'): child(target,'cfCittadino',d['cf_cittadino_cifrato'])
        for entry in d['voci_spesa']:
            item=child(target,'voceSpesa')
            child(item,'tipoSpesa',entry['tipo'])
            child(item,'importo',f"{Decimal(str(entry['importo'])):.2f}")
        child(target,'pagamentoTracciato',d['pagamento_tracciato'])
        child(target,'tipoDocumento','F')
        child(target,'flagOpposizione','1' if d.get('opposizione') else '0')
    return ET.tostring(root,encoding='utf-8',xml_declaration=True),action

def parse_response(xml):
    """Parsa esiti SOAP senza esportare XML integrale o dati personali nei log."""
    if len(xml)>1024*1024: raise ValueError('Risposta troppo grande')
    root=ET.fromstring(xml)
    fault=root.find(f'.//{{{SOAP}}}Fault')
    if fault is not None:
        return {'soap_fault':True,'code':fault.findtext('faultcode','')[:100], 'message':fault.findtext('faultstring','')[:250]}
    def txt(tag):
        n=next((n for n in root.iter() if n.tag.rsplit('}',1)[-1]==tag),None)
        return (n.text or '')[:250] if n is not None else None
    messages=[]
    for n in root.iter():
        if n.tag.rsplit('}',1)[-1]=='messaggio':
            obj={c.tag.rsplit('}',1)[-1]:(c.text or '')[:250] for c in n}
            messages.append(obj)
            if len(messages)>=50: break
    return {'soap_fault':False,'esito':txt('esitoChiamata'),'protocollo':txt('protocollo'),'messaggi':messages}
