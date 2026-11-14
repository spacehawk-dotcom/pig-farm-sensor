"""Read-only MQTT forwarding for KOCA feeders; never publishes device commands."""
import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

from aiohttp import ClientTimeout
from homeassistant.components import mqtt
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

LOG = logging.getLogger(__name__)
API = "https://sungamfarm.netlify.app/.netlify/functions/feeders"
KST = timezone(timedelta(hours=9))


def parse_message(topic, payload):
    """Keep the original source timestamp; receiving old data never refreshes it."""
    body = json.loads(payload)
    device_id = int(topic.split("/")[3])
    if not 1 <= device_id <= 72 or int(body["device_id"]) != device_id:
        raise ValueError("device mismatch")
    target, amount = float(body["target_amount"]), float(body["dispensed_amount"])
    # The audited KOCA format puts the amount at [5], NOT [8].
    # Reject disagreement instead of silently presenting a legacy 10 g reading.
    if "raw_data" in body:
        fields = body["raw_data"].split()
        if len(fields) != 16 or amount != float(fields[5]) or target != float(fields[6]):
            raise ValueError("collector field mapping mismatch")
    if not 0 <= amount <= 1000000 or not 0 <= target <= 1000000:
        raise ValueError("invalid amounts")
    sow = str(body["sow_id"]).strip()
    if not sow or len(sow) > 80:
        raise ValueError("invalid sow")
    stamp = datetime.fromisoformat(body["update_time"])
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=KST)
    if stamp.timestamp() > datetime.now(timezone.utc).timestamp() + 60:
        raise ValueError("future timestamp")
    return {"device_id": device_id, "sow_id": sow, "target_amount": target,
            "dispensed_amount": amount, "update_time": stamp.isoformat()}


async def async_setup(hass, config):
    # Reuse the existing, server-verified bridge identity without exposing it to JS.
    secret_path = Path(hass.config.path('.storage/sungam_winch.secret'))
    try:
        token = (await hass.async_add_executor_job(secret_path.read_text)).strip()
    except OSError:
        LOG.error("Existing Sungam bridge identity is missing; see FEEDER-SETUP.md")
        return False
    if not token:
        return False
    rows = {}
    http = async_get_clientsession(hass)

    @callback
    def receive(message):
        try:
            row = parse_message(message.topic, message.payload)
            old = rows.get(row["device_id"])
            if old is None or datetime.fromisoformat(row["update_time"]) >= datetime.fromisoformat(old["update_time"]):
                rows[row["device_id"]] = row
        except (ValueError, TypeError, KeyError, IndexError, OverflowError):
            LOG.warning("KOCA message rejected; check collector format and amount index [5]")

    unsubscribe = await mqtt.async_subscribe(hass, "farm/koca/device/+/eatlog", receive, 0)

    async def send_reports():
        while True:
            try:
                async with http.post(API, json={"rows": list(rows.values())},
                        headers={"X-HA-Bridge": token}, allow_redirects=False,
                        timeout=ClientTimeout(total=10)) as response:
                    response.raise_for_status()
                hass.states.async_set("sensor.sungam_feeder_bridge", len(rows),
                    {"friendly_name": "급이기 전달 상태", "last_forwarded": datetime.now(KST).isoformat()})
            except asyncio.CancelledError:
                raise
            except Exception as error:
                hass.states.async_set("sensor.sungam_feeder_bridge", "unavailable")
                LOG.warning("Feeder report failed (%s); retrying", type(error).__name__)
            await asyncio.sleep(30)

    task = asyncio.create_task(send_reports())

    async def stop(_event):
        unsubscribe()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)
    return True
