"""Strict, offline mapping from an approved clinic invoice snapshot to TS input.

No database access, network, or real patient data. The clinic must explicitly classify
TS expense types and traceability; no automatic inference from generic service labels.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
import re

class InvoiceMappingError(ValueError):
    pass

ALLOWED_TYPES = frozenset({'TK','FC','FV','AS','SR','CT','PI','IC','AA','AD','SV','SP'})

def map_approved_invoice(invoice: dict, *, piva: str, device: int, cf_cifrato: str | None = None):
    if not isinstance(invoice, dict) or invoice.get('status') != 'approved':
        raise InvoiceMappingError('Fattura non approvata: preparazione TS bloccata')
    if invoice.get('cancelled') or invoice.get('refunded'):
        raise InvoiceMappingError('Fattura annullata/rimborsata: usare il flusso specifico')
    if invoice.get('ts_opposition') is not True and not cf_cifrato:
        raise InvoiceMappingError('CF cifrato mancante; verificare opposizione e regole TS')
    if invoice.get('ts_opposition') is True and cf_cifrato:
        raise InvoiceMappingError('Opposizione: non associare il CF cifrato senza verifica delle regole applicabili')
    if invoice.get('payment_traceable') not in (True, False):
        raise InvoiceMappingError('Tracciabilità del pagamento non verificata')
    if not re.fullmatch(r'\d{11}',piva):
        raise InvoiceMappingError('Partita IVA non valida')
    if not isinstance(device,int) or not 1<=device<=999:
        raise InvoiceMappingError('Dispositivo fiscale non valido')
    try:
        issued = date.fromisoformat(invoice['issued_on'])
        paid = date.fromisoformat(invoice['paid_on'])
    except (ValueError, TypeError, KeyError) as exc:
        raise InvoiceMappingError('Date emissione/pagamento non valide') from exc
    if paid < issued:
        raise InvoiceMappingError('Pagamento precedente all’emissione: richiede verifica manuale')
    items = invoice.get('items')
    if not isinstance(items,list) or not items:
        raise InvoiceMappingError('Voci fattura assenti')
    mapped=[]
    for item in items:
        if not isinstance(item,dict) or item.get('ts_type') not in ALLOWED_TYPES:
            raise InvoiceMappingError('Tipo spesa TS mancante/non valido')
        try:
            amount=Decimal(str(item['amount']))
        except (InvalidOperation,KeyError,TypeError,ValueError) as exc:
            raise InvoiceMappingError('Importo voce non valido') from exc
        if not amount.is_finite() or amount<=0 or amount.as_tuple().exponent < -2:
            raise InvoiceMappingError('Importo voce non valido')
        mapped.append({'tipo':item['ts_type'],'importo':format(amount,'.2f')})
    number=str(invoice.get('number') or '')
    if not number or len(number)>20:
        raise InvoiceMappingError('Numero documento mancante/non valido')
    return {'partita_iva':piva,'data_emissione':issued.isoformat(),
            'data_pagamento':paid.isoformat(),'dispositivo':str(device),
            'numero_documento':number,'cf_cittadino_cifrato':cf_cifrato,
            'opposizione':invoice.get('ts_opposition') is True,
            'pagamento_tracciato':'SI' if invoice['payment_traceable'] else 'NO',
            'voci_spesa':mapped}
