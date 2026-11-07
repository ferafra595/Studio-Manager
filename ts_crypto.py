"""RSA PKCS#1 v1.5 encryption using the public key from the official TS kit.

Only for fields whose encryption method has been confirmed against current TS specifications.
Does not establish TLS trust and does not authenticate to TS.
"""
import base64
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import padding, rsa

class TSCryptoError(ValueError):
    pass

def load_public_certificate(pem_bytes: bytes):
    if not isinstance(pem_bytes, bytes) or len(pem_bytes) > 32768:
        raise TSCryptoError('Certificato PEM mancante o troppo grande')
    try:
        certificate = x509.load_pem_x509_certificate(pem_bytes)
    except ValueError as exc:
        raise TSCryptoError('Certificato X.509 PEM non valido') from exc
    key = certificate.public_key()
    if not isinstance(key, rsa.RSAPublicKey) or key.key_size < 2048:
        raise TSCryptoError('Chiave pubblica RSA non idonea')
    return certificate

def certificate_info(pem_bytes: bytes):
    cert = load_public_certificate(pem_bytes)
    return {'subject': cert.subject.rfc4514_string(),
            'issuer': cert.issuer.rfc4514_string(),
            'serial_number_hex': format(cert.serial_number,'x'),
            'key_bits': cert.public_key().key_size,
            'not_before': cert.not_valid_before_utc.isoformat(),
            'not_after': cert.not_valid_after_utc.isoformat()}

def encrypt_field(value: str, pem_bytes: bytes) -> str:
    """Return Base64-encoded RSA/PKCS1v15 ciphertext. Never log plaintext/ciphertext."""
    if not isinstance(value, str) or not value or len(value) > 200:
        raise TSCryptoError('Valore da cifrare non valido')
    key = load_public_certificate(pem_bytes).public_key()
    raw = value.encode('utf-8')
    if len(raw) > key.key_size // 8 - 11:
        raise TSCryptoError('Valore troppo lungo per RSA PKCS#1 v1.5')
    return base64.b64encode(key.encrypt(raw, padding.PKCS1v15())).decode('ascii')

def load_kit_certificate(path: str):
    return load_public_certificate(Path(path).read_bytes())
