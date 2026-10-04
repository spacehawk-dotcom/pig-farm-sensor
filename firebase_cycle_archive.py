"""Home Assistant cycle archive. Standard library only; invoked by firebase_push.py."""
import json
import math
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import quote, urlencode

KST = timezone(timedelta(hours=9))


def encode(value):
    if value is None: return {"nullValue": None}
    if isinstance(value, bool): return {"booleanValue": value}
    if isinstance(value, int): return {"integerValue": str(value)}
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError("non-finite number")
        return {"doubleValue": value}
    if isinstance(value, str): return {"stringValue": value}
    if isinstance(value, list): return {"arrayValue": {"values": [encode(v) for v in value]}}
    if isinstance(value, dict): return {"mapValue": {"fields": {k: encode(v) for k, v in value.items()}}}
    raise ValueError("unsupported Firestore value")


def decode(value):
    for key in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if key in value: return value[key]
    if "integerValue" in value: return int(value["integerValue"])
    if "nullValue" in value: return None
    if "mapValue" in value: return {k: decode(v) for k,v in value["mapValue"].get("fields", {}).items()}
    if "arrayValue" in value: return [decode(v) for v in value["arrayValue"].get("values", [])]
    return None


def fields(doc):
    return {k: decode(v) for k,v in doc.get("fields", {}).items()}


def count(batch):
    for key in ("pigs", "count", "currentCount", "totalPigs"):
        if batch.get(key) is not None and batch[key] != "":
            try:
                v = float(batch[key])
                return int(v) if math.isfinite(v) and v.is_integer() and v >= 0 else None
            except (ValueError, TypeError): return None
    return None


def stocking(batch):
    value = batch.get("growerInDate", batch.get("date", batch.get("stockDate")))
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value): return None
    try: return int(datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=KST).timestamp()*1000)
    except ValueError: return None


def room_for(doc):
    b=fields(doc)
    match=re.search(r"\d+", str(b.get("name") or b.get("batchName") or b.get("roomName") or doc["name"].rsplit("/",1)[-1]))
    n=int(match[0]) if match else 0
    return f"육성_{n}배치" if 1 <= n <= 7 else None


def room_id(room): return quote(room, safe="-_.!~*'()")


def plan(prefix, growers, states, cycles, snapshot, now):
    """Generate an atomic commit. Preconditions reject stale/concurrent farm edits."""
    writes=[]; warnings=[]; active=closed=samples=0
    seen=set()
    for d in growers:
        room=room_for(d)
        if not room: continue
        if room in seen: raise ValueError("중복 배치 문서입니다. 사육현황을 확인하세요.")
        seen.add(room)
    for d in growers:
        room=room_for(d)
        if not room: continue
        b=fields(d); n=count(b); start=stocking(b)
        if n is None: warnings.append(f"{room}: 두수 확인 불가"); continue
        state_name=prefix+"/ventilation_cycle_state/"+room_id(room)
        sd=states.get(state_name); state=fields(sd) if sd else {}
        if state.get("lastCheckedAt",0) >= now: continue
        ident=state.get("activeId")
        cd=cycles.get(prefix+"/ventilation_cycles/"+ident) if ident else None
        cycle=fields(cd) if cd else None
        if ident and not cycle: warnings.append(f"{room}: 현재 회차 문서 없음"); continue
        if cycle and cycle.get("end") is not None: warnings.append(f"{room}: 종료된 회차 포인터 확인 필요"); continue
        if cycle and n>0 and start is not None and state.get("stockingDate") is not None and state["stockingDate"] != start:
            warnings.append(f"{room}: 0두 확인 없이 입식일 변경됨. 회차를 임의로 합치지 않고 보류합니다."); continue
        if not cycle and n>0:
            if start is None or start>now: warnings.append(f"{room}: 육성사 입식일 확인 필요"); continue
            ident=room_id(room)+"_"+str(start)
            old=cycles.get(prefix+"/ventilation_cycles/"+ident)
            if old and fields(old).get("end") is None:
                cd=old;cycle=fields(old)
            else:
                if old: ident+="_"+str(now)
                cycle={"id":ident,"room":room,"start":start,"end":None,"status":"active","batchId":d["name"].rsplit("/",1)[-1],"startBasis":"입식일","createdAt":now}
        def update(name, values, mask=None, precondition=None):
            w={"update":{"name":name,"fields":{k:encode(v) for k,v in values.items()}},"updateMask":{"fieldPaths":mask or list(values)}}
            if precondition is not None: w["currentDocument"]=precondition
            writes.append(w)
        state_pre={"updateTime":sd["updateTime"]} if sd else {"exists":False}
        if cycle:
            name=prefix+"/ventilation_cycles/"+ident
            pre={"updateTime":cd["updateTime"]} if cd else {"exists":False}
            if n==0:
                cycle.update(end=now,status="closed",lastCount=0,endBasis="Home Assistant에서 0두 확인 시각",lastPositiveAt=state.get("lastPositiveAt"))
                closed+=1
            else:
                cycle.update(lastCount=n,status="active",lastCheckedAt=now,collector="home_assistant")
                active+=1
            update(name,cycle,precondition=pre)
            signature=json.dumps({"count":n,"overrides":b.get("ventilationOverrides") or {}},sort_keys=True,ensure_ascii=False)
            if signature!=state.get("settingsSignature"):
                update(name+"/settings/"+str(now),{"time":now,"count":n,"overrides":b.get("ventilationOverrides") or {},"source":"app_shared_overrides","note":"HA에서 확인한 앱 공유 수정값. 실제 컨트롤러 확인 기록과 별도."})
            raw=snapshot.get(room,{}).get("temp")
            # At zero heads no further temperatures are assigned to the departed cohort.
            if n>0 and isinstance(raw,(int,float)) and not isinstance(raw,bool) and math.isfinite(raw):
                out=snapshot.get("외부온도",{}).get("temp")
                outside=out if isinstance(out,(int,float)) and not isinstance(out,bool) and math.isfinite(out) else None
                day=datetime.fromtimestamp(now/1000,KST).strftime("%Y-%m-%d")
                update(name+"/temperature_days/"+day,{"day":day,"samples":{str(now):{"time":now,"inside":raw,"outside":outside}}},["day",f"samples.`{now}`"])
                samples+=1
            state.update(activeId=ident if n else None,settingsSignature=signature)
        state.update(room=room,lastCheckedAt=now,collector="home_assistant",stockingDate=start)
        if n>0: state["lastPositiveAt"]=now
        update(state_name,state,precondition=state_pre)
    return writes,{"active":active,"closed":closed,"samples":samples,"warnings":warnings}


