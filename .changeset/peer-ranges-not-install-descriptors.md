---
'uptide': patch
---

Fix a 0.7.4 regression: when a workspace declares the upgraded package both in `peerDependencies` and in `dependencies` or `devDependencies`, the widened peer range (for example `^18.3.1 || ^19.0.0`) replaced the installable range in the install and in the check that follows it. With Yarn it is no lockfile descriptor, so the check read an old copy and `fix` stopped with "Requested react@19.3.0, but … resolved 17.0.2". Peer ranges are now only validated and widened in the manifest: `dependencies`, `devDependencies` and `optionalDependencies` alone feed the install, `yarn set resolution` and the check.
