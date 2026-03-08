const fs = require('fs');

async function test() {
    const symbol = 'EURUSD=X';
    const interval = '1h';
    const period1 = Math.floor((Date.now() - 5 * 86400 * 1000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?period1=' + period1 + '&period2=' + period2 + '&interval=' + interval;

    const response = await fetch(url);
    const json = await response.json();
    const timestamps = json.chart.result[0].timestamp;

    const data = timestamps.map(t => ({ time: t }));

    // Test logic
    const timezoneOffset = -3;
    const timeframe = 3600;

    let breaksMT5 = [];
    for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1];
        const curr = data[i];

        const MT5_SERVER_OFFSET_HOURS = 2; // EET
        const prevServerSecs = prev.time + (MT5_SERVER_OFFSET_HOURS * 3600);
        const currServerSecs = curr.time + (MT5_SERVER_OFFSET_HOURS * 3600);

        const prevDay = Math.floor(prevServerSecs / 86400);
        const currDay = Math.floor(currServerSecs / 86400);
        if (currDay !== prevDay) {
            breaksMT5.push({
                time: new Date(curr.time * 1000).toISOString(),
            });
        }
    }
    console.log("MT5 offset breaks:");
    console.table(breaksMT5);

    let breaksLocal = [];
    for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1];
        const curr = data[i];

        const prevSecs = prev.time + (timezoneOffset * 3600);
        const currSecs = curr.time + (timezoneOffset * 3600);

        const prevDay = Math.floor(prevSecs / 86400);
        const currDay = Math.floor(currSecs / 86400);
        if (currDay !== prevDay) {
            breaksLocal.push({
                time: new Date(curr.time * 1000).toISOString(),
            });
        }
    }
    console.log("Local offset breaks:");
    console.table(breaksLocal);
}
test();
