/* Reference-only thermal model. Never used to command ventilation equipment. */
(function (root) {
    'use strict';
    function number(value) {
        if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
        return Number.isFinite(Number(value)) ? Number(value) : null;
    }
    // Stull (2011), DOI 10.1175/JAMC-D-11-0143.1, Eq. 1, sea-level pressure.
    function wetBulb(t, rh) {
        return t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(t + rh)
            - Math.atan(rh - 1.676331) + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) - 4.686035;
    }
    function estimate(input) {
        const t = number(input.temp), rh = number(input.humidity), v = number(input.speed);
        if ([t, rh, v].includes(null)) return { error: '실내온도·상대습도·돼지 위치 풍속을 모두 입력하세요.' };
        // Conservative application bounds, not a claim of validation throughout this domain.
        if (t < 20 || t > 28) return { error: '이 참고 모델의 앱 계산 범위는 실내온도 20~28℃입니다. 범위 밖에서는 ET 계산을 보류합니다.' };
        if (rh < 5 || rh > 99) return { error: '습도는 습구온도 근사식 범위인 5~99%로 입력하세요.' };
        if (v < 0.2 || v > 1.3) return { error: '이 참고 모델의 앱 계산 범위는 풍속 0.2~1.3m/s입니다. 범위 밖에서는 ET 계산을 보류합니다.' };
        if (input.stage !== 'finisher') return { error: '군사 비육돈 모델입니다. 사육단계를 확인하세요. 자돈·모돈에는 계산을 적용하지 않습니다.' };
        const weight = number(input.weight);
        if (weight === null || weight <= 0) return { error: '위 배치 정보에 평균 체중을 입력하세요.' };
        if (weight < 50 * 0.45359237) return { error: '50lb(약 22.7kg) 미만은 앱에서 자돈으로 분류하여 이 비육돈 ET 계산을 보류합니다.' };
        // Bjerg et al. (2017), Eq. 7 and §2.2.3 group finishing pig scenario:
        // c=.42, d=39, e=1. Body weight does not invent an extra correction.
        const tw = wetBulb(t, rh);
        const humidityPart = 0.794 * t + 0.25 * tw + 0.70 - t;
        const windPart = -0.42 * (39 - t) * (v - 0.2);
        return { et: t + humidityPart + windPart, wetBulb: tw, humidityPart, windPart, delta: humidityPart + windPart };
    }
    // UMN dry-bulb desirable limits. These are NOT ET thresholds.
    function reference(weight) {
        const w = number(weight), lb = 0.45359237;
        if (w === null || w < 12 * lb) return null;
        if (w < 30 * lb) return { label: '자돈 12~30lb', low: (75 - 32) / 1.8, high: (85 - 32) / 1.8 };
        if (w < 50 * lb) return { label: '자돈 30~50lb', low: (70 - 32) / 1.8, high: (80 - 32) / 1.8 };
        return { label: '육성·비육돈 (모돈 제외)', low: 10, high: (75 - 32) / 1.8 };
    }
    function latest(raw, sensor, range) {
        const rows = raw.filter(row => number(row.time) !== null && row.time >= range.start && row.time <= range.end && row.data?.[sensor]);
        rows.sort((a, b) => b.time - a.time);
        if (!rows.length) return null;
        const row = rows[0], data = row.data[sensor];
        let humidity = number(data.humi);
        // Same sensor encoding convention as env.html; show conversion in the UI.
        const scaled = humidity !== null && humidity > 100;
        if (scaled) humidity /= 10;
        return { time: Number(row.time), temp: number(data.temp), humidity, scaled };
    }
    root.PigThermal = { number, wetBulb, estimate, reference, latest };
    if (typeof module !== 'undefined') module.exports = root.PigThermal;
})(typeof globalThis !== 'undefined' ? globalThis : window);
