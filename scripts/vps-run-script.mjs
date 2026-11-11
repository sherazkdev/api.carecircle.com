import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';

const here = dirname(fileURLToPath(import.meta.url));
const scriptName = process.argv[2] ?? 'vps-inspect.sh';
const b64 = readFileSync(resolve(here, scriptName), 'utf8').replace(/\r\n/g, '\n');

const host = process.env.VPS_SSH_HOST ?? '13.140.131.209';
const username = process.env.VPS_SSH_USER ?? 'root';
const password = process.env.VPS_SSH_PASSWORD;
if (!password) {
  console.error('missing VPS_SSH_PASSWORD');
  process.exit(1);
}

const remoteCmd = `echo ${Buffer.from(b64, 'utf8').toString('base64')} | base64 -d | bash`;

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(remoteCmd, (err, stream) => {
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
