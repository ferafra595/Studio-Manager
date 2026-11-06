"""Read-only Sistema TS TEST TLS probe. Never sends credentials or documents."""
import base64
import json
import os
import socket
import ssl
import subprocess
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = 'invioSS730pTest.sanita.finanze.it'
PATH = '/DocumentoSpesa730pWeb/DocumentoSpesa730pPort?wsdl'


def context():
    ctx = ssl.create_default_context()
    ca_b64 = os.getenv('TS_TEST_CA_PEM_B64', '').strip()
    if ca_b64:
        pem = base64.b64decode(ca_b64, validate=True).decode('ascii')
        if '-----BEGIN CERTIFICATE-----' not in pem:
            raise ValueError('TS_TEST_CA_PEM_B64 non contiene un certificato PEM')
        ctx.load_verify_locations(cadata=pem)
    return ctx


def peer_diagnostics():
    """Read public TLS peer certificate metadata without trusting it.

    This is for diagnosis ONLY; never use this socket to send HTTP or secrets.
    """
    try:
        p = subprocess.run(
            ['openssl', 's_client', '-connect', f'{HOST}:443', '-servername', HOST,
             '-showcerts'], input='', capture_output=True, text=True, timeout=12,
        )
        output = p.stdout + '\n' + p.stderr
        blocks = []
        begin, end = '-----BEGIN CERTIFICATE-----', '-----END CERTIFICATE-----'
        remaining = output
        while begin in remaining and len(blocks) < 8:
            remaining = remaining.split(begin, 1)[1]
            if end not in remaining:
                break
            cert, remaining = remaining.split(end, 1)
            blocks.append(begin + cert + end + '\n')
        info = []
        for cert in blocks:
            q = subprocess.run(['openssl', 'x509', '-noout', '-subject', '-issuer',
                                '-dates', '-fingerprint', '-sha256'],
                               input=cert, capture_output=True, text=True, timeout=4)
            info.append(q.stdout.strip()[:1200])
        return {'certificates_presented': len(blocks), 'peer_certificates': info,
                'openssl_verify_summary': [line.strip()[:200] for line in output.splitlines()
                                           if 'verify error:' in line.lower() or 'verify return code:' in line.lower()][:6]}
    except Exception as exc:
        return {'peer_diagnostic_error': type(exc).__name__ + ': ' + str(exc)[:160]}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ('/', '/health', '/probe'):
            return self.send_json(404, {'error': 'not found'})
        if self.path in ('/', '/health'):
            return self.send_json(200, {'status': 'ready', 'probe': 'GET /probe', 'no_credentials': True})
        result = {'environment': 'TEST', 'host': HOST, 'credentials_sent': False,
                  'documents_sent': False, 'tls_verification': True,
                  'custom_ca_configured': bool(os.getenv('TS_TEST_CA_PEM_B64'))}
        try:
            ctx = context()
            with socket.create_connection((HOST, 443), timeout=8) as sock:
                with ctx.wrap_socket(sock, server_hostname=HOST) as tls:
                    cert = tls.getpeercert()
                    result.update(tls_ok=True, tls_version=tls.version(),
                                  cert_subject=str(cert.get('subject', ''))[:300],
                                  cert_issuer=str(cert.get('issuer', ''))[:300],
                                  cert_expires=cert.get('notAfter'))
        except Exception as exc:
            result.update(tls_ok=False, error_type=type(exc).__name__, error=str(exc)[:250])
            result.update(peer_diagnostics())
            return self.send_json(200, result)
        try:
            req = urllib.request.Request('https://' + HOST + PATH,
                  headers={'Accept': 'application/xml,text/xml',
                           'User-Agent': 'StudioManager-TS-ReadOnlyProbe/2.0'})
            with urllib.request.urlopen(req, timeout=10, context=context()) as res:
                result.update(http_status=res.status,
                              content_type=res.headers.get('content-type', '')[:100],
                              wsdl_xml='xml' in res.headers.get('content-type', '').lower())
        except urllib.error.HTTPError as exc:
            result.update(http_status=exc.code, wsdl_xml=False)
        except Exception as exc:
            result.update(http_error_type=type(exc).__name__, http_error=str(exc)[:250])
        self.send_json(200, result)

    def send_json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '10000'))), Handler).serve_forever()
