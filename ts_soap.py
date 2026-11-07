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
                # Per il tracciato XSD i due campi sono alternativi; il servizio
                # TEST richiede che uno sia effettivamente valorizzato.
                vat = entry.get('aliquota_iva')
                nature = entry.get('natura_iva')
                if (vat is None) == (nature is None):
                    problems.append(f'Voce {i}: indicare esattamente uno fra aliquota IVA e natura IVA')
                if vat is not None:
                    try:
                        rate = Decimal(str(vat))
                        if not rate.is_finite() or rate < 0 or rate > 100 or rate.as_tuple().exponent < -2:
                            raise InvalidOperation
                    except (InvalidOperation, ValueError, TypeError):
                        problems.append(f'Voce {i}: aliquota IVA non valida')
                if nature is not None and not (isinstance(nature, str) and 2 <= len(nature) <= 10):
                    problems.append(f'Voce {i}: natura IVA non valida')
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
            if entry.get('aliquota_iva') is not None:
                child(item, 'aliquotaIVA', f"{Decimal(str(entry['aliquota_iva'])):.2f}")
            elif entry.get('natura_iva') is not None:
                child(item, 'naturaIVA', entry['natura_iva'])
        child(target,'pagamentoTracciato',d['pagamento_tracciato'])
        child(target,'tipoDocumento','F')
        child(target,'flagOpposizione','1' if d.get('opposizione') else '0')
    return ET.tostring(root,encoding='utf-8',xml_declaration=True),action

def parse_response(xml):
    """Interpreta la risposta SOAP del servizio TS sincrono (senza loggare XML o PII).

    0 = accolto, 1 = errore bloccante, 2 = accolto con segnalazioni.
    HTTP 200 non costituisce una conferma dell'acquisizione del documento.
    """
    if not isinstance(xml, (bytes, bytearray)) or len(xml) > 65536:
        raise ValueError('Risposta SOAP non valida o troppo grande')
    root = ET.fromstring(xml)
    def local(node):
        return node.tag.rsplit('}', 1)[-1] if isinstance(node.tag, str) else ''
    def value(node, limit=250):
        return (node.text or '').strip()[:limit] if node is not None else None
    def direct(parent, tag):
        return next((c for c in parent if local(c) == tag), None) if parent is not None else None
    body = next((n for n in root if local(n) == 'Body'), None) if local(root) == 'Envelope' else None
    if body is None:
        raise ValueError('Envelope SOAP privo di Body')
    fault = direct(body, 'Fault')
    if fault is not None:
        return {'soap_fault': True, 'esito': None, 'stato': 'errore_soap',
                'accepted': False, 'protocollo': None,
                'code': value(direct(fault, 'faultcode'), 100),
                'message': value(direct(fault, 'faultstring'), 250),
                'messaggi': []}
    response = next((n for n in body if local(n).endswith('Response')), None)
    if response is None:
        raise ValueError('Risposta SOAP TS non riconosciuta')
    esito = value(direct(response, 'esitoChiamata'), 20)
    protocollo = value(direct(response, 'protocollo'), 40)
    # Il protocollo TS del servizio sincrono è un identificativo di 17 cifre.
    if not (protocollo and re.fullmatch(r'\d{17}', protocollo)):
        protocollo = None
    messages = []
    lista = direct(response, 'listaMessaggi')
    if lista is not None:
        for item in lista:
            if local(item) != 'messaggio':
                continue
            messages.append({'codice': value(direct(item, 'codice'), 40) or '',
                             'descrizione': value(direct(item, 'descrizione'), 350) or '',
                             'tipo': value(direct(item, 'tipo'), 10) or ''})
            if len(messages) >= 50:
                break
    states = {'0': 'accolto', '1': 'errore_bloccante', '2': 'accolto_con_segnalazioni'}
    stato = states.get(esito, 'da_verificare')
    # Un eventuale esito positivo senza protocollo non va presentato come acquisito.
    accepted = esito in ('0', '2') and bool(protocollo)
    if esito in ('0', '2') and not protocollo:
        stato = 'da_verificare'
    return {'soap_fault': False, 'esito': esito, 'stato': stato,
            'accepted': accepted, 'protocollo': protocollo,
            'messaggi': messages}
