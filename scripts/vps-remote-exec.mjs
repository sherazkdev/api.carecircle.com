/**
 * One-off VPS command runner. Password via env only — never argv.
 * VPS_SSH_HOST, VPS_SSH_USER, VPS_SSH_PASSWORD
 */
import { Client } from 'ssh2';

const host = process.env.VPS_SSH_HOST ?? '13.140.131.209';
const username = process.env.VPS_SSH_USER ?? 'root';
const password = process.env.VPS_SSH_PASSWORD;
const cmd = process.argv.slice(2).join(' ');

if (!password) {
  console.error('missing VPS_SSH_PASSWORD');
  process.exit(1);
}
if (!cmd) {
  console.error('usage: node vps-remote-exec.mjs <remote command>');
  process.exit(1);
}

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err.message);
        process.exit(1);
      }
      stream
        .on('close', (code) => {
          conn.end();
          process.exit(code ?? 0);
        })
        .on('data', (d) => process.stdout.write(d))
        .stderr.on('data', (d) => process.stderr.write(d));
    });
  })
  .on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username, password });
