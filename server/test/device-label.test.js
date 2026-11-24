// Device names on the Account page (server/accounts.js deviceLabel): short "OS · browser" from real user agents.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { deviceLabel } = require('../accounts');

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneZalo: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/24.06.01 ZaloTheme/light ZaloLanguage/vi',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/1;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/vi_VN;FBOP/5]',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidCocCoc: 'Mozilla/5.0 (Linux; Android 13; M2101K6G) AppleWebKit/537.36 (KHTML, like Gecko) coc_coc_browser/130.0.248 Chrome/124.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

test('deviceLabel: common phones, desktops and in-app browsers', () => {
  assert.equal(deviceLabel(UA.iphoneSafari), 'iPhone · Safari');
  assert.equal(deviceLabel(UA.iphoneChrome), 'iPhone · Chrome');
  assert.equal(deviceLabel(UA.iphoneZalo), 'iPhone · Zalo');
  assert.equal(deviceLabel(UA.iphoneFacebook), 'iPhone · Facebook');
  assert.equal(deviceLabel(UA.androidChrome), 'Android · Chrome');
  assert.equal(deviceLabel(UA.androidSamsung), 'Android · Samsung Internet');
  assert.equal(deviceLabel(UA.androidCocCoc), 'Android · Cốc Cốc');
  assert.equal(deviceLabel(UA.macSafari), 'Mac · Safari');
  assert.equal(deviceLabel(UA.macChrome), 'Mac · Chrome');
  assert.equal(deviceLabel(UA.winEdge), 'Windows · Edge');
  assert.equal(deviceLabel(UA.winFirefox), 'Windows · Firefox');
  assert.equal(deviceLabel(UA.ipad), 'iPad · Safari');
  assert.equal(deviceLabel(UA.chromebook), 'Chromebook · Chrome');
});
test('deviceLabel: unknown parts fall back; never returns the raw string', () => {
  assert.equal(deviceLabel(''), 'Thiết bị khác · Trình duyệt');
  assert.equal(deviceLabel(undefined), 'Thiết bị khác · Trình duyệt');
  assert.equal(deviceLabel('node'), 'Thiết bị khác · Trình duyệt');
  assert.ok(deviceLabel(UA.winEdge).length < 30);
});
