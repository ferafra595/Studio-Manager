import os
import unittest
from unittest.mock import patch
from ts_transport import (TransmissionBlocked, prepare_http_request, send_test,
                          tls_context, TEST_URL)

class TransportTests(unittest.TestCase):
    def test_closed_by_default(self):
        with self.assertRaises(TransmissionBlocked):
            send_test(b'<?xml test?>','inserimento.documentospesap730.sanita.finanze.it',username='u',password='p')
    def test_no_env_alone(self):
        with patch.dict(os.environ, {'TS_ENABLE_TEST_TRANSMISSION':'YES'}):
            with self.assertRaises(TransmissionBlocked):
                send_test(b'<?xml test?>','inserimento.documentospesap730.sanita.finanze.it',username='u',password='p',allow_test=True)
    def test_valid_request_in_memory(self):
        r=prepare_http_request(b'<?xml version="1.0"?><a/>','inserimento.documentospesap730.sanita.finanze.it','test','secret')
        self.assertEqual(r.full_url, TEST_URL)
        self.assertEqual(r.get_method(), 'POST')
        self.assertIn('Basic ',r.get_header('Authorization'))
    def test_endpoint_locked(self):
        with self.assertRaises(TransmissionBlocked):
            prepare_http_request(b'<?xml version="1.0"?><a/>','inserimento.documentospesap730.sanita.finanze.it','u','p',endpoint='https://evil.example')
    def test_action_locked(self):
        with self.assertRaises(TransmissionBlocked):
            prepare_http_request(b'<?xml version="1.0"?><a/>','invalid','u','p')
    def test_default_tls_verified(self):
        ctx=tls_context()
        self.assertTrue(ctx.check_hostname)
        self.assertEqual(ctx.verify_mode, __import__('ssl').CERT_REQUIRED)
    def test_bad_ca(self):
        with self.assertRaises(ValueError): tls_context('bm90IGEgY2VydGlmaWNhdGU=')

if __name__=='__main__': unittest.main()
