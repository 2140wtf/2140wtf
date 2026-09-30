# Browser relay transport hotfix

Source: `baocommunity/bao-community`, commit `1160b04`, `dist/websocket.js`
and its declaration file. License retained in LICENSE.

The pinned implementation resolves a negative OK with an array, then treats
that truthy array as success. This copy accepts only boolean true and keeps
the relay rejection reason. Non-array JSON frames are ignored. No other
transport behavior is intentionally changed. The app imports this copy directly;
node_modules is not patched. Remove it when an upstream pinned release passes
src/lib/communityWebsocket.test.ts. This does not change postReliable polling
or make relay acceptance a scribe durability receipt.
