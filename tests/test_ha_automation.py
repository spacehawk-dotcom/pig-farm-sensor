import asyncio
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import AsyncMock

spec = importlib.util.spec_from_file_location('local_automation',
    Path(__file__).resolve().parents[1]/'homeassistant/custom_components/sungam_winch/automation.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SETTINGS = dict(targetTemperature=24, up=[24.3,25.5,27], down=[23.7,22.5,21])


class LocalControlTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = 2_000_000
        self.temp = 24
        self.measured = self.now
        self.saved = None
        async def save(data):
            self.saved = copy.deepcopy(data)
        self.execute = AsyncMock()
        self.engine = module.LocalAutomation(save,
            lambda _:dict(temperature=self.temp,measuredAt=self.measured),self.execute,asyncio.Event(),lambda:self.now)
        await self.engine.configure({'1':dict(settings=SETTINGS,allowed=True,initial=dict(enabled=True,paused=False))})

    async def tick(self, temp):
        self.now += 300_000
        self.temp, self.measured = temp, self.now
        await self.engine.tick('1')

    async def test_local_crossings_only_once_even_for_multiple_thresholds(self):
        await self.tick(24)
        await self.tick(28)
        await self.tick(28)
        await self.tick(20)
        self.assertEqual([c.args[1]['action'] for c in self.execute.await_args_list],['up','down'])

    async def test_manual_keeps_auto_resets_baseline_stop_and_resume(self):
        await self.tick(24)
        await self.engine.command('1',dict(action='up',expires=self.now+10000))
        self.assertFalse(self.engine.batches['1']['paused'])
        await self.tick(28)
        self.assertEqual(self.execute.await_count,1)
        await self.engine.command('1',dict(action='stop',expires=self.now+10000))
        await self.tick(20)
        self.assertEqual(self.execute.await_count,2)
        await self.engine.command('1',dict(action='resume',expires=self.now+10000,settings=SETTINGS))
        self.assertFalse(self.engine.batches['1']['paused'])
        self.assertEqual(self.execute.await_count,2)

    async def test_threshold_change_and_restart_only_establish_baseline(self):
        await self.tick(24)
        self.temp = 28
        revised = dict(targetTemperature=23,up=[23.3,24.5,26],down=[22.7,21.5,20])
        await self.engine.configure({'1':dict(settings=revised,allowed=True)})
        await self.tick(28)
        await self.engine.restore(self.saved)
        await self.tick(20)
        self.execute.assert_not_awaited()

    async def test_stale_sensor_does_not_move(self):
        await self.tick(24)
        self.now += 900_000
        self.temp = 28
        await self.engine.tick('1')
        self.execute.assert_not_awaited()

    async def test_failed_delivery_keeps_mode_and_never_replays(self):
        await self.tick(24)
        self.execute.side_effect=TimeoutError('unconfirmed')
        await self.tick(28)
        await self.tick(28)
        self.assertEqual(self.execute.await_count,1)
        self.assertFalse(self.engine.batches['1']['paused'])
        await self.tick(20)
        self.assertEqual(self.execute.await_count,2)

    async def test_failed_intent_storage_never_moves_and_stop_still_sends_off(self):
        await self.tick(24)
        self.engine.save=AsyncMock(side_effect=OSError('disk'))
        with self.assertRaises(OSError):
            await self.tick(28)
        self.execute.assert_not_awaited()
        with self.assertRaises(OSError):
            await self.engine.command('1',dict(action='stop',expires=self.now+10000))
        self.assertEqual(self.execute.await_args.args[1]['action'],'stop')

    async def test_per_batch_lock_serializes_manual_and_auto(self):
        await self.tick(24)
        self.now+=300000
        self.temp,self.measured=28,self.now
        await asyncio.gather(self.engine.tick('1'),self.engine.tick('1'))
        self.assertEqual(self.execute.await_count,1)

    async def test_paused_migration_preserved(self):
        await self.engine.configure({'2':dict(settings=SETTINGS,allowed=True,initial=dict(enabled=True,paused=True))})
        self.assertTrue(self.engine.batches['2']['paused'])

    async def test_expired_commands_are_not_executed(self):
        with self.assertRaises(ValueError):
            await self.engine.command('1',dict(action='up',expires=self.now))
        self.execute.assert_not_awaited()

    async def test_stop_during_handover_survives_later_configuration(self):
        await self.engine.command('2',dict(action='stop',expires=self.now+10000))
        await self.engine.configure({'2':dict(settings=SETTINGS,allowed=True,initial=dict(enabled=True,paused=False))})
        self.assertTrue(self.engine.batches['2']['paused'])

    async def test_missing_setpoint_allows_manual_but_not_auto(self):
        await self.engine.configure({'4':dict(settings=None,allowed=True,initial=dict(enabled=True,paused=True))})
        await self.engine.command('4',dict(action='up',expires=self.now+10000))
        self.assertEqual(self.execute.await_count,1)
        self.engine.batches['4']['paused']=False
        self.now+=300000
        await self.engine.tick('4')
        self.assertEqual(self.execute.await_count,1)


if __name__=='__main__':
    unittest.main()
