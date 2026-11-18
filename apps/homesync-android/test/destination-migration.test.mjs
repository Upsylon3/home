// Execute the production migration SQL on real SQLite and compare the result
// to Room's generated v2, v3 and v4 schemas. No service, emulator or npm install is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const root = new URL('../', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('app/schemas/com.homeecosystems.homesync.data.local.AppDatabase/2.json', root), 'utf8')).database;
const updatedSchema = JSON.parse(readFileSync(new URL('app/schemas/com.homeecosystems.homesync.data.local.AppDatabase/3.json', root), 'utf8')).database;
const runSchema = JSON.parse(readFileSync(new URL('app/schemas/com.homeecosystems.homesync.data.local.AppDatabase/4.json', root), 'utf8')).database;
const source = readFileSync(new URL('app/src/main/java/com/homeecosystems/homesync/data/local/AppDatabase.kt', root), 'utf8');
function migrationStatements(name, end, length) {
  const body = source.split(`val ${name} =`)[1]?.split(end)[0];
  assert.ok(body, `Production migration ${name} must be located`);
  const statements = [...body.matchAll(/db\.execSQL\("([^"\n]*)"\)/g)].map(match => match[1]);
  assert.equal(statements.length, length, 'Review extraction if the production migration SQL changes');
  return statements;
}
const statements = migrationStatements('MIGRATION_1_2', 'val MIGRATION_2_3', 3);
const updatedStatements = migrationStatements('MIGRATION_2_3', 'val MIGRATION_3_4', 1);
const runStatements = migrationStatements('MIGRATION_3_4', '@Volatile', 3);
const legacySql = 'CREATE TABLE synced_media (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, localMediaId TEXT NOT NULL, contentHash TEXT NOT NULL, category TEXT NOT NULL, sizeBytes INTEGER NOT NULL, uploadedAtEpochMs INTEGER NOT NULL); CREATE UNIQUE INDEX index_synced_media_localMediaId ON synced_media(localMediaId)';
const shape = (db, table = 'synced_media') => ({
  columns: db.prepare(`PRAGMA table_info(${table})`).all().map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })).sort((a, b) => a.name.localeCompare(b.name)),
  indexes: db.prepare(`PRAGMA index_list(${table})`).all().map(({ name, unique }) => ({ name, unique, columns: db.prepare(`PRAGMA index_info(${name})`).all().map(row => row.name) })).sort((a, b) => a.name.localeCompare(b.name))
});

function createSchema(db, contract) {
  for (const entity of contract.entities) {
    db.exec(entity.createSql.replaceAll('${TABLE_NAME}', entity.tableName));
    for (const index of entity.indices) db.exec(index.createSql.replaceAll('${TABLE_NAME}', entity.tableName));
  }
}

test('v1 upgrade retains complete history and matches the generated Room v2 contract', () => {
  const actual = new DatabaseSync(':memory:'), expected = new DatabaseSync(':memory:');
  try {
    actual.exec(legacySql);
    actual.exec("INSERT INTO synced_media VALUES (41, 'images:1', 'legacy-hash', 'Photos', 123, 456)");
    actual.exec('BEGIN');
    for (const statement of statements) actual.exec(statement);
    actual.exec('COMMIT');
    createSchema(expected, schema);
    assert.deepEqual(shape(actual), shape(expected));
    assert.deepEqual({ ...actual.prepare('SELECT * FROM synced_media').get() }, {
      id: 41, localMediaId: 'images:1', contentHash: 'legacy-hash', category: 'Photos', sizeBytes: 123, uploadedAtEpochMs: 456, destinationKey: ''
    });
    const insert = actual.prepare('INSERT INTO synced_media (destinationKey, localMediaId, contentHash, category, sizeBytes, uploadedAtEpochMs) VALUES (?, ?, ?, ?, ?, ?)');
    for (const key of ['server-a-account-1', 'server-b-account-1', 'server-a-account-2']) {
      assert.ok(insert.run(key, 'images:1', key, 'Photos', 10, 20).lastInsertRowid > 41);
    }
    assert.throws(() => insert.run('server-a-account-1', 'images:1', 'duplicate', 'Photos', 10, 20), /UNIQUE/);
    assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM synced_media').get().n, 4);
    assert.equal(actual.prepare("SELECT COUNT(*) AS n FROM synced_media WHERE destinationKey='' ").get().n, 1);
  } finally { actual.close(); expected.close(); }
});

test('v2 upgrade preserves scoped and legacy history and matches the generated Room v3 contract', () => {
  const actual = new DatabaseSync(':memory:'), expected = new DatabaseSync(':memory:');
  try {
    createSchema(actual, schema);
    actual.exec("INSERT INTO synced_media VALUES (41, 'server-a', 'images:1', 'hash-a', 'Photos', 123, 456), (42, '', 'images:2', 'legacy', 'Photos', 234, 567)");
    const previousRows = actual.prepare('SELECT * FROM synced_media ORDER BY id').all();
    actual.exec('BEGIN');
    for (const statement of updatedStatements) actual.exec(statement);
    actual.exec('COMMIT');
    createSchema(expected, updatedSchema);
    assert.deepEqual(shape(actual), shape(expected));
    assert.deepEqual(actual.prepare('SELECT * FROM synced_media ORDER BY id').all().map(row => ({ ...row })),
      previousRows.map(row => ({ ...row, sourceVersion: null })));
  } finally { actual.close(); expected.close(); }
});

test('v3 upgrade adds run history and keeps the scoped media ledger intact', () => {
  const actual = new DatabaseSync(':memory:'), expected = new DatabaseSync(':memory:');
  try {
    createSchema(actual, updatedSchema);
    actual.exec("INSERT INTO synced_media VALUES (41, 'server-a', 'images:1', 'hash-a', 'Photos', 123, 456, 'revision-1')");
    const previous = actual.prepare('SELECT * FROM synced_media').get();
    actual.exec('BEGIN');
    for (const statement of runStatements) actual.exec(statement);
    actual.exec('COMMIT');
    createSchema(expected, runSchema);
    assert.deepEqual(shape(actual), shape(expected));
    assert.deepEqual(shape(actual, 'backup_runs'), shape(expected, 'backup_runs'));
    assert.deepEqual(actual.prepare('SELECT * FROM synced_media').get(), previous);
    assert.equal(actual.prepare('SELECT count(*) AS total FROM backup_runs').get().total, 0);
  } finally { actual.close(); expected.close(); }
});

test('a failed migration transaction preserves the original v1 table/index/data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(legacySql);
    db.exec("INSERT INTO synced_media VALUES (5, 'images:5', 'hash', 'Photos', 5, 5)");
    const original = shape(db);
    db.exec('BEGIN');
    db.exec(statements[0]);
    db.exec(statements[1]);
    assert.throws(() => db.exec('CREATE UNIQUE INDEX broken ON nonexistent(column)'), /no such table/);
    db.exec('ROLLBACK');
    assert.deepEqual(shape(db), original);
    assert.equal(db.prepare('SELECT id FROM synced_media').get().id, 5);
  } finally { db.close(); }
});
