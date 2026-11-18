// Checks the settling-in checklist:
// 1. The rules for tasks (src/lib/checklist/tasks.js): defaults, add, tick, edit, delete, limits,
//    and the saved format the check-in chat reads. Runs in Node with nothing else needed.
// 2. Keeping the screen in step with saving (src/lib/checklist/sync.js), with a pretend server.
// 3. Against the real Firestore, with two test students: student 1 can save, a change made from an
//    out-of-date copy doesn't wipe a newer one, a tick saved as the page saves it is what the shared
//    loader (and so the chat) reads, the rules refuse 51 tasks, a title over 100 characters and an
//    extra field but accept a full list, and student 2 can't read or change student 1's checklist.
//    Publish firestore.rules first. This part only runs if both students' logins are in
//    .env.test.local (git ignores it):
//      TEST_STUDENT_EMAIL=...       TEST_STUDENT_PASSWORD=...
//      TEST_STUDENT2_EMAIL=...      TEST_STUDENT2_PASSWORD=...
//    It changes student 1's checklist while it runs, and puts it back at the end.
//
// Run from the project folder:
//   node --env-file=.env --env-file=.env.test.local scripts/check-checklist.mjs
// (or just `node scripts/check-checklist.mjs` for parts 1 and 2 only)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyChange, applyToLatest, ChecklistError, DEFAULT_TASKS, defaultTasks, makeAdd, makeDelete,
  makeEdit, makeTick, MAX_TASKS, MAX_TITLE_LENGTH, readSaved, checklistFrom, withNewDefaults
} from '#lib/checklist/tasks.js';
import { createChecklistSync } from '#lib/checklist/sync.js';

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {() => unknown} check */
async function check(name, check) {
  try {
    await check();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}
/** @param {() => unknown} action @param {string} message */
function refuses(action, message) {
  assert.throws(action, (err) => err instanceof ChecklistError && err.message === message);
}
const ids = (/** @type {{ id: string }[]} */ list) => list.map((task) => task.id);
/** Whether the task with this id is ticked in a list. @param {{ id: string, done: boolean }[]} list @param {string} id */
const done = (list, id) => list.find((task) => task.id === id)?.done;

// ---------------------------------------------------------------- 1. Tasks
console.log('-- 1. Tasks (tasks.js)');
await check('Six defaults with fixed ids, Enrol first, none done', () => {
  assert.deepEqual(ids(defaultTasks()), ['enrol', 'gp', 'student-id', 'society', 'dentist', 'contacts']);
  assert.ok(defaultTasks().every((task) => task.done === false));
});
await check('defaultTasks() gives fresh copies: ticking one never changes the defaults', () => {
  const copy = defaultTasks();
  copy[0].done = true;
  assert.equal(DEFAULT_TASKS[0].done, false);
  assert.equal(defaultTasks()[0].done, false);
});
await check('Adding: trimmed, given its own "own-" id, added at the end', () => {
  const change = makeAdd('  Buy a desk lamp  ');
  assert.equal(change.type, 'add');
  const list = applyChange(defaultTasks(), change);
  assert.equal(list.length, 7);
  assert.deepEqual(list.at(-1), { id: change.type === 'add' ? change.task.id : '', title: 'Buy a desk lamp', done: false });
  assert.match(list.at(-1)?.id ?? '', /^own-/);
  assert.notEqual(/** @type {any} */ (makeAdd('a')).task.id, /** @type {any} */ (makeAdd('a')).task.id);
});
await check(`Adding: empty and over-${MAX_TITLE_LENGTH}-character names are refused; exactly ${MAX_TITLE_LENGTH} is fine`, () => {
  refuses(() => makeAdd('   '), 'Please give the task a name.');
  refuses(() => makeAdd('x'.repeat(MAX_TITLE_LENGTH + 1)), `Task names can be up to ${MAX_TITLE_LENGTH} characters.`);
  assert.equal(/** @type {any} */ (makeAdd('x'.repeat(MAX_TITLE_LENGTH))).task.title.length, MAX_TITLE_LENGTH);
});
await check(`firestore.rules checks exactly ${MAX_TASKS} places, so the rules and the app agree on the limit`, () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  const body = rules.slice(rules.indexOf('function validChecklist('), rules.indexOf('}', rules.indexOf('function validChecklist(')));
  assert.match(body, new RegExp(`tasks\\.size\\(\\) <= ${MAX_TASKS}\\n`), 'the size check');
  const places = [...body.matchAll(/tasks\.size\(\) <= (\d+) \|\| validTask\(tasks\[(\d+)\]\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(places, Array.from({ length: MAX_TASKS }, (_, i) => [i, i]));
});
await check(`Adding: task number ${MAX_TASKS + 1} is refused`, () => {
  let list = defaultTasks();
  while (list.length < MAX_TASKS) list = applyChange(list, makeAdd(`Task ${list.length}`));
  refuses(() => applyChange(list, makeAdd('One too many')), `You can have up to ${MAX_TASKS} tasks.`);
});
await check('Adding the same task twice (a retry) only adds it once', () => {
  const change = makeAdd('Buy a desk lamp');
  assert.equal(applyChange(applyChange(defaultTasks(), change), change).length, 7);
});
await check('Ticking and unticking; ticking a task that has gone changes nothing', () => {
  const gp = (/** @type {{ id: string, done: boolean }[]} */ list) => list.find((task) => task.id === 'gp')?.done;
  const ticked = applyChange(defaultTasks(), makeTick('gp', true));
  assert.equal(gp(ticked), true);
  assert.equal(gp(applyChange(ticked, makeTick('gp', false))), false);
  assert.deepEqual(applyChange(ticked, makeTick('gone', true)), ticked);
});
await check('Editing: your own tasks can be renamed; the defaults and empty names are refused', () => {
  const add = /** @type {any} */ (makeAdd('Buy a lamp'));
  const list = applyChange(defaultTasks(), add);
  assert.equal(applyChange(list, makeEdit(add.task.id, 'Buy a desk lamp')).at(-1)?.title, 'Buy a desk lamp');
  refuses(() => makeEdit('gp', 'Something else'), 'The standard tasks can’t be renamed, but you can delete them.');
  refuses(() => makeEdit(add.task.id, ''), 'Please give the task a name.');
});
await check('Deleting, including a default; deleting one that has gone changes nothing', () => {
  const list = applyChange(defaultTasks(), makeDelete('society'));
  assert.deepEqual(ids(list), ['enrol', 'gp', 'student-id', 'dentist', 'contacts']);
  assert.deepEqual(applyChange(list, makeDelete('society')), list);
});
await check('Reading a saved list: nothing saved gives null; badly formed tasks are dropped', () => {
  assert.equal(readSaved(undefined), null);
  assert.equal(readSaved('not a list'), null);
  assert.deepEqual(readSaved([{ id: 'gp', title: 'Register with a GP', done: true }, { id: 7 }, null, { id: 'x', title: 'X' }]), [
    { id: 'gp', title: 'Register with a GP', done: true },
    { id: 'x', title: 'X', done: false }
  ]);
});
await check('The page and the chat read the checklist the same way: what\'s saved (with Enrol, once), or the six defaults, unticked, marked as never saved', () => {
  const saved = checklistFrom({ checklist: [{ id: 'gp', title: 'Register with a GP', done: true }], checklistOffered: ['enrol'], course: 'Law' });
  assert.deepEqual(saved, { tasks: [{ id: 'gp', title: 'Register with a GP', done: true }], saved: true });
  for (const record of [undefined, {}, { checklist: 'not a list' }]) {
    const fresh = checklistFrom(/** @type {any} */ (record));
    assert.equal(fresh.saved, false);
    assert.deepEqual(ids(fresh.tasks), ['enrol', 'gp', 'student-id', 'society', 'dentist', 'contacts']);
    assert.ok(fresh.tasks.every((task) => task.done === false));
  }
  assert.deepEqual(checklistFrom({ checklist: [], checklistOffered: ['enrol'] }), { tasks: [], saved: true }, 'an emptied list stays empty');
  assert.deepEqual(ids(checklistFrom({ checklist: [] }).tasks), ['enrol'], 'one emptied before Enrol was added gets it, once');
});
await check('Enrol is added to a list saved before it existed: at the top, once, keeping their own tasks and ticks; one they delete stays deleted; a full list gets it once there’s room', async () => {
  const old = [{ id: 'gp', title: 'Register with a GP', done: true }, { id: 'own-1', title: 'Buy a lamp', done: false }, { id: 'society', title: 'Join a society', done: true }];
  const added = withNewDefaults(old, undefined);
  assert.deepEqual(added.tasks, [{ id: 'enrol', title: 'Enrol', done: false }, ...old]);
  assert.deepEqual(added.offered, ['enrol']);
  assert.deepEqual(withNewDefaults(old, ['enrol']).tasks, old, 'deleted after it was added: stays deleted');
  const full = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `own-${i}`, title: `Task ${i}`, done: i % 2 === 0 }));
  assert.deepEqual(withNewDefaults(full, []), { tasks: full, offered: [] }, 'no room: not added, and not marked as had');
  assert.equal(withNewDefaults(full.slice(1), []).tasks[0].id, 'enrol', 'once there’s room');
  // Saving a change notes it as had, so deleting Enrol keeps it deleted.
  /** @type {any[]} */
  const written = [];
  let record = /** @type {any} */ ({ checklist: old });
  const transaction = { get: async () => ({ data: () => record }), set: (/** @type {any} */ _ref, /** @type {any} */ data) => { written.push(data); record = { ...record, ...data }; } };
  await applyToLatest(transaction, null, makeTick('enrol', true));
  assert.deepEqual(written[0], { checklist: [{ id: 'enrol', title: 'Enrol', done: true }, ...old], checklistOffered: ['enrol'] });
  await applyToLatest(transaction, null, makeDelete('enrol'));
  assert.deepEqual(ids(checklistFrom(record).tasks), ['gp', 'own-1', 'society'], 'deleted, and it stays deleted');
});

