"""Explicitly opt-in SOAP TEST using only the publicly documented TS demo identity.

Never accepts invoices, patient data, or credentials from HTTP clients.
No production URL exists in this module.
"""
import os
from datetime import date
import secrets
from pathlib import Path
from base64 import b64encode
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from lxml import etree
from ts_soap import build
from ts_transport import prepare_http_request, TEST_URL, tls_context
import urllib.request
import urllib.error

# From official kit 730P, SoggettoAltriProfessionisti/UtenzeTestAltriProfessionisti.txt.
DEMO_USER = 'MTOMRA66A41G224M'
DEMO_PIVA = '65498732105'
DEMO_CF = 'RSSMRA80A01H501U'  # illustrative fictitious value, never from patient DB
DEMO_OWNER = DEMO_USER
EXPECTED_CERT_SHA256 = '8e7e187dae448d92f78b30dda6253cf5fc6105d2afdc85111ca729708e07de01'
KIT_CERT = Path(__file__).resolve().parent / 'certificates' / 'SanitelCF.cer'
KIT_XSD = Path(__file__).resolve().parent / 'specs' / 'DocumentoSpesa730pSchema.xsd'

class OfficialTestBlocked(Exception):
    pass


def _encrypt_test(value):
    cert = x509.load_pem_x509_certificate(KIT_CERT.read_bytes())
    if cert.fingerprint(hashes.SHA256()).hex() != EXPECTED_CERT_SHA256:
        raise OfficialTestBlocked('certificato_cifratura_non_conforme_al_kit')
    key = cert.public_key()
    # The original 2024 TS test kit certificate is 1024 bit. Restrict this
    # compatibility exception to a fixed public TEST certificate and demo values.
    if not isinstance(key, rsa.RSAPublicKey) or key.key_size != 1024:
        raise OfficialTestBlocked('chiave_test_non_prevista')
    return b64encode(key.encrypt(value.encode('ascii'), padding.PKCS1v15())).decode('ascii')


def preflight():
    """No outbound request; prepare the exact synthetic SOAP request and validate XSD."""
    if os.getenv('TS_OFFICIAL_TEST_ENABLED') != 'YES':
        raise OfficialTestBlocked('test_ufficiale_disabilitato')
    if os.getenv('TS_TEST_PROFILE') != 'altri_professionisti':
        raise OfficialTestBlocked('profilo_test_non_configurato')
    if os.getenv('TS_TEST_USERNAME') != DEMO_USER:
        raise OfficialTestBlocked('username_test_non_corrispondente_al_kit')
    password = os.getenv('TS_TEST_PASSWORD', '')
    pincode = os.getenv('TS_TEST_PINCODE', '')
    if not password or not pincode or len(password) > 128 or not pincode.isdigit() or len(pincode) != 10:
        raise OfficialTestBlocked('credenziali_test_incomplete')
    if not os.getenv('TS_TEST_CA_PEM_B64'):
        raise OfficialTestBlocked('ca_test_non_configurata')

    today = date.today().isoformat()
    # The request is a synthetic TEST receipt. Date/number are not from invoicing.
    doc = {
        'partita_iva': DEMO_PIVA, 'data_emissione': today,
        'dispositivo': '001', 'numero_documento': 'TST-' + date.today().strftime('%y%m%d') + '-' + secrets.token_hex(3).upper(),
        'data_pagamento': today, 'pagamento_tracciato': 'SI',
        'opposizione': False, 'cf_cittadino_cifrato': _encrypt_test(DEMO_CF),
        'proprietario': {'cfProprietario': _encrypt_test(DEMO_OWNER)},
        'voci_spesa': [{'tipo': 'SR', 'importo': '1.00'}],
    }
    xml, action = build(doc, 'inserimento', pincode_cifrato='ENC:' + _encrypt_test(pincode))
    root = etree.fromstring(xml, parser=etree.XMLParser(resolve_entities=False, no_network=True))
    body = root.find('{http://schemas.xmlsoap.org/soap/envelope/}Body')
    schema = etree.XMLSchema(etree.parse(str(KIT_XSD)))
    if body is None or len(body) != 1 or not schema.validate(body[0]):
        raise OfficialTestBlocked('schema_xsd_non_superato')
    req = prepare_http_request(xml, action, DEMO_USER, password, endpoint=TEST_URL)
    return req


def send_official_test():
    """Opted-in network test. Caller must authenticate to the Render route."""
    request = preflight()
    ctx = tls_context(os.getenv('TS_TEST_CA_PEM_B64'))
    try:
        with urllib.request.urlopen(request, context=ctx, timeout=18) as response:
            status = response.status
            payload = response.read(65537)
    except urllib.error.HTTPError as exc:
        status = exc.code
        payload = exc.read(65537)
    except Exception as exc:
        return {'transmitted': False, 'transport_error_type': type(exc).__name__,
                'official_response_received': False, 'environment': 'TEST'}
    if len(payload) > 65536:
        return {'transmitted': True, 'http_status': status, 'response_too_large': True,
                'official_response_received': True, 'environment': 'TEST'}
    from ts_soap import parse_response
    try:
        parsed = parse_response(payload)
        # Do not forward raw XML; only bounded status/protocol fields.
        return {'transmitted': True, 'http_status': status, 'official_response_received': True,
                'environment': 'TEST', 'response': parsed}
    except Exception:
        return {'transmitted': True, 'http_status': status, 'official_response_received': True,
                'response_parse_error': True, 'environment': 'TEST'}
