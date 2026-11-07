import unittest
from ts_test_connector import verify_test_fixture
class BridgeTests(unittest.TestCase):
 def test_offline_fixture(self):
  result=verify_test_fixture()
  self.assertTrue(result['xsd_valid'])
  self.assertFalse(result['transmitted'])
  self.assertFalse(result['credentials_sent'])
if __name__=='__main__': unittest.main()
