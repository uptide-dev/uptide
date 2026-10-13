import { ReferenceArea, ReferenceDot, ReferenceLine } from 'recharts';

export const line = <ReferenceLine y={10} ifOverflow="extendDomain" />; // @uptide always-show at:alwaysShow
export const dot = <ReferenceDot x={1} y={2} ifOverflow="extendDomain" />; // @uptide always-show at:alwaysShow
export const area = <ReferenceArea y1={1} y2={2} />; // @uptide always-show at:alwaysShow
export const tag = <ReferenceLine x={3} ifOverflow="extendDomain" stroke="red" />; // @uptide always-show at:<ReferenceLine
export const stacked = (
  <ReferenceLine
    y={10}
    ifOverflow="extendDomain" // @uptide always-show at:alwaysShow
    stroke="red"
  />
);
export const computed = <ReferenceLine y={10} alwaysShow={show} />; // @uptide always-show keep at:alwaysShow
export const both = <ReferenceLine y={10} alwaysShow ifOverflow="hidden" />; // @uptide always-show keep at:alwaysShow
export const other = <Thing alwaysShow />; // @uptide always-show keep at:alwaysShow
