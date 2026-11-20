(function (root) {
    'use strict';
    const day = value => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
        const time = Date.parse(value + 'T00:00:00Z');
        return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 86400000 : null;
    };
    const sameBatch = (a, b) => a.stage === b.stage && String(a.batchId) === String(b.batchId);
    const clone = b => ({ ...b, penDetails: [...(b.penDetails || [])], penDates: (b.penDetails || []).map((_, i) => b.penDates?.[i] || ''), penIsResidual: (b.penDetails || []).map((_, i) => !!b.penIsResidual?.[i]), penIsSick: (b.penDetails || []).map((_, i) => !!b.penIsSick?.[i]) });
    function plan(sourceBatch, destinationBatch, source, destination, count, date, today) {
        if (!sourceBatch || !destinationBatch) throw new Error('이동할 배치를 찾을 수 없습니다.');
        if (![source, destination].every(p => ['weaning', 'grower'].includes(p.stage) && Number.isInteger(p.penIndex) && p.penIndex >= 0)) throw new Error('돈방을 확인하세요.');
        const src = clone(sourceBatch), same = sameBatch(source, destination), dest = same ? src : clone(destinationBatch);
        if (src.penDetails[source.penIndex] === undefined || dest.penDetails[destination.penIndex] === undefined || (same && source.penIndex === destination.penIndex)) throw new Error('서로 다른 돈방을 선택하세요.');
        if (!Number.isInteger(count) || count <= 0 || count > Number(src.penDetails[source.penIndex])) throw new Error('이동 두수를 현재 두수 이내의 양의 정수로 입력하세요.');
        if (day(date) === null || day(today) === null || date > today) throw new Error('이동 날짜는 오늘 또는 이전 날짜로 입력하세요.');
        const reasonDate = src.penDates[source.penIndex] || src.weaningDate || src.date || '';
        const age = day(reasonDate) === null ? null : day(date) - day(reasonDate) + (source.stage === 'grower' && Number(source.batchId) === 8 ? 1 : 20);
        if (age !== null && day(date) < day(reasonDate)) throw new Error('이동 날짜가 이유/입식 날짜보다 빠릅니다.');
        const destDate = Number(dest.penDetails[destination.penIndex]) > 0 ? (dest.penDates[destination.penIndex] || dest.weaningDate || dest.date || '') : '';
        const finalDate = destDate && reasonDate ? (destDate < reasonDate ? destDate : reasonDate) : destDate || reasonDate;
        src.penDetails[source.penIndex] = Number(src.penDetails[source.penIndex]) - count;
        if (src.penDetails[source.penIndex] === 0) {
            src.penDates[source.penIndex] = '';
            src.penIsResidual[source.penIndex] = false;
            src.penIsSick[source.penIndex] = false;
        }
        dest.penDetails[destination.penIndex] = Number(dest.penDetails[destination.penIndex]) + count;
        dest.penDates[destination.penIndex] = finalDate;
        if (!dest.weaningDate || (finalDate && finalDate < dest.weaningDate)) dest.weaningDate = finalDate;
        const payload = b => ({ penDetails: b.penDetails, penDates: b.penDates,
            penIsResidual: b.penDetails.map((_, i) => !!b.penIsResidual[i]), penIsSick: b.penDetails.map((_, i) => !!b.penIsSick[i]),
            pigs: b.penDetails.reduce((sum, n) => sum + Number(n), 0), pens: b.penDetails.filter(n => n > 0).length,
            status: b.penDetails.some(n => n > 0) ? 'active' : 'empty', weaningDate: b.weaningDate || '' });
        return { sameBatch: same, sourceData: payload(src), destinationData: payload(dest),
            record: { kind: 'transfer', source, destination, count, date, age, reasonDate, createdAt: new Date().toISOString() } };
    }
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const location = p => `${p.stage === 'weaning' ? '이유' : '육성'}${p.batchId} ${Number(p.penIndex) + 1}칸`;
    function rows(records, target) {
        return records.map(r => {
            const internal = r.kind === 'transfer' && sameBatch(r.source, r.destination);
            const direction = r.kind === 'manual' ? r.direction : internal ? 'internal' : sameBatch(r.destination, target) ? 'in' : 'out';
            const detail = r.kind === 'transfer' ? `${location(r.source)} → ${location(r.destination)}` : '직접 기록';
            return `<tr class="border-t border-slate-100"><td class="p-2 whitespace-nowrap">${escape(r.date)}</td><td class="p-2">${{in:'입',out:'출',internal:'내부'}[direction] || '-'}</td><td class="p-2 whitespace-nowrap">${r.age === null || r.age === undefined ? '미상' : escape(r.age) + '일'}</td><td class="p-2 font-bold whitespace-nowrap">${escape(r.count)}두</td><td class="p-2 text-slate-500">${escape(detail)}</td></tr>`;
        }).join('');
    }
    async function mount(host, ref, target, localRecords, today) {
        if (!host) return;
        host.innerHTML = `<h4 class="text-sm font-black text-slate-800 mb-2">돼지 이동 기록</h4><p class="text-[10px] text-slate-500 mb-3">칸 이동 시 양쪽 배치에 자동 기록됩니다. 일령은 이동 당시 기준입니다.</p><details class="mb-3"><summary class="text-xs font-bold text-blue-600 cursor-pointer">과거 이동 기록 직접 추가</summary><div class="grid grid-cols-2 gap-2 mt-2 text-xs"><label>이동 날짜<input data-field="date" type="date" value="${today}" max="${today}" class="w-full border rounded p-2"></label><label>구분<select data-field="direction" class="w-full border rounded p-2"><option value="in">들어옴</option><option value="out">나감</option><option value="internal">배치 내 이동</option></select></label><label>이동 당시 일령<input data-field="age" type="number" min="0" step="1" class="w-full border rounded p-2"></label><label>이동 두수<input data-field="count" type="number" min="1" step="1" class="w-full border rounded p-2"></label></div><p class="text-[10px] text-slate-500 mt-2">직접 추가는 기록만 저장하며 현재 두수는 바꾸지 않습니다.</p><button type="button" data-add class="mt-2 bg-indigo-600 text-white text-xs font-bold rounded-lg px-3 py-2">이동 기록 저장</button></details><p data-status role="status" class="text-xs text-slate-500 mb-2"></p><div class="overflow-x-auto max-h-64"><table class="w-full text-xs text-center"><thead class="bg-slate-100"><tr><th class="p-2">이동 날짜</th><th class="p-2">구분</th><th class="p-2">일령</th><th class="p-2">두수</th><th class="p-2">이동 경로</th></tr></thead><tbody></tbody></table></div><button type="button" data-more class="w-full text-xs text-blue-600 font-bold py-2 hidden">이전 기록 더 보기</button>`;
        const status = host.querySelector('[data-status]'), body = host.querySelector('tbody'), more = host.querySelector('[data-more]'), add = host.querySelector('[data-add]');
        let records = [], cursor = null;
        async function load(reset) {
            more.disabled = true;
            try {
                if (reset) { records = []; cursor = null; }
                if (ref) {
                    let query = ref.collection('transfer_records').orderBy('date', 'desc').limit(20);
                    if (cursor) query = query.startAfter(cursor);
                    const snap = await query.get();
                    records.push(...snap.docs.map(d => d.data()));
                    cursor = snap.docs[snap.docs.length - 1] || cursor;
                    more.classList.toggle('hidden', snap.docs.length < 20);
                } else {
                    records = [...localRecords].sort((a,b) => b.date.localeCompare(a.date));
                    more.classList.add('hidden');
                }
                body.innerHTML = rows(records, target);
                status.textContent = records.length ? '' : '기록된 이동 내역이 없습니다.';
            } catch (e) { status.textContent = '이동 기록 불러오기 실패: ' + e.message; more.textContent = '다시 불러오기'; more.classList.remove('hidden'); }
            finally { more.disabled = false; }
        }
        more.onclick = () => load(false);
        add.onclick = async () => {
            const value = key => host.querySelector(`[data-field="${key}"]`).value;
            const date = value('date'), age = Number(value('age')), count = Number(value('count')), direction = value('direction');
            if (day(date) === null || date > today || value('age').trim() === '' || !Number.isInteger(age) || age < 0 || !Number.isInteger(count) || count <= 0 || !['in','out','internal'].includes(direction)) { status.textContent = '이동 날짜, 일령, 두수를 확인하세요.'; return; }
            add.disabled = true;
            try {
                const record = {kind:'manual', date, age, count, direction, createdAt: new Date().toISOString()};
                if (ref) await ref.collection('transfer_records').doc().set(record);
                else localRecords.push(record);
                host.querySelector('[data-field="count"]').value = '';
                await load(true);
            } catch(e) { status.textContent = '이동 기록 저장 실패: ' + e.message; }
            finally { add.disabled = false; }
        };
        await load(true);
    }
    root.BatchTransfers = Object.freeze({plan, rows, mount});
    if (typeof module !== 'undefined') module.exports = root.BatchTransfers;
})(typeof window !== 'undefined' ? window : globalThis);
