const DB_NAME = 'ForexSimulatorDB';
const DB_VERSION = 1;

/**
 * Native IndexedDB Implementation without external dependencies.
 */
export const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (e) => reject(`IndexedDB Error: ${e.target.error}`);

        request.onsuccess = (e) => resolve(e.target.result);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('candles')) {
                const store = db.createObjectStore('candles', {
                    keyPath: ['symbol', 'timeframe', 'time']
                });
                store.createIndex('by_symbol_tf', ['symbol', 'timeframe']);
                store.createIndex('by_symbol_tf_time', ['symbol', 'timeframe', 'time']);
            }
        };
    });
};

export const saveHistoricalData = async (symbol, timeframe, candles) => {
    if (!candles || candles.length === 0) return;

    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('candles', 'readwrite');
        const store = tx.objectStore('candles');

        tx.oncomplete = () => {
            console.log(`[Storage] Successfully saved/upserted ${candles.length} candles for ${symbol}`);
            resolve();
        };
        tx.onerror = (e) => reject(e.target.error);

        for (const candle of candles) {
            store.put({
                symbol: symbol.toUpperCase(),
                timeframe: Number(timeframe),
                ...candle
            });
        }
    });
};

export const getHistoricalData = async (symbol, timeframe, startTime, endTime) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('candles', 'readonly');
        const store = tx.objectStore('candles');
        const index = store.index('by_symbol_tf_time');

        // Prevent DataError: The lower key is greater than the upper key
        const safeStart = Math.min(startTime, endTime);
        const safeEnd = Math.max(startTime, endTime);

        const range = IDBKeyRange.bound(
            [symbol.toUpperCase(), Number(timeframe), safeStart],
            [symbol.toUpperCase(), Number(timeframe), safeEnd]
        );

        const request = index.getAll(range);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e.target.error);
    });
};

export const getStoredDateRange = async (symbol, timeframe) => {
    const db = await initDB();

    const getCount = () => new Promise((resolve, reject) => {
        const tx = db.transaction('candles', 'readonly');
        const store = tx.objectStore('candles');
        const index = store.index('by_symbol_tf_time');
        const range = IDBKeyRange.bound(
            [symbol.toUpperCase(), Number(timeframe), 0],
            [symbol.toUpperCase(), Number(timeframe), Infinity]
        );
        const req = index.count(range);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });

    const getExtremes = () => new Promise((resolve, reject) => {
        const tx = db.transaction('candles', 'readonly');
        const store = tx.objectStore('candles');
        const index = store.index('by_symbol_tf_time');
        const range = IDBKeyRange.bound(
            [symbol.toUpperCase(), Number(timeframe), 0],
            [symbol.toUpperCase(), Number(timeframe), Infinity]
        );

        let minTime = null;
        let maxTime = null;

        const reqMin = index.openCursor(range, 'next');
        reqMin.onsuccess = (e) => {
            const cursor = e.target.result;
            minTime = cursor ? cursor.value.time : null;

            const reqMax = index.openCursor(range, 'prev');
            reqMax.onsuccess = (e2) => {
                const cursorMax = e2.target.result;
                maxTime = cursorMax ? cursorMax.value.time : null;
                resolve({ minTime, maxTime });
            };
            reqMax.onerror = (e2) => reject(e2.target.error);
        };
        reqMin.onerror = (e) => reject(e.target.error);
    });

    try {
        const count = await getCount();
        if (count === 0) return { minTime: null, maxTime: null, count: 0 };
        const { minTime, maxTime } = await getExtremes();
        return { minTime, maxTime, count };
    } catch (e) {
        console.error("Error getting stored date range:", e);
        return { minTime: null, maxTime: null, count: 0 };
    }
};

export const clearHistoricalData = async (symbol, timeframe) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('candles', 'readwrite');
        const store = tx.objectStore('candles');
        const index = store.index('by_symbol_tf');

        const range = IDBKeyRange.only([symbol.toUpperCase(), Number(timeframe)]);
        const request = index.openCursor(range);

        let deletedCount = 0;

        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                deletedCount++;
                cursor.continue();
            } else {
                console.log(`[Storage] Cleared ${deletedCount} records for ${symbol}`);
                resolve(deletedCount);
            }
        };

        request.onerror = (e) => reject(e.target.error);
    });
};
