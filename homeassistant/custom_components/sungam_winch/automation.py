"""Durable, local temperature-crossing controller; no network calls on a tick."""
import asyncio
import copy
import math
import time

INTERVAL = 300_000
MAX_AGE = 900_000


def valid_settings(settings):
    try:
        up, down = settings['up'], settings['down']
        target = settings['targetTemperature']
        return (type(target) in (int, float) and math.isfinite(target) and 5 <= target <= 40
                and len(up) == len(down) == 3
                and all(type(n) in (int, float) and math.isfinite(n) for n in up + down)
                and target < up[0] < up[1] < up[2] <= target + 20
                and target > down[0] > down[1] > down[2] >= target - 20)
    except (KeyError, TypeError, ValueError):
        return False


def crossing(previous, current, settings):
    if previous is None:
        return None
    if any(previous < n <= current for n in settings['up']):
        return 'up'
    if any(previous > n >= current for n in settings['down']):
        return 'down'
    return None


class LocalAutomation:
    def __init__(self, save, sample, execute, changed, now=lambda: int(time.time()*1000)):
        self.save, self.sample, self.execute, self.changed, self.now = save, sample, execute, changed, now
        self.batches = {}
        self.history = {}
        self.locks = {str(i): asyncio.Lock() for i in range(1, 8)}
        self.storage_lock = asyncio.Lock()

    async def persist(self):
        async with self.storage_lock:
            await self.save(copy.deepcopy({'batches': self.batches, 'history': self.history}))
        self.changed.set()

    async def restore(self, saved):
        self.batches = saved.get('batches', {}) if isinstance(saved, dict) else {}
        self.history = saved.get('history', {}) if isinstance(saved, dict) else {}
        # Restart is a new baseline, never a replay of an interrupted command.
        for state in self.batches.values():
            state.update(referenceTemperature=None, lastActionAt=self.now())

    def temperature(self, batch):
        sample = self.sample(batch)
        value, measured = sample['temperature'], sample['measuredAt']
        if (type(value) not in (int, float) or not math.isfinite(value) or not -40 <= value <= 80
                or not math.isfinite(measured) or not -30_000 <= self.now()-measured < MAX_AGE):
            raise ValueError('temperature unavailable or stale')
        return sample

    async def configure(self, configs):
        for batch, config in configs.items():
            if batch not in self.locks:
                continue
            async with self.locks[batch]:
                if 'initial' not in config and 'settings' not in config:
                    if batch in self.batches:
                        self.batches[batch]['allowed'] = False
                    continue
                if batch not in self.batches:
                    initial = config.get('initial', {})
                    self.batches[batch] = dict(enabled=initial.get('enabled', True),
                        paused=initial.get('paused', True), referenceTemperature=None, lastActionAt=self.now())
                state = self.batches[batch]
                if state.get('settings') != config['settings'] or not state.get('allowed') and config.get('allowed'):
                    state['referenceTemperature'] = None
                state.update(settings=config['settings'], allowed=config.get('allowed') is True, owner='ha',
                    schemaVersion=3, controlSource='ha-local', reason='HA 온도 변화 감시')
        await self.persist()

    async def command(self, batch, command):
        async with self.locks[batch]:
            state = self.batches.get(batch)
            if not state:
                if command['action'] == 'stop':
                    # A stop arriving during initial handover must survive later configuration.
                    state = dict(enabled=True, paused=True, allowed=False, owner='ha', schemaVersion=3)
                    self.batches[batch] = state
                else:
                    raise ValueError('local controller not configured')
            action = command['action']
            if self.now() >= command['expires']:
                raise ValueError('command expired')
            if action == 'check':
                await self.execute(batch, command)
                return
            if action == 'resume':
                settings = command.get('settings')
                if not state.get('allowed') or not valid_settings(settings):
                    raise ValueError('invalid resume settings')
                sample = self.temperature(batch)
                state.update(settings=settings, enabled=True, paused=False, **sample,
                    referenceTemperature=sample['temperature'], lastActionAt=self.now(), checkedAt=self.now(), reason='HA 자동 감시 시작')
                await self.persist()
                return
            if action not in ('up', 'down', 'stop'):
                raise ValueError('invalid action')
            if action != 'stop' and not state.get('allowed'):
                raise ValueError('batch disabled')
            state.update(referenceTemperature=None, lastActionAt=self.now(), checkedAt=self.now())
            if action == 'stop':
                state.update(paused=True, reason='사용자 정지 · 자동 보류')
            else:
                state['reason'] = '수동 신호 요청 · 기존 운전 모드 유지'
            # Persist before I/O, including a pause before both OFF requests.
            try:
                await self.persist()
            except Exception:
                if action == 'stop':
                    await self.execute(batch, command)
                raise
            await self.execute(batch, command)

    async def tick(self, batch):
        async with self.locks[batch]:
            state = self.batches[batch]
            if not state.get('allowed') or not state.get('enabled') or state.get('paused'):
                return
            if not valid_settings(state.get('settings')):
                return
            if self.now()-state.get('lastActionAt', 0) < INTERVAL:
                return
            try:
                sample = self.temperature(batch)
            except (ValueError, TypeError, KeyError):
                return
            action = crossing(state.get('referenceTemperature'), sample['temperature'], state['settings'])
            state.update(**sample, referenceTemperature=sample['temperature'], checkedAt=self.now(), reason='기준 온도 대기')
            if not action:
                await self.persist()
                return
            state.update(lastActionAt=self.now(), lastAction=action, reason='HA 자동 신호 요청')
            event = dict(at=self.now(), action=action, mode='auto', temperature=sample['temperature'], status='registered')
            self.history[batch] = [event, *self.history.get(batch, [])][:20]
            await self.persist()
            try:
                await self.execute(batch, dict(action=action, expires=self.now()+10_000))
                event['status'] = 'sent'
            except Exception:
                # Keep watching new crossings; never replay this movement.
                event['status'] = 'unconfirmed'
            finally:
                await self.persist()
