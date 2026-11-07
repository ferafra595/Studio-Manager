"""Transport SOAP TS, fail-closed. No production or real data on free diagnostic hosting.

A verified CA and a separately audited encryption implementation are prerequisites.
"""
import base64
import os
import ssl
import urllib.request
import urllib.error
from urllib.parse import urlsplit
from ts_soap import parse_response

TEST_HOST = 'invioSS730pTest.sanita.finanze.it'
TEST_URL = f'https://{TEST_HOST}/DocumentoSpesa730pWeb/DocumentoSpesa730pPort'
ALLOWED_ACTIONS = frozenset({
    'inserimento.documentospesap730.sanita.finanze.it',
    'variazione.documentospesap730.sanita.finanze.it',
    'rimborso.documentospesap730.sanita.finanze.it',
    'cancellazione.documentospesap730.sanita.finanze.it',
})

class TransmissionBlocked(RuntimeError):
    pass


def tls_context(ca_pem_b64=None):
    context = ssl.create_default_context()
    if ca_pem_b64:
        pem = base64.b64decode(ca_pem_b64, validate=True).decode('ascii')
        if '-----BEGIN CERTIFICATE-----' not in pem:
            raise ValueError('Certificato CA PEM non valido')
        context.load_verify_locations(cadata=pem)
    return context


def prepare_http_request(xml, action, username, password, *, endpoint=TEST_URL):
    """Create a request in memory; does not send it."""
    url = urlsplit(endpoint)
    if (url.scheme != 'https' or url.hostname != TEST_HOST.lower() or url.port not in (None, 443)
            or endpoint != TEST_URL):
        raise TransmissionBlocked('Endpoint non autorizzato')
    if action not in ALLOWED_ACTIONS:
        raise TransmissionBlocked('SOAPAction non autorizzata')
    if not isinstance(xml, bytes) or not xml.startswith(b'<?xml') or len(xml) > 512_000:
        raise ValueError('XML non valido o troppo grande')
    if not username or not password or ':' in username or '\r' in username + password or '\n' in username + password:
        raise ValueError('Credenziali non valide')
    token = base64.b64encode(f'{username}:{password}'.encode('utf-8')).decode('ascii')
    return urllib.request.Request(endpoint, data=xml, method='POST', headers={
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '"' + action + '"',
        'Authorization': 'Basic ' + token,
        'Accept': 'text/xml',
    })


def send_test(xml, action, *, username, password, ca_pem_b64=None, allow_test=False,
              encryption_audited=False, timeout=15):
    """Disabled unless two independent explicit safeguards are true.

    No production mode is implemented. Never call with patient data on Render Free.
    """
    if not allow_test or not encryption_audited:
        raise TransmissionBlocked('Invio bloccato: autorizzazione TEST e verifica cifratura mancanti')
    if os.environ.get('TS_ENABLE_TEST_TRANSMISSION') != 'YES':
        raise TransmissionBlocked('Invio bloccato: TS_ENABLE_TEST_TRANSMISSION non attivo')
    request = prepare_http_request(xml, action, username, password)
    ctx = tls_context(ca_pem_b64)
    try:
        with urllib.request.urlopen(request, context=ctx, timeout=timeout) as response:
            if response.status != 200:
                raise TransmissionBlocked('HTTP non previsto dal Sistema TS')
            payload = response.read(1_048_577)
            if len(payload) > 1_048_576:
                raise TransmissionBlocked('Risposta SOAP troppo grande')
            return parse_response(payload)
    except urllib.error.HTTPError as exc:
        # Avoid logging raw HTTP error bodies, which may contain private details.
        raise TransmissionBlocked(f'HTTP {exc.code} dal Sistema TS') from None
