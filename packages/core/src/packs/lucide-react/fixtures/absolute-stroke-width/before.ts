import { Bell, LucideProvider, type LucideProps } from 'lucide-react';
import * as Icons from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';
import { Chart } from './chart';

export const a = <Bell size={16} absoluteStrokeWidth />; // @uptide absolute-stroke-width
export const b = <Icons.Search absoluteStrokeWidth={true} />; // @uptide absolute-stroke-width
export const c = <DynamicIcon name="bell" absoluteStrokeWidth />; // @uptide absolute-stroke-width
export const d = <LucideProvider absoluteStrokeWidth>{a}</LucideProvider>; // @uptide absolute-stroke-width
export const e = <Chart absoluteStrokeWidth />; // @uptide absolute-stroke-width keep
export const f = <Bell nonScalingStroke />; // @uptide absolute-stroke-width keep
export const props: LucideProps = { absoluteStrokeWidth: true }; // @uptide absolute-stroke-width keep