await check('Saved format is exactly what the check-in chat reads: { id, title, done }', () => {
  const list = applyChange(applyChange(defaultTasks(), makeAdd('Buy a lamp')), makeTick('gp', true));
  for (const task of list) {
    assert.deepEqual(Object.keys(task).sort(), ['done', 'id', 'title']);
    assert.equal(typeof task.id, 'string');
    assert.equal(typeof task.title, 'string');
    assert.equal(typeof task.done, 'boolean');
  }
});
await check('Two browsers: a tick from an out-of-date copy keeps the other browser\'s new task', () => {
  const stale = defaultTasks(); // browser 2 loaded this earlier
  const latest = applyChange(stale, makeAdd('Added in browser 1')); // browser 1 saved this since
  const tick = makeTick('gp', true); // browser 2 now ticks
  // Old way, saving browser 2's whole list: browser 1's task is lost.
  assert.equal(applyChange(stale, tick).length, 6);
  // New way, applying the change to the latest list: both survive.
  const merged = applyChange(latest, tick);
  assert.equal(merged.length, 7);
  assert.equal(merged.find((task) => task.id === 'gp')?.done, true);
});

// ---------------------------------------------------------------- 2. Sync
console.log('\n-- 2. Keeping the screen in step with saving (sync.js), with a pretend server');

