import { revalidateTag, revalidateTag as invalidate } from 'next/cache';
revalidateTag('posts'); // @uptide revalidate-tag-profile at:revalidateTag
invalidate('items'); // @uptide revalidate-tag-profile at:invalidate
revalidateTag('posts', 'max'); // @uptide revalidate-tag-profile keep at:revalidateTag
function local(revalidateTag: (tag: string) => void) {
  revalidateTag('local'); // @uptide revalidate-tag-profile keep at:revalidateTag
}
const fake = { revalidateTag(tag: string) {} };
fake.revalidateTag('local'); // @uptide revalidate-tag-profile keep at:fake.revalidateTag
