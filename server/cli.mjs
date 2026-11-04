import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { initialize, configure, readState, issueCode } from './setup.mjs';
import { validateDomain } from './runtime.mjs';
import { planUpgrade, upgradeBundle } from './upgrade.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const action = process.argv[2] || 'start';
const terminal = createInterface({ input: process.stdin, output: process.stdout });
async function requireOwner() {
  const status = await fetch('http://homecore:4000/api/auth/registration', { signal: AbortSignal.timeout(5000) });
  if (!status.ok || (await status.json()).ownerCreated !== true) throw new Error('Create the owner account locally before enabling other-device access.');
}
try {
  if (action === 'check-upgrade') {
    const plan = planUpgrade('/previous', root);
    console.log(plan.journal?.status === 'complete' ? 'complete' : plan.project);
  } else if (action === 'upgrade') {
    const copied = upgradeBundle('/previous', root, { confirmStopped: process.argv[3] === '--confirm-stopped' });
    console.log(copied ? 'Upgrade copied and verified. Identity, credentials and files are preserved.' : 'This upgrade is already complete; existing destination data was kept.');
    console.log('The old folder is an offline recovery copy. Start HOME from this new folder only.');
  } else if (action === 'start') {
    const fresh = initialize(root);
    console.log(fresh ? '\nYour HOME is prepared. Accounts and files stay on this computer.' : '\nUsing your existing HOME configuration and data.');
    const state = readState(root);
    console.log(`Access mode: ${state.access.mode}`);
    console.log('Open http://localhost:8080/register on this server to create an account.');
    console.log('One-time setup code (15 minutes): ' + issueCode(root));
    if (state.access.mode === 'public') console.log(`Public address: https://${state.access.domain}`);
    console.log('Keep the installation folder private and back it up. START-HERE.md explains other-device and remote access.');
  } else if (action === 'code') {
    console.log('One-time account setup code (15 minutes): ' + issueCode(root));
    console.log('Give this code only to the person you want to create an account on this HOME.');
  } else if (action === 'access') {
    readState(root);
    console.log('\n1. This computer only (default)\n2. Home network: plain HTTP; other devices on your network can connect\n3. Public HTTPS: requires a hostname and router setup; no HOME subscription');
    const answer = (await terminal.question('Choose 1, 2 or 3: ')).trim();
    if (answer === '1') configure(root, { mode: 'local' });
    else if (answer === '2') {
      await requireOwner();
      console.log('HTTP does not encrypt passwords or files. Use a trusted LAN only; do not forward port 8080 or use HomeVault over this connection.');
      if ((await terminal.question('Type LAN to enable: ')).trim() !== 'LAN') throw new Error('Access change cancelled.');
      configure(root, { mode: 'lan' });
      console.log('Use http://SERVER-LOCAL-IP:8080 on another device at home. START-HERE.md explains how to find that IP.');
    } else if (answer === '3') {
      await requireOwner();
      const domain = validateDomain(await terminal.question('Your hostname (for example myhome.duckdns.org): '));
      console.log('Point this name at your public IP. Forward TCP ports 80 and 443 to this computer and allow them in its firewall. Never forward 8080.');
      console.log('If your provider uses shared IPv4 (CGNAT), these router rules alone will not work. See START-HERE.md for the free private-network alternative.');
      console.log('This exposes the HOME login to the internet. Claim the owner account first, use a strong password and enable two-factor authentication.');
      if ((await terminal.question('Type PUBLIC to enable: ')).trim() !== 'PUBLIC') throw new Error('Access change cancelled.');
      configure(root, { mode: 'public', domain });
      console.log(`After DNS, router and certificate setup succeed, open https://${domain}. Test from mobile data; a local test cannot prove outside access.`);
    } else throw new Error('Choose 1, 2 or 3.');
  } else throw new Error('Unknown setup action.');
} catch (error) {
  console.error('HOME setup: ' + error.message);
  process.exitCode = 1;
} finally {
  terminal.close();
}
