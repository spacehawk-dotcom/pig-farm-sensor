"""Exercise the HA command path without any HA connection or real device."""
import importlib.util
import asyncio
from pathlib import Path
import sys
import time
import json
import hmac
import hashlib
import unittest
from unittest.mock import AsyncMock, MagicMock, Mock, patch

root = Path(__file__).resolve().parents[1] / "homeassistant/custom_components/sungam_winch"
spec = importlib.util.spec_from_file_location("bridge_under_test", root / "__init__.py", submodule_search_locations=[str(root)])
bridge = importlib.util.module_from_spec(spec)
imports = ["aiohttp", "homeassistant", "homeassistant.const", "homeassistant.helpers",
           "homeassistant.helpers.aiohttp_client", "homeassistant.helpers.storage", "custom_components.localtuya.core.pytuya"]
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

    async def test_both_off_then_600ms_then_on_without_status_queries(self):
        for action, channel in [("up","switch.channel3"),("down","switch.channel2")]:
            calls = []
            async def relay(service, entity):
                calls.append((service,entity))
            async def delay(seconds):
                calls.append(("wait",seconds))
            self.b.relay = relay
            self.b.live.side_effect = TimeoutError("status unavailable")
            with patch.object(bridge.asyncio,"sleep",side_effect=delay):
                await self.b.execute("2",self.cmd | {"action":action})
            self.b.live.assert_not_awaited()
            self.assertEqual(calls,[("turn_off","switch.channel3"),("turn_off","switch.channel2"),
                                    ("wait",0.6),("turn_on",channel)])

    async def test_failed_off_never_sends_on(self):
        self.b.relay.side_effect=TimeoutError("OFF delivery failed")
        with self.assertRaises(TimeoutError):
            await self.b.execute("2",self.cmd)
        self.assertTrue(all(c.args[0]=="turn_off" for c in self.b.relay.await_args_list))

    async def test_expired_during_direction_delay_never_sends_on(self):
        with patch.object(bridge.time,"time",side_effect=[time.time(),self.cmd["expires"]/1000+1]):
            with self.assertRaisesRegex(ValueError,"expired"):
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
    async def test_inline_command_no_claim_rejects_tampering_replay_and_expiry(self):
        b=bridge.Bridge(Mock(), 'test')
        b.controller=Mock()
        b.controller.command=AsyncMock()
        b.post=AsyncMock()
        def message(ticket, expires=None):
            raw=json.dumps(dict(v=2,id='1',ticket=ticket,action='up',expires=expires or time.time()*1000+10000))
            return dict(payload=raw,mac=hmac.new(b.session.encode(),raw.encode(),hashlib.sha256).hexdigest())
        first=message('a'*36)
        b.wake('1',first)
        await asyncio.gather(*list(b.jobs.values()))
        second=message('b'*36)
        b.wake('1',second)
        await asyncio.gather(*list(b.jobs.values()))
        b.wake('1',first)
        b.wake('1',{**second,'payload':second['payload'].replace('up','down')})
        b.wake('1',message('c'*36,time.time()*1000-1))
        self.assertEqual(b.controller.command.await_count,2)
        self.assertTrue(all(call.args[0]=='ack' for call in b.post.await_args_list))

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
