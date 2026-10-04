import unittest
from copy import deepcopy
from datetime import datetime, timezone
from firebase_cycle_archive import plan,encode,fields,room_id

BASE='projects/testproject/databases/(default)/documents/farms/sungamfarm'
NOW=int(datetime(2026,10,4,tzinfo=timezone.utc).timestamp()*1000)
def doc(name,values,rev='v1'):
 return {'name':name,'fields':{k:encode(v) for k,v in values.items()},'updateTime':rev}
class Cycles(unittest.TestCase):
 def setUp(self): self.db={};self.t=NOW
 def run_plan(self,b,snapshot=None):
  grow=doc(BASE+'/grower/batch_1',b)
  states={k:v for k,v in self.db.items() if '/ventilation_cycle_state/' in k}
  cycles={k:v for k,v in self.db.items() if '/ventilation_cycles/' in k and len(k.split('/'))==len(BASE.split('/'))+2}
  writes,result=plan(BASE,[grow],states,cycles,snapshot or {'육성_1배치':{'temp':25},'외부온도':{'temp':18}},self.t)
  self.assertTrue(all('currentDocument' in w for w in writes if 'verify' in w))
  for w in writes:
   if 'update' not in w:continue
   v=w['update'];name=v['name'];data=fields(v);old=fields(self.db[name]) if name in self.db else {}
   if 'samples' in data: old.setdefault('samples',{}).update(data.pop('samples'))
   old.update(data);self.db[name]=doc(name,old,str(self.t))
  self.t+=300000
  return writes,result
 def cycle_rows(self):return [fields(v) for k,v in self.db.items() if '/ventilation_cycles/' in k and len(k.split('/'))==len(BASE.split('/'))+2]
 def test_lifecycle_and_daily_merge(self):
  b={'pigs':30,'growerInDate':'2026-09-01'}
  self.run_plan(b);self.run_plan(b)
  days=[fields(v) for k,v in self.db.items() if '/temperature_days/' in k]
  self.assertEqual(len(days[0]['samples']),2)
  _,r=self.run_plan({**b,'pigs':0,'count':999});self.assertEqual(r['closed'],1);self.assertEqual(r['samples'],0)
  self.assertEqual(self.cycle_rows()[0]['end'],NOW+600000)
  self.run_plan({**b,'pigs':20})
  self.assertEqual(len(self.cycle_rows()),2)
  self.assertEqual(sum(c['end'] is None for c in self.cycle_rows()),1)
 def test_stale_and_missing_data_are_not_zero(self):
  self.run_plan({'pigs':30,'growerInDate':'2026-09-01'})
  _,r=self.run_plan({'growerInDate':'2026-09-01'})
  self.assertEqual(r['closed'],0);self.assertTrue(r['warnings']);self.assertIsNone(self.cycle_rows()[0]['end'])
 def test_changed_stocking_date_without_zero_is_not_merged(self):
  self.run_plan({'pigs':30,'growerInDate':'2026-09-01'})
  writes,r=self.run_plan({'pigs':40,'growerInDate':'2026-10-01'})
  self.assertEqual(writes,[]);self.assertTrue(r['warnings'])
 def test_settings_snapshot_only_when_changed(self):
  b={'pigs':30,'growerInDate':'2026-09-01'}
  self.run_plan(b);self.run_plan(b);self.run_plan({**b,'ventilationOverrides':{'f500_1':{'t':25}}})
  self.assertEqual(len([k for k in self.db if '/settings/' in k]),2)
 def test_invalid_temperature_is_not_saved_as_zero(self):
  _,r=self.run_plan({'pigs':30,'growerInDate':'2026-09-01'},{'육성_1배치':{'temp':'--'}})
  self.assertEqual(r['samples'],0);self.assertEqual(r['active'],1)
 def test_duplicate_room_rejected_before_commit(self):
  docs=[doc(BASE+'/grower/'+name,{'name':'1배치','pigs':1,'growerInDate':'2026-09-01'}) for name in ['a','b']]
  with self.assertRaises(ValueError):plan(BASE,docs,{}, {},{},NOW)
if __name__=='__main__':unittest.main()
class RestFlow(unittest.TestCase):
 def test_reads_and_commit_share_transaction_without_livestock_writes(self):
  from firebase_cycle_archive import sync
  calls=[]
  def request(stage,url,**kw):
   calls.append((url,kw))
   if url.endswith(':beginTransaction'):return {'transaction':'dHg='}
   if '/grower?' in url:return {'documents':[doc(BASE+'/grower/batch_1',{'pigs':20,'growerInDate':'2026-09-01'})]}
   if '/ventilation_cycle_state?' in url:return {}
   if url.endswith(':batchGet'):return []
   if url.endswith(':commit'):return {'writeResults':[]}
   raise AssertionError(url)
  result=sync({'cycle_archive':{'enabled':True,'project_id':'testproject'}},{'육성_1배치':{'temp':25}},datetime.fromtimestamp(NOW/1000,timezone.utc),'test-token',request,RuntimeError)
  self.assertEqual(result['samples'],1)
  self.assertTrue(all('transaction=dHg%3D' in url for url,kw in calls if '?' in url))
  commit=calls[-1][1]['data'];self.assertEqual(commit['transaction'],'dHg=')
  self.assertTrue(all('/grower/' not in w['update']['name'] for w in commit['writes']))
 def test_disabled_has_no_requests(self):
  from firebase_cycle_archive import sync
  self.assertIsNone(sync({}, {},datetime.now(timezone.utc),'',lambda *a,**k:self.fail('Unexpected request'),RuntimeError))
