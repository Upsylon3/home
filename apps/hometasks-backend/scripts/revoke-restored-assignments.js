// Explicit offline maintenance only. Never loads dotenv or creates databases.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--database' || !path.isAbsolute(args[1]) || args[2] !== '--confirm-offline-restore') {
  console.error('Usage: node revoke-restored-assignments.js --database <absolute existing Tasks database> --confirm-offline-restore');
  process.exitCode = 1;
} else {
  let db;
  try {
    if (!fs.lstatSync(args[1]).isFile() || fs.lstatSync(args[1]).isSymbolicLink()) throw new Error();
    db = new Database(args[1], { fileMustExist: true });
    const columns = db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name);
    if (!columns.includes('user_id') || !columns.includes('title')) throw new Error();
    let revoked = 0;
    if (columns.includes('assignee_id')) {
      revoked = db.transaction(() => {
        const tasks = db.prepare('SELECT id,user_id,assignee_id FROM tasks WHERE assignee_id IS NOT NULL').all();
        for (const task of tasks) {
          db.prepare(`INSERT INTO task_assignment_audit (task_id,owner_id,actor_id,assignee_id,operation)
            VALUES (?,?,NULL,?,'restore_revoked')`).run(task.id, task.user_id, task.assignee_id);
          db.prepare('UPDATE tasks SET assignee_id=NULL,assignee_username=NULL,assignment_version=assignment_version+1 WHERE id=?').run(task.id);
        }
        return tasks.length;
      }).immediate();
    }
    console.log(JSON.stringify({ revoked }));
  } catch {
    console.error('Could not revoke restored assignments. Keep Tasks offline and check the database.');
    process.exitCode = 1;
  } finally { db?.close(); }
}
