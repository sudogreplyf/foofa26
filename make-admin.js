/**
 * Usage: node make-admin.js <username>
 * Grants admin privileges to the specified user.
 */
const { getDb } = require('./db');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node make-admin.js <username>');
  process.exit(1);
}

getDb().then(async db => {
  const user = await db.get('SELECT * FROM users WHERE username = ?', username);
  if (!user) {
    console.error(`User "${username}" not found.`);
    process.exit(1);
  }
  await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', user.id);
  console.log(`✅ "${user.display_name}" (@${user.username}) is now an admin.`);
  process.exit(0);
});
