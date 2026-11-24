(function (root) {
    'use strict';
    function timestamp(value) {
        if (!value) return null;
        if (typeof value.seconds === 'number') return [value.seconds, value.nanoseconds || 0];
        return value;
    }
    function revision(memo) {
        return JSON.stringify([memo.title, memo.content, timestamp(memo.createdAt), timestamp(memo.updatedAt)]);
    }
    async function save({db, sdk, original, title, content}) {
        if (!original || typeof original.id !== 'string' || !original.id || original.id.includes('/')) {
            throw new Error('memo-missing');
        }
        title = title.trim(); content = content.trim();
        if (!title || !content) throw new Error('memo-empty');
        const ref = sdk.doc(db, 'farms', 'sungamfarm', 'farmMemos', original.id);
        await sdk.runTransaction(db, async transaction => {
            const current = await transaction.get(ref);
            if (!current.exists()) throw new Error('memo-missing');
            if (revision(current.data()) !== revision(original)) throw new Error('memo-conflict');
            // Keep the document ID, creation date, and every unrelated field intact.
            transaction.update(ref, {title, content, updatedAt: sdk.serverTimestamp()});
        });
    }
    const api = {save, revision};
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FarmMemoEdit = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
