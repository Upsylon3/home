// Execute the production migration SQL on real SQLite and compare the result
// to Room's generated v2 schema. No service, emulator or npm install is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const root = new URL('../', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('app/schemas/com.homeecosystems.homesync.data.local.AppDatabase/2.json', root), 'utf8')).database;
const source = readFileSync(new URL('app/src/main/java/com/homeecosystems/homesync/data/local/AppDatabase.kt', root), 'utf8');
const migration = source.split('val MIGRATION_1_2 =')[1]?.split('@Volatile')[0];
assert.ok(migration, 'Production migration must be located');
const statements = [...migration.matchAll(/db\.execSQL\("([^"\n]*)"\)/g)].map(match => match[1]);
assert.equal(statements.length, 3, 'Review extraction if the production migration SQL changes');
const legacySql = 'CREATE TABLE synced_media (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, localMediaId TEXT NOT NULL, contentHash TEXT NOT NULL, category TEXT NOT NULL, sizeBytes INTEGER NOT NULL, uploadedAtEpochMs INTEGER NOT NULL); CREATE UNIQUE INDEX index_synced_media_localMediaId ON synced_media(localMediaId)';
const shape = db => ({
  columns: db.prepare('PRAGMA table_info(synced_media)').all().map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })).sort((a, b) => a.name.localeCompare(b.name)),
  indexes: db.prepare('PRAGMA index_list(synced_media)').all().map(({ name, unique }) => ({ name, unique, columns: db.prepare(`PRAGMA index_info(${name})`).all().map(row => row.name) })).sort((a, b) => a.name.localeCompare(b.name))
});

test('v1 upgrade retains complete history and matches the generated Room v2 contract', () => {
  const actual = new DatabaseSync(':memory:'), expected = new DatabaseSync(':memory:');
  try {
    actual.exec(legacySql);
    actual.exec("INSERT INTO synced_media VALUES (41, 'images:1', 'legacy-hash', 'Photos', 123, 456)");
    actual.exec('BEGIN');
    for (const statement of statements) actual.exec(statement);
    actual.exec('COMMIT');
    const entity = schema.entities[0];
    expected.exec(entity.createSql.replaceAll('${TABLE_NAME}', entity.tableName));
    for (const index of entity.indices) expected.exec(index.createSql.replaceAll('${TABLE_NAME}', entity.tableName));
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
