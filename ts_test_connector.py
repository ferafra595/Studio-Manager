"""Offline-only synthetic SOAP validation. No TS network traffic or real data."""
from pathlib import Path
from base64 import b64encode
from lxml import etree
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from ts_soap import build
from ts_transport import prepare_http_request, TEST_URL

ROOT=Path(__file__).resolve().parent
CERT_PATH=ROOT/'certificates'/'SanitelCF.cer'
XSD_PATH=ROOT/'specs'/'DocumentoSpesa730pSchema.xsd'
PINNED_FINGERPRINT='8e7e187dae448d92f78b30dda6253cf5fc6105d2afdc85111ca729708e07de01'

def _offline_encrypt(value, cert):
    # Legacy 1024-bit public key is permitted ONLY for a local synthetic fixture.
    # Do not use this exception for real documents or production credentials.
    key=cert.public_key()
    if not isinstance(key,rsa.RSAPublicKey) or key.key_size!=1024:
        raise ValueError('Unexpected legacy test key')
    return b64encode(key.encrypt(value.encode('utf-8'),padding.PKCS1v15())).decode('ascii')

def verify_test_fixture():
    cert=x509.load_pem_x509_certificate(CERT_PATH.read_bytes())
    if cert.fingerprint(hashes.SHA256()).hex()!=PINNED_FINGERPRINT:
        raise ValueError('Test certificate fingerprint mismatch')
    doc={'partita_iva':'00000000000','data_emissione':'2026-11-07',
      'dispositivo':1,'numero_documento':'DEMO/001','data_pagamento':'2026-11-07',
      'pagamento_tracciato':'SI','opposizione':False,
      'voci_spesa':[{'tipo':'SR','importo':'50.00'}],
      'cf_cittadino_cifrato':_offline_encrypt('RSSMRA80A01H501U',cert)}
    xml,action=build(doc,pincode_cifrato='ENC:'+_offline_encrypt('PIN-SINTETICO',cert))
    root=etree.fromstring(xml)
    body=root.find('{http://schemas.xmlsoap.org/soap/envelope/}Body')
    if body is None or len(body)!=1:
        raise ValueError('Invalid SOAP body')
    schema=etree.XMLSchema(etree.parse(str(XSD_PATH)))
    if not schema.validate(body[0]):
        raise ValueError('SOAP failed official XSD validation')
    req=prepare_http_request(xml,action,'TEST_USER','TEST_PASSWORD',endpoint=TEST_URL)
    if req.get_method()!='POST' or req.full_url!=TEST_URL:
        raise ValueError('Unexpected transport setup')
    return {'mode':'TEST','transmitted':False,'credentials_sent':False,
      'patient_data_sent':False,'xsd_valid':True,'soap_action_verified':True,
      'tls_trust_separate':True,'encryption':'RSA PKCS#1 v1.5 (offline fixture only)',
      'notice':'Collaudo locale sintetico: nessuna chiamata al Sistema TS.'}
