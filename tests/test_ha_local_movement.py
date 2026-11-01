"""Exercise the HA command path without any HA connection or real device."""
import importlib.util
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, Mock, patch

root = Path(__file__).resolve().parents[1] / "homeassistant/custom_components/sungam_winch"
spec = importlib.util.spec_from_file_location("bridge_under_test", root / "__init__.py")
bridge = importlib.util.module_from_spec(spec)
imports = ["aiohttp", "homeassistant", "homeassistant.const", "homeassistant.helpers",
           "homeassistant.helpers.aiohttp_client", "custom_components.localtuya.core.pytuya"]
with patch.dict(sys.modules, {**{s:MagicMock() for s in imports}, spec.name:bridge}):
    spec.loader.exec_module(bridge)


class BridgeMovementTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.b = object.__new__(bridge.Bridge)
        self.b.hass = Mock()
        self.b.smartlife_guard = True
        self.b.equipment = Mock(return_value=(Mock(),["switch.channel3","switch.channel2"],["3","2"]))
        self.idle = dict(online=True,interlock=None,timer=bridge.TIMER_2,up=False,down=False)
        self.b.live = AsyncMock(side_effect=[self.idle,self.idle,self.idle|{"up":True}])
        self.b.relay = AsyncMock()
        self.cmd = dict(action="up", expires=time.time()*1000+10000)

    async def test_checked_cloud_read_twice_and_all_outputs_use_local_service(self):
        with patch.object(bridge,"account_interlocks",new=AsyncMock(return_value={"2":"설정 일치"})) as check:
            await self.b.execute("2",self.cmd)
            self.assertEqual(check.await_count,2)
        self.assertEqual([c.args for c in self.b.relay.await_args_list],
                         [("turn_off","switch.channel3"),("turn_off","switch.channel2"),("turn_on","switch.channel3")])

    async def test_guard_lost_after_off_never_turns_on(self):
        with patch.object(bridge,"account_interlocks",new=AsyncMock(side_effect=[{"2":"설정 일치"},{"2":"조회 실패"}])):
            with self.assertRaises(ValueError):
                await self.b.execute("2",self.cmd)
        self.assertTrue(all(c.args[0]=="turn_off" for c in self.b.relay.await_args_list))

    async def test_diagnostic_only_default_never_unlocks(self):
        self.b.smartlife_guard = False
        with patch.object(bridge,"account_interlocks",new=AsyncMock()) as check:
            with self.assertRaises(ValueError):
                await self.b.execute("2",self.cmd)
            check.assert_not_awaited()
        self.b.relay.assert_not_awaited()
