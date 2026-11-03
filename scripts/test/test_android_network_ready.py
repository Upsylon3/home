import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('network_ready', Path(__file__).parents[1] / 'android-network-ready.py')
network = importlib.util.module_from_spec(spec); spec.loader.exec_module(network)

class NetworkReadyTests(unittest.TestCase):
    def test_requires_actual_validated_unmetered_wifi_and_a_new_probe(self):
        good = 'NetworkAgentInfo{network{100} Transports: WIFI Capabilities: INTERNET&NOT_METERED&VALIDATED}'
        self.assertTrue(network.ready(good, 1, 2))
        self.assertFalse(network.ready(good, 1, 1))
        for missing in ['VALIDATED', 'NOT_METERED', 'WIFI', 'NetworkAgentInfo']:
            self.assertFalse(network.ready(good.replace(missing, ''), 1, 2))
    def test_network_requests_and_cellular_validation_are_not_wifi_proof(self):
        self.assertFalse(network.validated_wifi('NetworkRequest WIFI NOT_METERED VALIDATED'))
        self.assertFalse(network.validated_wifi('NetworkAgentInfo CELLULAR NOT_METERED VALIDATED'))
    def test_setup_refuses_local_or_real_device_execution_before_changing_settings(self):
        import os
        from unittest.mock import patch
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}):
            with self.assertRaises(AssertionError): network.main()

if __name__ == '__main__': unittest.main()
