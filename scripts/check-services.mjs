// Checks NSU's services list (src/lib/nsu/nsu-services.json) and src/lib/nsu/services.js: the data
// is what we expect, links are safe, and lookups work. It also prints each seasonal note as a
// reminder, such as the Freshers Week link that changes every year. No Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-services.mjs

import assert from 'node:assert/strict';
import {
  findService, inChat, NOT_IN_CHAT, serviceById, serviceLink, SERVICE_GROUPS, SERVICES, SERVICES_CHECKED_AT, SERVICES_SOURCE
} from '#lib/nsu/services.js';

/** @type {[string, () => void][]} */
const checks = [
  ['21 services in NSU\'s 5 groups, with unique ids and names, a summary and an https link each', () => {
    assert.deepEqual(SERVICE_GROUPS.map((group) => group.name), ['Help and advice', 'Money and food', 'Get involved', 'Eat, drink and go out', 'About NSU']);
    assert.equal(SERVICES.length, 21);
    assert.equal(new Set(SERVICES.map((service) => service.id)).size, 21);
    assert.equal(new Set(SERVICES.map((service) => service.name.toLowerCase())).size, 21);
    for (const service of SERVICES) {
      assert.match(service.url, /^https:\/\//, service.name);
      assert.ok(service.summary.trim() !== '', `${service.name} has no summary`);
    }
    assert.match(SERVICES_SOURCE, /^https:\/\/mynsu\.co\.uk/);
    assert.equal(SERVICES_CHECKED_AT, '2026-11-17');
  }],
  ['Only Societies opens a page in the app; Help and advice has Wellbeing and the Advice Centre, with 12 https topics', () => {
    assert.deepEqual(SERVICES.filter((service) => service.appPath).map((service) => [service.name, service.appPath]), [['Societies', '/societies']]);
    for (const id of ['wellbeing', 'advice-centre']) assert.equal(serviceById(id)?.group, 'Help and advice', id);
    const advice = serviceById('advice-centre');
    assert.equal(advice?.topics.length, 12);
    assert.ok(advice?.topics.every((topic) => topic.name.trim() !== '' && topic.url.startsWith('https://')));
  }],
  ['The Freshers Week wristband is under Eat, drink and go out, seasonal, and left out of the chat', () => {
    const wristband = serviceById('freshers-week');
    assert.equal(wristband?.name, 'Freshers Week wristband');
    assert.equal(wristband?.group, 'Eat, drink and go out');
    assert.ok(wristband?.seasonal);
    assert.deepEqual(NOT_IN_CHAT, ['freshers-week']);
    assert.equal(inChat(/** @type {any} */ (wristband)), false);
    assert.equal(inChat(/** @type {any} */ (serviceById('events'))), true);
    for (const id of NOT_IN_CHAT) assert.ok(serviceById(id), `${id} isn't a service`);
  }],
  ['Looking up by exact name, and where each link goes', () => {
    assert.equal(findService('food pantry')?.id, 'food-pantry');
    assert.equal(findService('Food'), null, 'part of a name is not enough');
    assert.deepEqual(serviceLink(/** @type {any} */ (serviceById('societies'))), { href: '/societies', external: false });
    assert.deepEqual(serviceLink(/** @type {any} */ (serviceById('food-pantry'))), { href: 'https://mynsu.co.uk/foodpantry', external: true });
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n')[0]}`);
  }
}
const reminders = SERVICES.filter((service) => service.seasonal);
if (reminders.length) {
  console.log('\nSeasonal reminders:');
  for (const service of reminders) console.log(`  ${service.name}: ${service.seasonal}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
