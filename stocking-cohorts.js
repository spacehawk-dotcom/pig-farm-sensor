(function (root) {
    'use strict';
    function initialCount(record) {
        const value = record?.initialCount;
        return record?.complete === true && Number.isInteger(value) && value >= 0 ? value : null;
    }
    // Capture only direct first entry into an empty pen. Transfers never call this.
    function capture(record, previousCount, enteredCount, otherCurrentCount) {
        if (Number(previousCount) > 0 || !Number.isInteger(enteredCount) || enteredCount <= 0) return null;
        const saved = initialCount(record);
        const complete = saved !== null || (!record && otherCurrentCount === 0);
        return {
            initialCount: (saved ?? Number(record?.initialCount ?? 0)) + enteredCount,
            complete,
            source: record?.source || 'pen-entry'
        };
    }
    root.StockingCohorts = Object.freeze({ initialCount, capture });
    if (typeof module !== 'undefined') module.exports = root.StockingCohorts;
})(typeof window !== 'undefined' ? window : globalThis);
