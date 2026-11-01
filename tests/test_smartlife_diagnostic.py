import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

module = Path(__file__).resolve().parents[1] / "homeassistant/custom_components/sungam_winch/smartlife_diagnostic.py"
spec = importlib.util.spec_from_file_location("smartlife_diagnostic", module)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)


class SmartLifeDiagnosticTest(unittest.TestCase):
    def test_only_online_exact_id_and_actual_status_match(self):
        manager = Mock()
        key = "switch_interlock"
        sample = lambda uid, status, **kw: dict(id=uid, online=True, status=status) | kw
        rows = [sample("a", [{"code":key,"value":"good"}]),
                sample("b", [], function=[{"code":key,"value":"good"}]),
                sample("c", [{"code":key,"value":"good"}], online=False),
                sample("d", [{"code":key,"value":"other"}]),
                sample("e", [{"code":key,"value":"good"}]), sample("e", [])]
        manager.customer_api.get.return_value={"success":True,"result":rows}
        self.assertEqual(diag.read_interlocks(manager,list("abcdef"),"good"),
                         dict(a="설정 일치",b="응답 없음",c="온라인 확인 불가",
                              d="설정 불일치",e="장치 식별 불가",f="장치 식별 불가"))
        manager.customer_api.get.assert_called_once_with("/v1.0/m/life/ha/devices/detail",{"devIds":"a,b,c,d,e,f"})

    def test_failed_account_read_does_not_fall_back_to_cached_devices(self):
        manager = Mock()
        manager.customer_api.get.return_value={"success":False,"result":[]}
        with self.assertRaises(ValueError):
            diag.read_interlocks(manager,["a"],"good")

    def test_supplement_never_replaces_local_disagreement_or_fills_other_fields(self):
        local = dict(online=True, interlock=None, timer=None, up=None, down=False)
        self.assertEqual(diag.supplement(local, "설정 일치", "good"), local | {"interlock":"good"})
        self.assertEqual(diag.supplement(local, "응답 없음", "good"), local)
        for state in [local | {"online":False}, local | {"interlock":"conflict"}]:
            self.assertEqual(diag.supplement(state, "설정 일치", "good"), state)
