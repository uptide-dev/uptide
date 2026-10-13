import { cacheLife as lifetime } from 'next/cache'; // @uptide stable-cache-exports at:unstable_cacheLife
import { cacheTag as cacheTag } from 'next/cache'; // @uptide stable-cache-exports at:unstable_cacheTag
import { unstable_cache } from 'next/cache'; // @uptide stable-cache-exports keep at:unstable_cache
import { unstable_cacheTag as other } from 'other'; // @uptide stable-cache-exports keep at:unstable_cacheTag
const text = "unstable_cacheTag"; // @uptide stable-cache-exports keep at:unstable_cacheTag
lifetime('hours');
cacheTag('posts');
