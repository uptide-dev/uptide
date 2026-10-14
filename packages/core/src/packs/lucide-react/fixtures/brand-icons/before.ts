import { Github, Twitter as Bird, House } from 'lucide-react';
import { Figma } from './brand';

export const header = <Github className="h-4 w-4" />; // @uptide brand-icons-removed
export const bird = <Bird aria-hidden />; // @uptide brand-icons-removed
export const socials = [{ icon: Github, label: 'Code' }]; // @uptide brand-icons-removed
export { Github as Mark }; // @uptide brand-icons-removed
export const home = <House />; // @uptide brand-icons-removed keep
export const design = <Figma />; // @uptide brand-icons-removed keep
export function Shadowed({ Github }: { Github: () => null }) {
  return <Github />; // @uptide brand-icons-removed keep
}
export const label = 'Github'; // @uptide brand-icons-removed keep
