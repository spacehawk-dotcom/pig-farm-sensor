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
from custom_components.localtuya.core.pytuya import CMDType
from .smartlife_diagnostic import account_interlocks, diagnose, supplement

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
INTERLOCK = "AA8AAAAAAAA="


class Bridge:
    def __init__(self, hass, token, smartlife_guard=False):
        self.hass = hass
        self.token = token
        self.session = secrets.token_hex(32)
        self.http = async_get_clientsession(hass)
        self.jobs = {}
        self.last_ticket = {}
        self.changed = asyncio.Event()
        self.samples = {}
        self.smartlife_guard = smartlife_guard
        self.cloud_readings = {}
        self.cloud_at = 0
        self.probe_locks = {batch:asyncio.Lock() for batch in DEVICES}

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
        result = dict(online=False, up=None, down=None, timer=None, interlock=None)
        try:
            device, entities, channels = self.equipment(batch)
            values = device._status if values is None else values
            outputs = [values.get(ch) for ch in channels]
            for entity, value in zip(entities, outputs):
                state = self.hass.states.get(entity)
                if type(value) is not bool or not state or state.state != ("on" if value else "off"):
                    return result
            # Only use an interlock DP identified for this exact device model.
            interlock = values.get("48")
            result.update(online=True, up=outputs[0], down=outputs[1],
                          timer=values.get("44"), interlock=interlock)
        except (AttributeError, KeyError, ValueError, TypeError):
            pass
        return result

    async def live(self, batch):
        async with self.probe_locks[batch], asyncio.timeout(4):
            device, _, _ = self.equipment(batch)
            interface = device._interface
            reply = await interface.exchange(command=CMDType.DP_QUERY)
            if not isinstance(reply, dict) or not isinstance(reply.get("dps"), dict):
                raise ValueError("no local relay response")
            values = dict(reply["dps"])
            if "48" not in values:
                requested = {k:None for k in ("1","2","3","44","48")}
                try:
                    async with asyncio.timeout(1):
                        detail = await interface.exchange(CMDType.DP_QUERY, requested)
                    if isinstance(detail,dict):
                        values.update(detail.get("dps",{}))
                except TimeoutError:
                    pass
            if "48" not in values:
                try:
                    async with asyncio.timeout(1):
                        detail = await interface.exchange(CMDType.UPDATEDPS,[44,48])
                    if isinstance(detail,dict):
                        values.update(detail.get("dps",{}))
                except TimeoutError:
                    pass
            if batch=="2" and not getattr(self,"logged_probe",False):
                LOG.warning("LocalTuya read-only probe, returned DP numbers: %s; timer=%s; interlock=%s",
                            sorted(values), values.get("44"),values.get("48"))
                self.logged_probe = True
            self.samples[batch] = (time.monotonic(),self.current(batch,values))
            return self.samples[batch][1]

    async def sample(self,batch):
        try:
            await self.live(batch)
        except Exception as err:
            if batch=="2":
                LOG.warning("LocalTuya read-only probe unavailable: %s",type(err).__name__)
            self.samples.pop(batch,None)

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
            state = await self.live(batch)
            if any(isinstance(r, BaseException) for r in replies) or (state["up"], state["down"]) != (False, False):
                raise ValueError("stop unconfirmed")
            return
        if action not in ("up", "down"):
            raise ValueError("unknown action")
        def ready(s):
            if not s["online"] or s["up"] is not False or s["down"] is not False or s["interlock"] != INTERLOCK or s["timer"] != (TIMER_2 if batch=="2" else TIMER):
                raise ValueError("relay or safety mismatch")
        async def checked():
            state = await self.live(batch)
            if self.smartlife_guard and state["online"] and state["interlock"] is None:
                fresh()
                async with asyncio.timeout(min(3, max(0,(expires-time.time()*1000)/1000))):
                    result = await account_interlocks(self.hass, {batch:DEVICES[batch]}, INTERLOCK)
                state = supplement(state, result.get(batch), INTERLOCK)
            ready(state)
        await checked()
        for entity in entities:
            await self.relay("turn_off", entity)
        await asyncio.sleep(0.6)
        await checked()
        fresh()
        await self.relay("turn_on", entities[0 if action=="up" else 1])
        # Confirm the one intended output and the opposite OFF; never retry ON.
        state = await self.live(batch)
        if state[action] is not True or state["down" if action=="up" else "up"] is not False:
            raise ValueError("movement unconfirmed")

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
            LOG.warning("Batch %s command unconfirmed (%s)", batch, type(err).__name__)

    def wake(self, batch, value):
        if batch not in DEVICES or not isinstance(value, dict):
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
                        if not line.startswith(b"data: ") or len(line)>8192:
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
        previous, last = None, 0
        while True:
            if time.monotonic() - getattr(self,"last_probe",-100) > 45:
                await asyncio.gather(*(self.sample(b) for b in DEVICES))
                if self.smartlife_guard:
                    missing = {b: DEVICES[b] for b,(_,s) in self.samples.items() if s["online"] and s["interlock"] is None}
                    self.cloud_readings = {}
                    if missing:
                        try:
                            async with asyncio.timeout(5):
                                self.cloud_readings = await account_interlocks(self.hass, missing, INTERLOCK)
                            self.cloud_at = time.monotonic()
                        except TimeoutError:
                            pass
                self.last_probe = time.monotonic()
            states = {}
            for b in DEVICES:
                current = self.current(b)
                at,sample = self.samples.get(b,(0,{}))
                if current["online"] and time.monotonic()-at < 70 and sample.get("online"):
                    current.update(timer=sample["timer"],interlock=sample["interlock"])
                    if self.smartlife_guard and time.monotonic()-self.cloud_at < 70:
                        current = supplement(current, self.cloud_readings.get(b), INTERLOCK)
                else:
                    current.update(timer=None,interlock=None)
                states[b] = current
            if states != previous:
                self.hass.states.async_set("sensor.sungam_winch_bridge",sum(s["online"] for s in states.values()),{
                    "friendly_name":"LocalTuya winches", "interlock_dp":48,
                    "timer_received":[b for b,s in states.items() if s["timer"]],
                    "interlock_received":[b for b,(_,s) in self.samples.items() if s["online"] and s["interlock"]],
                    "smartlife_guard_enabled":self.smartlife_guard,
                    "smartlife_guard_batches":[b for b,s in states.items() if self.smartlife_guard and s["interlock"]==INTERLOCK
                        and self.samples.get(b,(0,{}))[1].get("interlock") is None],
                    "verified":[b for b,s in states.items() if s["interlock"]==INTERLOCK and s["timer"]==(TIMER_2 if b=="2" else TIMER)]})
            if states != previous or time.monotonic()-last>55:
                try:
                    await self.post("report", states=states, smartlifeGuard=self.smartlife_guard)
                    previous,last = states,time.monotonic()
                except Exception as err:
                    LOG.debug("State report unavailable (%s)",type(err).__name__)
                    await asyncio.sleep(5)
            try:
                await asyncio.wait_for(self.changed.wait(),timeout=1)
            except TimeoutError:
                pass
            self.changed.clear()


async def async_setup(hass, config):
    token = await hass.async_add_executor_job(Path(hass.config.path(".storage/sungam_winch.secret")).read_text)
    options = config.get("sungam_winch") or {}
    bridge = Bridge(hass,token.strip(),options.get("smartlife_interlock") is True)
    async def check_smartlife(call):
        await diagnose(hass, DEVICES, INTERLOCK)
    hass.services.async_register("sungam_winch","check_smartlife_interlock",check_smartlife)
    jobs = [asyncio.create_task(bridge.listen()),asyncio.create_task(bridge.report())]
    async def stop(event):
        for task in jobs + list(bridge.jobs.values()):
            task.cancel()
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP,stop)
    return True
