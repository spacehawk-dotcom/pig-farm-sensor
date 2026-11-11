"""Outbound command receiver for the seven commissioned grower winches."""
import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
from pathlib import Path

from aiohttp import ClientTimeout
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from custom_components.localtuya.core.pytuya import CMDType
from .automation import LocalAutomation
LOG = logging.getLogger(__name__)
API = "https://sungamfarm.netlify.app/.netlify/functions/winch-ha"
WAKE = "https://sungamfarm-default-rtdb.firebaseio.com/winch_local_wakeup.json"
DEVICES = {
    "1": "bfc3bfc544f6c06e35jcn1", "2": "bfb4be1d3b42f4b899zcv2",
    "3": "bf28266bf6b5528dc3jagu", "4": "bf45e580cdc45371f4oeff",
    "5": "bf5c24b61edbc6750cjw34", "6": "bf4f181985fcdb6b1fkddi",
    "7": "bf2fc7c86f8148ef80xom4",
}
TIMER = "AQAFAwAGBAACBgAC"
TIMER_2 = "AAAFAwAGBQAFBgAC"
REPORT_RESTART_DELAY = 5


class Bridge:
    def __init__(self, hass, token):
        self.hass = hass
        self.token = token
        self.session = secrets.token_hex(32)
        self.http = async_get_clientsession(hass)
        self.jobs = {}
        self.last_ticket = {}
        self.seen_tickets = {}
        self.changed = asyncio.Event()
        self.samples = {}
        self.probe_locks = {batch:asyncio.Lock() for batch in DEVICES}
        self.controller = None
        self.temperature_entities = {}

    async def initialize_controller(self):
        path = Path(self.hass.config.path('firebase_push.config.json'))
        exporter = json.loads(await self.hass.async_add_executor_job(path.read_text))
        for batch in DEVICES:
            entity = exporter.get('zones', {}).get(f'육성_{batch}배치', {}).get('temp')
            if not isinstance(entity, str) or not entity.startswith('sensor.'):
                raise ValueError(f'temperature entity missing: {batch}')
            self.temperature_entities[batch] = entity
        storage = Store(self.hass, 1, 'sungam_winch_automation')
        self.controller = LocalAutomation(storage.async_save, self.local_temperature, self.execute, self.changed)
        await self.controller.restore(await storage.async_load())

    def local_temperature(self, batch):
        entity = self.hass.states.get(self.temperature_entities[batch])
        if not entity or entity.attributes.get('restored') or entity.state in ('unknown', 'unavailable'):
            raise ValueError('temperature sensor unavailable')
        if entity.attributes.get('unit_of_measurement') not in ('°C', '℃', 'C'):
            raise ValueError('temperature unit must be Celsius')
        # last_reported advances on real HA state reports even if the value is unchanged.
        received = getattr(entity, 'last_reported', entity.last_updated)
        return dict(temperature=float(entity.state), measuredAt=int(received.timestamp()*1000), source='ha-local')

    async def configure_controller(self):
        response = await self.post('configure', batches=list(self.temperature_entities))
        await self.controller.configure(response['batches'])

    async def run_controller(self):
        next_config, next_tick = 0, time.monotonic()+300
        while True:
            now = time.monotonic()
            if now >= next_config:
                try:
                    await self.configure_controller()
                    next_config = now+300
                except Exception as err:
                    LOG.warning('Local controller configuration pending (%s)', type(err).__name__)
                    next_config = now+15
            if now >= next_tick:
                results = await asyncio.gather(*(self.controller.tick(batch)
                    for batch in list(self.controller.batches)), return_exceptions=True)
                if any(isinstance(result, BaseException) for result in results):
                    LOG.warning('A local automation tick failed; other batches continued')
                next_tick = time.monotonic()+300
            await asyncio.sleep(1)

    async def supervise_controller(self):
        while True:
            try:
                await self.run_controller()
            except asyncio.CancelledError:
                raise
            except Exception:
                LOG.exception('Local temperature controller restarting')
            await asyncio.sleep(5)

    async def post(self, op, **fields):
        async with self.http.post(API, json=dict(op=op, session=self.session, **fields),
                headers={"X-HA-Bridge": self.token}, allow_redirects=False,
                timeout=ClientTimeout(total=8)) as response:
            response.raise_for_status()
            return await response.json()

    def equipment(self, batch):
        uid = DEVICES[batch]
        registry = er.async_get(self.hass)
        channels = ("3" if batch == "2" else "1", "2")
        entities = [registry.async_get_entity_id("switch", "localtuya", f"local_{uid}_{ch}") for ch in channels]
        entry = registry.async_get(entities[0]) if entities[0] else None
        if not entry or not all(entities):
            raise ValueError("channel not registered")
        config = self.hass.config_entries.async_get_entry(entry.config_entry_id)
        host = config.data["devices"][uid]["host"]
        device = self.hass.data["localtuya"][config.entry_id].devices[host]
        if not device.connected:
            raise ValueError("device unavailable")
        return device, entities, channels

    def current(self, batch, values=None):
        """Never turn absent, restored or unavailable states into OFF."""
        result = dict(online=False, up=None, down=None, timer=None)
        try:
            device, entities, channels = self.equipment(batch)
            values = device._status if values is None else values
            outputs = [values.get(ch) for ch in channels]
            for entity, value in zip(entities, outputs):
                state = self.hass.states.get(entity)
                if type(value) is not bool or not state or state.state != ("on" if value else "off"):
                    return result
            result.update(online=True, up=outputs[0], down=outputs[1],
                          timer=values.get("44"))
        except (AttributeError, KeyError, ValueError, TypeError):
            pass
        return result

    async def live(self, batch):
        async with asyncio.timeout(4), self.probe_locks[batch]:
            device, _, _ = self.equipment(batch)
            interface = device._interface
            reply = await interface.exchange(command=CMDType.DP_QUERY)
            if not isinstance(reply, dict) or not isinstance(reply.get("dps"), dict):
                raise ValueError("no local relay response")
            values = dict(reply["dps"])
            if "44" not in values:
                # Some devices omit the timer from general status. Request that DP alone.
                detail = await interface.exchange(CMDType.DP_QUERY, {"44":None})
                if isinstance(detail,dict):
                    values.update(detail.get("dps",{}))
            self.samples[batch] = (time.monotonic(),self.current(batch,values))
            return self.samples[batch][1]

    async def sample_batches(self):
        # LocalTuya may cancel just one device's pending reply on disconnect.
        # Cancelling the reporter itself still cancels the entire gather.
        results = await asyncio.gather(*(self.live(batch) for batch in DEVICES), return_exceptions=True)
        for batch, result in zip(DEVICES, results):
            if isinstance(result, BaseException):
                if self.samples.pop(batch, None) is not None:
                    LOG.warning("Batch %s status unavailable (%s)", batch, type(result).__name__)

    def reported_state(self, batch):
        at, sample = self.samples.get(batch, (0, {}))
        if sample.get("online") and time.monotonic() - at < 70:
            try:
                current = self.current(batch)
                if current["online"]:
                    return {**current, "timer":sample["timer"]}
            except Exception:
                self.samples.pop(batch, None)
                LOG.exception("Could not read cached outputs for batch %s", batch)
        return {"online":False, "up":None, "down":None, "timer":None}

    async def relay(self, service, entity):
        async with asyncio.timeout(3):
            await self.hass.services.async_call("switch", service, {"entity_id":entity}, blocking=True)

    async def execute(self, batch, command):
        action, expires = command["action"], command["expires"]
        def fresh():
            if time.time() * 1000 >= expires:
                raise ValueError("command expired")
        fresh()
        _, entities, _ = self.equipment(batch)
        if action == "check":
            if not (await self.live(batch))["online"]:
                raise ValueError("local state unavailable")
            return
        if action == "stop":
            # Attempt both directions even if one OFF fails.
            replies = await asyncio.gather(*(self.relay("turn_off", e) for e in entities), return_exceptions=True)
            if any(isinstance(r, BaseException) for r in replies):
                raise ValueError("stop signal delivery failed")
            return
        if action not in ("up", "down"):
            raise ValueError("unknown action")
        for entity in entities:
            await self.relay("turn_off", entity)
        await asyncio.sleep(0.6)
        fresh()
        await self.relay("turn_on", entities[0 if action=="up" else 1])

    async def handle(self, batch, ticket):
        try:
            claim = await self.post("claim", id=batch, ticket=ticket)
            if not (command := claim.get("command")):
                return
            ok = False
            try:
                await self.execute(batch, command)
                ok = True
            finally:
                await self.post("ack", id=batch, ticket=ticket, ok=ok)
                self.changed.set()
        except Exception as err:
            LOG.warning("Batch %s signal delivery error (%s)", batch, type(err).__name__)

    async def handle_inline(self, batch, command):
        ok = False
        try:
            await self.controller.command(batch, command)
            ok = True
        except Exception as err:
            LOG.warning('Batch %s local command failed (%s)', batch, type(err).__name__)
        finally:
            # Acknowledgement is after the local operation; it never gates or repeats ON.
            self.changed.set()
            try:
                await self.post('ack', id=batch, ticket=command['ticket'], ok=ok,
                    auto=self.controller.batches.get(batch))
            except Exception:
                LOG.debug('Command acknowledgement unavailable')

    def wake(self, batch, value):
        if batch not in DEVICES or not isinstance(value, dict):
            return
        if 'payload' in value:
            raw, mac = value.get('payload'), value.get('mac')
            if not self.controller or not isinstance(raw, str) or len(raw)>4096 or not isinstance(mac, str):
                return
            if len(mac)!=64 or any(c not in '0123456789abcdef' for c in mac):
                return
            expected = hmac.new(self.session.encode(), raw.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, mac):
                return
            try:
                command = json.loads(raw)
                ticket = command['ticket']
                if (command['v'] != 2 or command['id'] != batch or not isinstance(ticket, str)
                        or len(ticket) != 36 or ticket in self.seen_tickets
                        or command['action'] not in ('up', 'down', 'stop', 'check', 'resume')
                        or not 0 < command['expires']-time.time()*1000 <= 15_000):
                    return
            except (KeyError, ValueError, TypeError):
                return
            self.last_ticket[batch] = ticket
            self.seen_tickets = {key:expiry for key,expiry in self.seen_tickets.items() if expiry>time.time()*1000}
            self.seen_tickets[ticket] = command['expires']
            # Controller's per-batch lock serializes manual and automatic operations.
            task = asyncio.create_task(self.handle_inline(batch, command))
            self.jobs[ticket] = task
            task.add_done_callback(lambda _: self.jobs.pop(ticket, None))
            return
        ticket = value.get("ticket")
        if not isinstance(ticket,str) or len(ticket)!=36 or self.last_ticket.get(batch)==ticket:
            return
        mac = hmac.new(self.session.encode(), f"{batch}:{ticket}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mac, str(value.get("mac",""))):
            return
        if batch in self.jobs and not self.jobs[batch].done():
            return
        self.last_ticket[batch] = ticket
        self.jobs[batch] = asyncio.create_task(self.handle(batch,ticket))

    async def listen(self):
        while True:
            try:
                async with self.http.get(WAKE, headers={"Accept":"text/event-stream"},
                        timeout=ClientTimeout(total=None,sock_read=75)) as r:
                    r.raise_for_status()
                    async for line in r.content:
                        if not line.startswith(b"data: ") or len(line)>65536:
                            continue
                        event = json.loads(line[6:])
                        if not isinstance(event,dict):
                            continue
                        path, data = event.get("path"), event.get("data")
                        if path=="/" and isinstance(data,dict):
                            for batch,value in data.items():
                                self.wake(batch,value)
                        elif isinstance(path,str):
                            self.wake(path.strip("/"),data)
            except Exception as err:
                LOG.debug("Wake stream reconnecting (%s)",type(err).__name__)
            await asyncio.sleep(3)

    async def report(self):
        previous, previous_auto, last = None, None, 0
        while True:
            if time.monotonic() - getattr(self,"last_probe",-100) > 45:
                await self.sample_batches()
                self.last_probe = time.monotonic()
            states = {batch:self.reported_state(batch) for batch in DEVICES}
            auto_snapshot = json.dumps(self.controller.batches, sort_keys=True) if self.controller else None
            if states != previous:
                self.hass.states.async_set("sensor.sungam_winch_bridge",sum(s["online"] for s in states.values()),{
                    "friendly_name":"LocalTuya winches", "command_mode":"signal_only",
                    "version":"2.0.0", "automation_owner":"ha" if self.controller else "server",
                    "timer_received":[b for b,s in states.items() if s["timer"]],
                    "verified":[b for b,s in states.items() if s["timer"]==(TIMER_2 if b=="2" else TIMER)]})
            if states != previous or auto_snapshot != previous_auto or time.monotonic()-last>55 or self.changed.is_set():
                try:
                    temperatures = {}
                    if self.controller:
                        for batch in DEVICES:
                            try:
                                temperatures[batch] = self.controller.temperature(batch)
                            except (ValueError, KeyError, TypeError):
                                pass
                    extra = {} if not self.controller else dict(protocol=2, autos=self.controller.batches,
                        autoHistory=self.controller.history, temperatures=temperatures)
                    await self.post("report", states=states, **extra)
                    previous,last = states,time.monotonic()
                    previous_auto = auto_snapshot
                except Exception as err:
                    LOG.debug("State report unavailable (%s)",type(err).__name__)
                    await asyncio.sleep(5)
            try:
                await asyncio.wait_for(self.changed.wait(),timeout=1)
            except TimeoutError:
                pass
            self.changed.clear()

    async def supervise_reports(self):
        while True:
            try:
                await asyncio.create_task(self.report())
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    raise
                LOG.warning("Status reporter cancelled unexpectedly, restarting")
            except Exception:
                LOG.exception("Status reporter failed, restarting")
            else:
                LOG.warning("Status reporter exited, restarting")
            await asyncio.sleep(REPORT_RESTART_DELAY)


async def async_setup(hass, config):
    token = await hass.async_add_executor_job(Path(hass.config.path(".storage/sungam_winch.secret")).read_text)
    bridge = Bridge(hass,token.strip())
    await bridge.initialize_controller()
    jobs = [asyncio.create_task(bridge.listen()),asyncio.create_task(bridge.supervise_reports()),
        asyncio.create_task(bridge.supervise_controller())]
    async def stop(event):
        for task in jobs + list(bridge.jobs.values()):
            task.cancel()
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP,stop)
    return True