/** A pretend server: saves by applying each change to its own latest list. */
function pretendServer(initial = defaultTasks()) {
  const server = {
    list: initial,
    /** @type {string[]} */ calls: [],
    /** @type {(change: any) => Promise<any>} */
    save: async (change) => {
      server.calls.push(change.type);
      server.list = applyChange(server.list, change);
      return { status: 'saved', list: server.list };
    }
  };
  return server;
}
/** @param {(change: any, list: any) => Promise<any>} save */
function startSync(save, list = defaultTasks()) {
  /** @type {any} */
  const seen = { tasks: list, problem: null, waiting: 0 };
  const sync = createChecklistSync(list, { save, onUpdate: (state) => Object.assign(seen, state) });
  return { sync, seen };
}

await check('Changes are saved one at a time, in order, and the screen ends up matching the server', async () => {
  const server = pretendServer();
  const { sync, seen } = startSync(server.save);
  const add = sync.record(makeAdd('Buy a lamp'));
  const tick = sync.record(makeTick('gp', true));
  await Promise.all([add, tick]);
  assert.deepEqual(server.calls, ['add', 'tick']);
  assert.deepEqual(seen.tasks, server.list);
  assert.equal(seen.problem, null);
});
await check('A failed save stays on screen with an error, nothing else is sent, and Try again sends it all', async () => {
  const server = pretendServer();
  let failNext = true;
  const { sync, seen } = startSync(async (change) => {
    if (failNext) {
      failNext = false;
      throw new Error('network went away');
    }
    return server.save(change);
  });
  await sync.record(makeTick('gp', true));
  assert.equal(seen.problem?.kind, 'error');
  assert.equal(done(seen.tasks, 'gp'), true, 'the tick is still shown');
  await sync.record(makeTick('society', true));
  assert.deepEqual(server.calls, [], 'nothing sent while there is an error');
  assert.equal(done(seen.tasks, 'society'), true, 'the second change is shown too');
  await sync.retry();
  assert.deepEqual(server.calls, ['tick', 'tick']);
  assert.equal(seen.problem, null);
  assert.deepEqual(seen.tasks, server.list);
});
await check('Offline: changes are queued with a notice, which clears once they reach the server', async () => {
  /** @type {() => void} */
  let arrive = () => {};
  const synced = new Promise((resolve) => (arrive = () => resolve(undefined)));
  const { sync, seen } = startSync(async () => ({ status: 'queued', synced }));
  await sync.record(makeTick('gp', true));
  assert.equal(seen.problem?.kind, 'offline');
  assert.equal(done(seen.tasks, 'gp'), true);
  arrive();
  await synced;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seen.problem, null);
});
await check('A change the server can never accept is taken off the screen, with the reason', async () => {
  const { sync, seen } = startSync(async () => {
    throw new ChecklistError(`You can have up to ${MAX_TASKS} tasks.`);
  });
  await sync.record(makeAdd('One too many'));
  assert.equal(seen.tasks.length, DEFAULT_TASKS.length);
  assert.equal(seen.problem?.kind, 'refused');
  assert.equal(seen.problem?.message, `You can have up to ${MAX_TASKS} tasks.`);
});
await check('After saving, the screen shows the latest list, including another device\'s new task', async () => {
  const server = pretendServer();
  const { sync, seen } = startSync(server.save);
  server.list = applyChange(server.list, makeAdd('Added on my phone'));
  await sync.record(makeTick('gp', true));
  assert.equal(seen.tasks.length, DEFAULT_TASKS.length + 1);
  assert.equal(seen.tasks.at(-1).title, 'Added on my phone');
  assert.equal(done(seen.tasks, 'gp'), true);
});
await check('Changes that aren\'t allowed are refused before anything is shown or sent', () => {
  const server = pretendServer();
  const { sync } = startSync(server.save);
  assert.throws(() => sync.record(makeEdit('gp', 'Renamed')), ChecklistError);
  assert.deepEqual(server.calls, []);
});

