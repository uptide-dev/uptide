import { icons, Github } from 'lucide-react';
import * as Lucide from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import LinkedinMark from 'lucide-react/dist/esm/icons/linkedin'; // @uptide untyped-icon-names
import HouseMark from 'lucide-react/dist/esm/icons/house'; // @uptide deep-imports

export const fromAny = (icons as any)['Twitter']; // @uptide untyped-icon-names
export const fromCast = (Lucide as Record<string, unknown>).Youtube; // @uptide untyped-icon-names
export const loader = (dynamicIconImports as any)['github']; // @uptide untyped-icon-names
export const typed = icons['Linkedin']; // @uptide untyped-icon-names keep
export const typedMember = Lucide.Slack; // @uptide untyped-icon-names keep
export const kept = (icons as any)['House']; // @uptide untyped-icon-names keep
export const castName = <DynamicIcon name={'figma' as IconName} />; // @uptide untyped-icon-names
export const plainName = <DynamicIcon name="github" />; // @uptide untyped-icon-names keep

export const socials = [
  { label: 'Code', icon: 'github' }, // @uptide untyped-icon-names
  { label: 'Chat', iconName: 'Slack' }, // @uptide untyped-icon-names
  { label: 'Home', icon: 'house' }, // @uptide untyped-icon-names keep
  { label: 'Login', provider: 'github' }, // @uptide untyped-icon-names keep
];
export const used = [Github, LinkedinMark, HouseMark];
