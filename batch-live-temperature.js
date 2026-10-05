(function (root) {
    'use strict';
    let readings = {}, status = 'loading', connected = false, started = false;

    function refresh() {
        document.querySelectorAll('[data-batch-temperature]').forEach(node => {
            const sensor = node.dataset.batchTemperature;
            const reading = readings[sensor];
            const raw = reading?.temp;
            const valid = (typeof raw === 'number' || typeof raw === 'string') &&
                String(raw).trim() !== '' && Number.isFinite(Number(raw));
            const available = status === 'ready' && valid;
            const label = available ? Number(raw).toFixed(1) + '℃' : '--℃';
            const detail = status === 'error' ? '온도 연결 실패' : status === 'loading' ? '온도 수신 중' :
                !connected ? '연결 끊김 · 마지막 수신값' : !valid ? '온도 데이터 없음' : '실시간 온도';
            node.textContent = label;
            node.className = 'batch-live-temperature' + (available && connected ? ' is-ready' : '');
            node.title = `${sensor.replace('_', ' ')} · ${detail}${reading?.timestamp ? ' · 측정: ' + reading.timestamp : ''}`;
            node.setAttribute('aria-label', `${sensor.replace('_', ' ')} ${label} · ${detail}`);
        });
    }

    function start(database) {
        if (started) return;
        started = true;
        const fail = error => {
            console.error('배치 실시간 온도 연결 실패:', error);
            status = 'error';
            refresh();
        };
        try {
            database.ref('.info/connected').on('value', snapshot => {
                connected = snapshot.val() === true;
                refresh();
            });
            database.ref('sensor_logs').on('value', snapshot => {
                readings = snapshot.val() || {};
                status = 'ready';
                refresh();
            }, fail);
        } catch (error) { fail(error); }
    }

    root.BatchLiveTemperature = { start, refresh };
})(window);
