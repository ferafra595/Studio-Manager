import unittest
from pathlib import Path
from datetime import datetime, timezone
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID
from cryptography import x509
import base64
from ts_crypto import encrypt_field, certificate_info, TSCryptoError
from ts_invoice_adapter import map_approved_invoice, InvoiceMappingError
from ts_soap import validate

class Tests(unittest.TestCase):
    def setUp(self):
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'local-test-only')])
        cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1).not_valid_before(datetime(2025,1,1,tzinfo=timezone.utc)).not_valid_after(datetime(2030,1,1,tzinfo=timezone.utc)).sign(key,hashes.SHA256())
        self.pem=cert.public_bytes(serialization.Encoding.PEM)
        self.key=key
        self.invoice={'status':'approved','issued_on':'2026-11-01','paid_on':'2026-11-01','number':'123','payment_traceable':True,'ts_opposition':False,'items':[{'ts_type':'SR','amount':'80.00'}]}
    def test_encrypt_roundtrip_with_local_private_key(self):
        encrypted=base64.b64decode(encrypt_field('ABCDEF12G34H567I',self.pem))
        self.assertEqual(self.key.decrypt(encrypted,padding.PKCS1v15()),b'ABCDEF12G34H567I')
    def test_randomized_encryption(self):
        self.assertNotEqual(encrypt_field('1234',self.pem),encrypt_field('1234',self.pem))
    def test_invalid_certificate(self):
        with self.assertRaises(TSCryptoError): encrypt_field('1234',b'bad')
    def test_info(self):
        self.assertEqual(certificate_info(self.pem)['key_bits'],2048)
    def test_invoice_to_existing_soap_validator(self):
        d=map_approved_invoice(self.invoice,piva='12345678901',device=1,cf_cifrato='ciphertext')
        self.assertEqual(validate(d),[])
    def test_unapproved_blocked(self):
        self.invoice['status']='draft'
        with self.assertRaises(InvoiceMappingError): map_approved_invoice(self.invoice,piva='12345678901',device=1,cf_cifrato='ciphertext')
    def test_missing_type_blocked(self):
        del self.invoice['items'][0]['ts_type']
        with self.assertRaises(InvoiceMappingError): map_approved_invoice(self.invoice,piva='12345678901',device=1,cf_cifrato='ciphertext')
    def test_opposition_cf_blocked(self):
        self.invoice['ts_opposition']=True
        with self.assertRaises(InvoiceMappingError): map_approved_invoice(self.invoice,piva='12345678901',device=1,cf_cifrato='ciphertext')
    def test_missing_traceability_blocked(self):
        self.invoice['payment_traceable']=None
        with self.assertRaises(InvoiceMappingError): map_approved_invoice(self.invoice,piva='12345678901',device=1,cf_cifrato='ciphertext')

if __name__=='__main__': unittest.main()
