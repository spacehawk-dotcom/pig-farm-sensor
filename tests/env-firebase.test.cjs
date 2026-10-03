const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', innerHTML: '', innerText: '', className: '',
            classList: { add() {}, remove() {} },
            insertAdjacentHTML(_where, html) { this.innerHTML += html; },
            getContext() { return {}; }
        });
        return elements.get(id);
    } };
    let resolveLogin;
    const login = new Promise(resolve => { resolveLogin = resolve; });
    let subscribed = false;
    let history = {};
    let chart;
    const alerts = [];
    const ref = {
        on() { subscribed = true; },
        orderByKey() { return this; }, startAt() { return this; }, endAt() { return this; },
        once() { return Promise.resolve({ val: () => history }); }
    };
    const context = vm.createContext({
        document, console, Date, alert: message => alerts.push(message),
        Chart: class { constructor(_ctx, config) { chart = config; } destroy() {} },
        firebase: {
            apps: [{}], database: () => ({ ref: () => ref }),
            firestore: () => ({ collection: () => ({ onSnapshot() {} }) }),
            auth: () => ({ signInAnonymously: () => login })
        }
    });
    const html = fs.readFileSync(path.join(__dirname, '../env.html'), 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
    vm.runInContext(inline, context);
    assert.equal(subscribed, false, 'wait for Firebase authentication');
    resolveLogin();
    await new Promise(setImmediate);
    assert.equal(subscribed, true);
    for (const raw of [null, undefined, '--', '', 'NaN']) assert.equal(context.fixHumidity(raw), '--');
    const today = context.getLocalTodayStr();
    history = { '1': { '외부온도': { timestamp: `${today} 오전 9:00:00`, temp: 25, humi: '--' } } };
    context.openHistory('외부온도');
    await new Promise(setImmediate);
    assert.deepEqual(alerts, [], 'missing humidity must not break history');
    assert.match(document.getElementById('history-table-body').innerHTML, /25.0/);
    assert.equal(chart.data.datasets[1].data[36], null);
    // Daily averaging excludes missing humidity rather than treating it as zero.
    history['2'] = { '외부온도': { timestamp: `${today} 오전 10:00:00`, temp: 26, humi: 60 } };
    document.getElementById('start-date').value = '2026-01-01';
    document.getElementById('end-date').value = '2026-12-31';
    document.getElementById('search-btn').onclick();
    await new Promise(setImmediate);
    assert.equal(chart.data.datasets[2].data[0], 60);
    assert.deepEqual(alerts, []);
    console.log('env Firebase authentication and missing-humidity history checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
