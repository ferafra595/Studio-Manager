import unittest
from ts_soap import validate,build,parse_response

D={'partita_iva':'12345678901','data_emissione':'2026-11-07','dispositivo':1,'numero_documento':'A/42', 'data_pagamento':'2026-11-07','cf_cittadino_cifrato':'CIFRATO_TEST','voci_spesa':[{'tipo':'SR','importo':'50.00'}],'pagamento_tracciato':'SI'}
class TestSOAP(unittest.TestCase):
 def test_insert(self):
  self.assertEqual(validate(D),[])
  xml,action=build(D,pincode_cifrato='ENC:PIN_TEST')
  self.assertIn(b'inserimentoDocumentoSpesaRequest',xml)
  self.assertIn(b'idInserimentoDocumentoFiscale',xml)
  self.assertIn(b'50.00',xml)
 def test_cancel(self):
  xml,_=build(D,'cancellazione',pincode_cifrato='ENC:PIN_TEST')
  self.assertIn(b'idCancellazioneDocumentoFiscale',xml)
 def test_bad(self):
  self.assertTrue(validate({}))
  with self.assertRaises(ValueError): build(D,pincode_cifrato='PIN_IN_CHIARO')
 def test_parse(self):
  x=b'<Envelope><Body><inserimentoDocumentoSpesaResponse><esitoChiamata>OK</esitoChiamata><protocollo>123</protocollo></inserimentoDocumentoSpesaResponse></Body></Envelope>'
  self.assertEqual(parse_response(x)['protocollo'],'123')
if __name__=='__main__': unittest.main()
