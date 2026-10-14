import House from 'lucide-react/dist/esm/icons/house'; // @uptide deep-imports
import Bell from 'lucide-react/dist/esm/icons/bell.js'; // @uptide deep-imports
import Github from 'lucide-react/dist/esm/icons/github'; // @uptide untyped-icon-names
import { Search } from 'lucide-react'; // @uptide deep-imports keep
import { DynamicIcon } from 'lucide-react/dynamic'; // @uptide deep-imports keep
import { other } from 'some-lucide-react/dist/esm/icons/house'; // @uptide deep-imports keep

const Umd = require('lucide-react/dist/umd/lucide-react'); // @uptide deep-imports
export const lazy = () => import('lucide-react/dist/esm/icons/clock'); // @uptide deep-imports
export const used = [House, Bell, Github, Search, DynamicIcon, other, Umd];
