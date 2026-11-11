import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { Client } from 'ssh2';

const localPath = resolve(process.argv[2] ?? '');
const remotePath = process.argv[3];
if (!localPath || !remotePath) {
  console.error('usage: node vps-upload.mjs <local> <remote>');
  process.exit(1);
}

const password = process.env.VPS_SSH_PASSWORD;
const host = process.env.VPS_SSH_HOST ?? '13.140.131.209';
const username = process.env.VPS_SSH_USER ?? 'root';
if (!password) process.exit(1);

const conn = new Client();
conn
  .on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) {
        console.error(err.message);
        process.exit(1);
      }
      const data = readFileSync(localPath);
      sftp.writeFile(remotePath, data, (werr) => {
        conn.end();
        if (werr) {
          console.error(werr.message);
          process.exit(1);
        }
        console.log(`uploaded ${basename(localPath)} -> ${remotePath}`);
      });
    });
  })
  .on('error', (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host, port: 22, username, password });
