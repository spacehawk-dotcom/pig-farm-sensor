"""Read the interlock reported to Smart Life. Never authorizes or sends a relay command."""
from datetime import datetime, timezone


def read_interlocks(manager, ids, expected):
    """Fetch current account data in one GET. Ignore schema, cached state and other DPs."""
    response = manager.customer_api.get("/v1.0/m/life/ha/devices/detail", {"devIds": ",".join(ids)})
    if not isinstance(response, dict) or response.get("success") is not True or not isinstance(response.get("result"), list):
        raise ValueError("Smart Life device read unavailable")
    result = {}
    for uid in ids:
        matches = [row for row in response["result"] if isinstance(row, dict) and row.get("id")==uid]
        if len(matches)!=1:
            result[uid] = "장치 식별 불가"
            continue
        row = matches[0]
        if row.get("online") is not True:
            result[uid] = "온라인 확인 불가"
            continue
        values = [s.get("value") for s in (row.get("status") or []) if isinstance(s,dict) and s.get("code")=="switch_interlock"]
        result[uid] = ("응답 없음" if not values or values == [None] else
                       "설정 일치" if values == [expected] else "설정 불일치")
    return result


async def account_interlocks(hass, devices, expected):
    states = {batch: "계정에서 장치 확인 불가" for batch in devices}
    for entry in hass.config_entries.async_entries("tuya"):
        manager = getattr(getattr(entry, "runtime_data", None), "manager", None)
        if not manager:
            continue
        selected = [uid for uid in devices.values() if uid in manager.device_map]
        if not selected:
            continue
        try:
            results = await hass.async_add_executor_job(read_interlocks, manager, selected, expected)
        except Exception:
            results = {uid: "Smart Life 조회 실패" for uid in selected}
        for batch, uid in devices.items():
            if uid in results:
                states[batch] = results[uid]
    return states


def supplement(local, reading, expected):
    # Never override a local mismatch, timer, output or availability.
    if not local.get("online") or local.get("interlock") is not None:
        return local
    value = expected if reading=="설정 일치" else "mismatch" if reading=="설정 불일치" else None
    return {**local, "interlock": value}


async def diagnose(hass, devices, expected):
    states = await account_interlocks(hass, devices, expected)
    hass.states.async_set("sensor.sungam_smartlife_interlock_check",
                          sum(v=="설정 일치" for v in states.values()),
                          {"friendly_name": "Smart Life 상호잠금 읽기 진단", "checked_at": datetime.now(timezone.utc).isoformat(), "results": states})
