# Browser demo

[Open HOME](https://upsylon3.github.io/home/) without a server. This is a static
build of the existing web apps with a browser-local API adapter.

## Use it

A current browser with service workers, IndexedDB and Web Crypto is required;
use HTTPS or localhost. First use creates local sample data. Demo sign-in is
simulated: any name/password enters the same sandbox, not a separate account.

Files, notes, tasks and test Vault ciphertext persist in that browser/profile.
Clearing storage, eviction or private browsing can erase them. Master passwords,
plaintext vault keys and decrypted entries are not intended to persist.
**Use test data only.** Browser storage is not backup or a security review.

Reset erases this sandbox and restores samples. The demo does not prove backend
authorization, real server storage, phone backup or real monitoring.

## Build and verify

~~~bash
npm run build:demo
npm run preview:demo
npm run test:demo
npm run test:demo:browser
~~~

The default base is `/home/`; set `DEMO_BASE` consistently for another path.
The build rewrites only the demo's API/session/bootstrap paths, leaving server
apps unchanged. Pages deploys the checked artifact only when its source tree
matches the merge; it does not rebuild after merge.

The [address portal](https://upsylon3.github.io/home/connect/) stores shortcuts
only. The [Vault speed test](HOMEVAULT_BENCHMARK.md) is a separate anonymous
entry without the demo sign-in, IndexedDB adapter or backend calls.
