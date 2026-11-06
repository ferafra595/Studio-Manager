"""Read-only TS TEST TLS probe. Never accepts credentials or patient data."""
import json, os, ssl, socket, urllib.parse, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST='invioSS730pTest.sanita.finanze.it'
PATH='/DocumentoSpesa730pWeb/DocumentoSpesa730pPort?wsdl'

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ('/','/health','/probe'):
            return self.send_json(404,{'error':'not found'})
        if self.path in ('/','/health'):
            return self.send_json(200,{'status':'ready','probe':'GET /probe','no_credentials':True})
        result={'environment':'TEST','host':HOST,'credentials_sent':False,'documents_sent':False,'tls_verification':True}
        try:
            ctx=ssl.create_default_context()
            with socket.create_connection((HOST,443),timeout=8) as sock:
                with ctx.wrap_socket(sock,server_hostname=HOST) as tls:
                    cert=tls.getpeercert()
                    result.update(tls_ok=True,tls_version=tls.version(),cert_subject=str(cert.get('subject',''))[:300],cert_issuer=str(cert.get('issuer',''))[:300],cert_expires=cert.get('notAfter'))
        except Exception as exc:
            result.update(tls_ok=False,error_type=type(exc).__name__,error=str(exc)[:250])
            return self.send_json(200,result)
        try:
            req=urllib.request.Request('https://'+HOST+PATH,headers={'Accept':'application/xml,text/xml','User-Agent':'StudioManager-TS-ReadOnlyProbe/1.0'})
            with urllib.request.urlopen(req,timeout=10,context=ssl.create_default_context()) as res:
                result.update(http_status=res.status,content_type=res.headers.get('content-type','')[:100],wsdl_xml='xml' in res.headers.get('content-type','').lower())
        except urllib.error.HTTPError as exc:
            result.update(http_status=exc.code,wsdl_xml=False)
        except Exception as exc:
            result.update(http_error_type=type(exc).__name__,http_error=str(exc)[:250])
        self.send_json(200,result)
    def send_json(self,status,data):
        payload=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers();self.wfile.write(payload)
    def log_message(self,*args): pass

if __name__=='__main__':
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','10000'))),Handler).serve_forever()
