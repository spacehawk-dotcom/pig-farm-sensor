(function () {
    'use strict';
    const $ = id => document.getElementById(id), T = window.PigThermal;
    const signed = n => (n >= 0 ? '+' : '') + n.toFixed(1);
    function render() {
        const weight = $('pigWeight').value, temp = T.number($('etTemp').value);
        const result = T.estimate({ temp: $('etTemp').value, humidity: $('etHumidity').value,
            speed: $('etSpeed').value, stage: $('etStage').value, weight });
        $('etValue').textContent = result.error ? '—' : result.et.toFixed(1) + ' ℃';
        $('etResult').textContent = result.error || `실내온도 대비 ${signed(result.delta)}℃ · 온습도 항 ${signed(result.humidityPart)}℃ · 풍속 항 ${signed(result.windPart)}℃`;
        $('etResult').className = 'text-sm mt-2 ' + (result.error ? 'text-amber-800' : 'text-teal-900');
        const ref = T.reference(weight);
        $('etReference').textContent = ref ? `${ref.label} · 실내온도 참고 범위 ${ref.low.toFixed(1)}~${ref.high.toFixed(1)}℃.` +
            (temp === null ? '' : ` 입력 실내온도는 참고 범위${temp < ref.low ? '보다 낮습니다' : temp > ref.high ? '보다 높습니다' : ' 안입니다'}.`) +
            ' 일반 건구온도 자료이며 ET의 적정·위험 기준이 아닙니다. 입식 적응기와 농장 상태는 별도 고려하세요.' : '체중을 입력하면 일반 실내온도 참고 범위를 표시합니다. 12lb(약 5.4kg) 미만은 제공하지 않습니다.';
        const wet = $('etFloorWet').checked, floor = $('etFloor').value;
        $('etFloorNote').textContent = (wet ? '젖은 바닥: 접촉·증발에 의한 열손실을 별도로 확인하세요. ' : '') +
            (floor ? `선택 바닥: ${$('etFloor').selectedOptions[0].textContent}. ` : '') +
            '바닥 재질·바닥 온도·복사열은 ET 수치에 미반영입니다. 바닥 상태와 눕는 모습, 몰림, 헐떡임을 함께 확인하세요.';
    }
    function reset() {
        for (const id of ['etTemp', 'etHumidity', 'etSpeed', 'etFloor', 'etStage']) $(id).value = '';
        $('etFloorWet').checked = false;
        $('etSource').textContent = '수동 시나리오 · 같은 시점·같은 위치의 측정값을 입력하세요.';
        render();
    }
    function load(point, sensor) {
        $('etTemp').value = '';
        $('etHumidity').value = '';
        $('etSpeed').value = '';
        if (!point) $('etSource').textContent = '선택 기간에 해당 배치 기록이 없습니다. 직접 입력할 수 있습니다.';
        else {
            $('etTemp').value = point.temp ?? '';
            $('etHumidity').value = point.humidity ?? '';
            const when = new Date(point.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            $('etSource').textContent = `${sensor} · ${when} (한국시간) 기록 · 실시간 측정값이 아닙니다.${point.scaled ? ' 습도는 환경앱과 동일하게 원시값 ÷10 변환.' : ''} 당시 돼지 위치 풍속을 직접 입력하세요.${point.humidity === null ? ' 습도 기록이 없습니다.' : ''}`;
        }
        render();
    }
    for (const id of ['etTemp', 'etHumidity', 'etSpeed']) $(id).addEventListener('input', () => {
        if (id !== 'etSpeed') $('etSource').textContent = '수동 시나리오 · 온습도를 직접 수정했습니다.';
        render();
    });
    for (const id of ['etStage', 'etFloor', 'etFloorWet']) $(id).addEventListener('change', render);
    $('pigWeight').addEventListener('input', render);
    $('etReset').addEventListener('click', reset);
    window.PigThermalUI = { render, reset, load };
    render();
})();