// ---------------------------------------------------------------- 3. Rules
const env = process.env;
const haveStudents = env.TEST_STUDENT_EMAIL && env.TEST_STUDENT_PASSWORD && env.TEST_STUDENT2_EMAIL && env.TEST_STUDENT2_PASSWORD;
if (!haveStudents || !env.VITE_FIREBASE_PROJECT_ID) {
  console.log('\n-- 3. Rules: skipped. Put TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD, TEST_STUDENT2_EMAIL and');
  console.log('   TEST_STUDENT2_PASSWORD in .env.test.local and run with --env-file=.env --env-file=.env.test.local.');
} else {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
  const { getFirestore, doc, getDoc, setDoc, updateDoc, deleteField, runTransaction } = await import('firebase/firestore/lite');
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID
  });
  const auth = getAuth(app);
  const db = getFirestore(app);
  /** @param {string} email @param {string} password */
  const signInAs = async (email, password) => {
    await signOut(auth);
    return (await signInWithEmailAndPassword(auth, email, password)).user;
  };
  /** @param {string} name @param {() => Promise<unknown>} action */
  const denied = (name, action) => check(name, async () => {
    try {
      await action();
    } catch (err) {
      assert.equal(/** @type {{ code?: string }} */ (err).code, 'permission-denied');
      return;
    }
    assert.fail('it was allowed, but the rules should block it');
  });
  /** Sorts keys all the way down, so two reads compare equal as JSON. @param {any} value @returns {any} */
  const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value);

  console.log(`\n-- 3. Rules, against ${env.VITE_FIREBASE_PROJECT_ID}`);
  const first = await signInAs(/** @type {string} */ (env.TEST_STUDENT_EMAIL), /** @type {string} */ (env.TEST_STUDENT_PASSWORD));
  const record = doc(db, 'students', first.uid);
  const before = (await getDoc(record)).data() ?? {};
  const hadChecklist = Object.hasOwn(before, 'checklist');

  try {
    await check('Student 1 can save a change to their checklist (a transaction on the latest list)', async () => {
      const saved = await runTransaction(db, (tx) => applyToLatest(tx, record, makeAdd('Rules test: added in browser 1')));
      assert.ok(saved.some((task) => task.title === 'Rules test: added in browser 1'));
    });
    await check('Saving the checklist leaves student 1\'s other fields alone, apart from noting which newer standard tasks it has had', async () => {
      const after = (await getDoc(record)).data() ?? {};
      // Only the names of any fields that changed are shown, never what's in the record.
      const changed = Object.keys({ ...before, ...after })
        .filter((key) => key !== 'checklist' && key !== 'checklistOffered')
        .filter((key) => JSON.stringify(canonical(before[key])) !== JSON.stringify(canonical(after[key])));
      assert.deepEqual(changed, [], 'fields that changed');
      assert.ok(Array.isArray(after.checklistOffered) && after.checklistOffered.every((/** @type {unknown} */ id) => typeof id === 'string'), 'checklistOffered is a list of task ids');
    });
    await check('Two browsers on the real server: a tick from an out-of-date copy keeps the newer task', async () => {
      const stale = readSaved((await getDoc(record)).data()?.checklist) ?? defaultTasks(); // browser 2 loads
      await runTransaction(db, (tx) => applyToLatest(tx, record, makeAdd('Rules test: added in browser 1 later')));
      const saved = await runTransaction(db, (tx) => applyToLatest(tx, record, makeTick(stale[0].id, true))); // browser 2 ticks
      assert.ok(saved.some((task) => task.title === 'Rules test: added in browser 1 later'), 'the newer task survived');
      assert.equal(saved.find((task) => task.id === stale[0].id)?.done, true, 'the tick was saved');
    });

    await check('A tick saved the way the page saves it is what the shared loader reads, so the chat sees it too', async () => {
      await runTransaction(db, (tx) => applyToLatest(tx, record, makeTick('gp', true)));
      const loaded = checklistFrom((await getDoc(record)).data());
      assert.equal(loaded.saved, true);
      assert.equal(loaded.tasks.find((task) => task.id === 'gp')?.done, true);
    });

    /** @param {number} count @param {string} title @param {object} [extra] */
    const list = (count, title, extra = {}) => Array.from({ length: count }, (_, i) => ({ id: `own-rules-${i}`, title, done: false, ...extra }));
    await denied(`The rules refuse ${MAX_TASKS + 1} tasks`, () => setDoc(record, { checklist: list(MAX_TASKS + 1, 'Rules test') }, { merge: true }));
    await denied(`The rules refuse a title over ${MAX_TITLE_LENGTH} characters`,
      () => setDoc(record, { checklist: list(1, 'x'.repeat(MAX_TITLE_LENGTH + 1)) }, { merge: true }));
    await denied('The rules refuse a task with anything but id, title and done', () => setDoc(record, { checklist: list(1, 'Rules test', { note: 'extra' }) }, { merge: true }));
    await check(`The rules accept a full list: ${MAX_TASKS} tasks with ${MAX_TITLE_LENGTH}-character titles (the per-task check fits Firestore's limits)`, async () => {
      await setDoc(record, { checklist: list(MAX_TASKS, 'y'.repeat(MAX_TITLE_LENGTH)) }, { merge: true });
      assert.equal(checklistFrom((await getDoc(record)).data()).tasks.length, MAX_TASKS);
    });

    await signInAs(/** @type {string} */ (env.TEST_STUDENT2_EMAIL), /** @type {string} */ (env.TEST_STUDENT2_PASSWORD));
    await denied('Student 2 cannot read student 1\'s checklist', () => getDoc(record));
    await denied('Student 2 cannot overwrite student 1\'s checklist', () => setDoc(record, { checklist: [] }, { merge: true }));
    await denied('Student 2 cannot change student 1\'s checklist with a transaction',
      () => runTransaction(db, (tx) => applyToLatest(tx, record, makeTick('gp', true))));
    await signOut(auth);
    await denied('A logged-out visitor cannot read student 1\'s checklist', () => getDoc(record));
  } finally {
    // Put student 1's checklist back as it was.
    await signInAs(/** @type {string} */ (env.TEST_STUDENT_EMAIL), /** @type {string} */ (env.TEST_STUDENT_PASSWORD));
    await updateDoc(record, {
      checklist: hadChecklist ? before.checklist : deleteField(),
      checklistOffered: 'checklistOffered' in before ? before.checklistOffered : deleteField()
    });
    await signOut(auth);
    console.log('      (Student 1\'s checklist has been put back as it was.)');
  }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
