"""Exercise the HA command path without any HA connection or real device."""
import importlib.util
import asyncio
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
        self.b.equipment = Mock(return_value=(Mock(),["switch.channel3","switch.channel2"],["3","2"]))
        self.idle = dict(online=True,interlock=None,timer=bridge.TIMER_2,up=False,down=False)
        self.b.live = AsyncMock(side_effect=[self.idle,self.idle])
        self.b.relay = AsyncMock()
        self.cmd = dict(action="up", expires=time.time()*1000+10000)

    async def test_dispatches_one_pulse_without_interlock_or_post_command_read(self):
        await self.b.execute("2",self.cmd)
        self.assertEqual(self.b.live.await_count,2)
        self.assertEqual([c.args for c in self.b.relay.await_args_list],
                         [("turn_off","switch.channel3"),("turn_off","switch.channel2"),("turn_on","switch.channel3")])

    async def test_changed_timer_blocks_pulse(self):
        self.b.live.side_effect=[self.idle,self.idle|{"timer":None}]
        with self.assertRaises(ValueError):
            await self.b.execute("2",self.cmd)
        self.assertTrue(all(c.args[0]=="turn_off" for c in self.b.relay.await_args_list))

    async def test_stop_requests_both_off_without_post_command_read(self):
        await self.b.execute("2",self.cmd|{"action":"stop"})
        self.b.live.assert_not_awaited()
        self.assertEqual([c.args[0] for c in self.b.relay.await_args_list],["turn_off","turn_off"])

    async def test_missing_timer_queries_timer_only(self):
        device=Mock()
        device._interface.exchange=AsyncMock(side_effect=[{"dps":{"3":False,"2":False}},{"dps":{"44":bridge.TIMER_2}}])
        self.b.equipment=Mock(return_value=(device,[],[]))
        self.b.current=lambda _,values:values
        self.b.samples={}
        self.b.probe_locks={"2":bridge.asyncio.Lock()}
        sample=await bridge.Bridge.live(self.b,"2")
        self.assertEqual(sample["44"],bridge.TIMER_2)
        self.assertEqual(device._interface.exchange.await_args.args,(bridge.CMDType.DP_QUERY,{"44":None}))


class BridgeReportingTest(unittest.IsolatedAsyncioTestCase):
    async def test_one_cancelled_device_is_unknown_then_recovers_on_next_report(self):
        b = bridge.Bridge(Mock(), "test")
        healthy = dict(online=True, up=False, down=False, timer=bridge.TIMER)
        b.current = Mock(return_value=healthy)
        b.samples = {batch:(time.monotonic(),healthy) for batch in bridge.DEVICES}
        reports = asyncio.Queue()

        async def probe(batch):
            if batch == "5" and not b.post.await_count:
                raise asyncio.CancelledError("device disconnected")
            b.samples[batch] = time.monotonic(), healthy
            return healthy

        async def capture(op, states):
            self.assertEqual(op, "report")
            reports.put_nowait(states)

        b.live = probe
        b.post = AsyncMock(side_effect=capture)
        task = asyncio.create_task(b.report())
        try:
            first = await asyncio.wait_for(reports.get(), 2)
            self.assertEqual(first["5"], dict(online=False, up=None, down=None, timer=None))
            self.assertEqual(sum(s["online"] for s in first.values()), 6)
            b.last_probe = -100
            b.changed.set()
            second = await asyncio.wait_for(reports.get(), 2)
            self.assertEqual(sum(s["online"] for s in second.values()), 7)
        finally:
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

    async def test_supervisor_recovers_exits_and_honors_shutdown(self):
        b = bridge.Bridge(Mock(), "test")
        running = asyncio.Event()
        async def report():
            attempt = b.report.await_count
            if attempt == 1:
                raise asyncio.CancelledError("device reply cancelled")
            if attempt == 2:
                raise RuntimeError("report failed")
            if attempt == 3:
                return
            running.set()
            await asyncio.Event().wait()

        b.report = AsyncMock(side_effect=report)
        with patch.object(bridge, "REPORT_RESTART_DELAY", 0), self.assertLogs(bridge.LOG, level="WARNING"):
            supervisor = asyncio.create_task(b.supervise_reports())
            await asyncio.wait_for(running.wait(), 2)
            supervisor.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await supervisor
        self.assertEqual(b.report.await_count, 4)
