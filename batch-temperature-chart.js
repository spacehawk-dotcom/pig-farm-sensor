(function (root) {
    'use strict';
    let chart = null;
    function destroy() {
        if (chart) chart.destroy();
        chart = null;
    }
    const formatTime = time => root.VentCore.toKoreanInput(time).slice(5).replace('T', ' ');

    function render(batch, settings, history, status) {
        const canvas = document.getElementById('batch-temp-chart');
        const message = document.getElementById('batch-temp-status');
        if (!canvas || !message) return;
        destroy();
        if (!root.Chart) {
            message.textContent = '그래프를 불러오지 못했습니다. 연결을 확인한 뒤 새로고침하세요.';
            return;
        }
        const hours = Number(document.getElementById('batch-temp-period').value) || 24;
        const end = Date.now(), start = end - hours * 3600000;
        const sensor = `${batch.type === '이유사' ? '이유' : '육성'}_${batch.id}배치`;
        const points = status === 'ready' ? root.VentCore.normalize(history, sensor, { start, end }) : [];
        const inside = [], outside = [];
        points.forEach((point, index) => {
            if (index && point.time - points[index - 1].time > 1800000) {
                inside.push({ x: points[index - 1].time + 1, y: null });
                outside.push({ x: points[index - 1].time + 1, y: null });
            }
            inside.push({ x: point.time, y: point.inTemp });
            outside.push({ x: point.time, y: point.outTemp });
        });
        const target = settings ? [{ x: start, y: settings.t1 }, { x: end, y: settings.t1 }] : [];
        chart = new root.Chart(canvas, {
            type: 'line',
            data: { datasets: [
                { label: '🔥실내 온도', data: inside, borderColor: '#ef4444', borderWidth: 2, pointRadius: points.length === 1 ? 3 : 0, pointHoverRadius: 5 },
                { label: '🎯1그룹 설정온도', data: target, borderColor: '#22c55e', borderWidth: 1.5, borderDash: [5, 5], pointRadius: 0 },
                { label: '❄️외기 온도', data: outside, borderColor: '#94a3b8', borderWidth: 1.5, borderDash: [3, 3], pointRadius: points.length === 1 ? 3 : 0, pointHoverRadius: 5 }
            ] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                elements: { line: { tension: 0, spanGaps: false } },
                scales: {
                    x: { type: 'linear', min: start, max: end, grid: { display: false }, ticks: {
                        color: '#64748b', maxRotation: 0, maxTicksLimit: 4,
                        callback: value => formatTime(Number(value))
                    } },
                    y: { ticks: { color: '#ef4444', callback: value => value + '℃' } }
                },
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 10 } } },
                    tooltip: {
                        backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#1e293b', bodyColor: '#334155',
                        borderColor: '#cbd5e1', borderWidth: 1, padding: 10, usePointStyle: true,
                        callbacks: {
                            title: items => items.length ? formatTime(items[0].parsed.x) + ' KST' : '',
                            label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(1)}℃`
                        }
                    }
                }
            }
        });
        message.textContent = status === 'error' ? '온도 기록 연결 실패 · 다시 연결되면 자동으로 표시됩니다.'
            : status !== 'ready' ? '온도 기록을 불러오는 중입니다.'
            : points.length ? `${sensor.replace('_', ' ')} · ${formatTime(start)} ~ ${formatTime(end)} (한국시간) · 실내 ${points.length}건${points.some(p => p.outTemp !== null) ? '' : ' · 외기 기록 없음'}`
            : '선택 기간에 이 배치의 온도 기록이 없습니다.';
    }
    root.BatchTemperatureChart = { render, destroy };
})(window);