def sync(config, snapshot, now, token, request, error):
    settings=config.get("cycle_archive") or {}
    if not isinstance(settings,dict): raise error("[회차 설정] cycle_archive는 JSON 객체여야 합니다.")
    if not settings.get("enabled",False): return None
    project=settings.get("project_id","sungamfarm")
    if not isinstance(project,str) or not re.fullmatch(r"[a-z][a-z0-9-]{4,62}",project): raise error("[회차 설정] project_id를 확인하세요.")
    root=f"projects/{project}/databases/(default)/documents"
    prefix=root+"/farms/sungamfarm";url="https://firestore.googleapis.com/v1/"+root
    headers={"Authorization":"Bearer "+token}
    transaction=(request("회차 조회",url+":beginTransaction",headers=headers,method="POST",data={"options":{"readWrite":{}}}) or {}).get("transaction")
    if not transaction: raise error("[회차 조회] Firestore 트랜잭션을 시작하지 못했습니다.")
    def listing(collection):
        result=[];page=None
        while True:
            params={"pageSize":1000,"transaction":transaction}
            if page: params["pageToken"]=page
            response=request("회차 조회",url+"/farms/sungamfarm/"+collection+"?"+urlencode(params),headers=headers) or {}
            result.extend(response.get("documents",[]));page=response.get("nextPageToken")
            if not page:return result
    committed=False
    try:
        growers=listing("grower");states={d["name"]:d for d in listing("ventilation_cycle_state")}
        names=set()
        for d in growers:
            room=room_for(d)
            if not room:continue
            st=fields(states.get(prefix+"/ventilation_cycle_state/"+room_id(room),{}))
            if st.get("activeId"):names.add(prefix+"/ventilation_cycles/"+st["activeId"])
            start=stocking(fields(d))
            if start is not None:names.add(prefix+"/ventilation_cycles/"+room_id(room)+"_"+str(start))
        rows=request("회차 조회",url+":batchGet",headers=headers,method="POST",data={"documents":sorted(names),"transaction":transaction}) if names else []
        if not isinstance(rows,list):raise error("[회차 조회] Firestore batchGet 응답 형식을 확인하세요.")
        cycles={row["found"]["name"]:row["found"] for row in rows if "found" in row}
        try:writes,result=plan(prefix,growers,states,cycles,snapshot,int(now.timestamp()*1000))
        except ValueError as exc:raise error("[회차 처리] "+str(exc)) from None
        request("회차 저장",url+":commit",headers=headers,method="POST",data={"writes":writes,"transaction":transaction})
        committed=True
        return result
    finally:
        if not committed:
            try: request("회차 조회",url+":rollback",headers=headers,method="POST",data={"transaction":transaction})
            except Exception: pass  # Preserve original error; unfinished transactions expire.
