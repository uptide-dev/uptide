import { Area, Funnel, ReferenceDot, ReferenceLine } from 'recharts';

export const front = <ReferenceLine y={1} isFront />; // @uptide unused-props at:isFront
export const dot = <ReferenceDot x={1} y={2} isFront={false} stroke="red" />; // @uptide unused-props at:isFront
export const area = <Area dataKey="a" animateNewValues={false} type="monotone" />; // @uptide unused-props at:animateNewValues
export const funnel = <Funnel dataKey="v" animateNewValues />; // @uptide unused-props at:animateNewValues
export const tag = <Area dataKey="b" animateNewValues />; // @uptide unused-props at:<Area
export const wrapped = (
  <ReferenceLine
    x={3}
    isFront // @uptide unused-props at:isFront
  />
);
export const bar = <Bar dataKey="a" animateNewValues />; // @uptide unused-props keep at:animateNewValues
export const other = <Thing isFront />; // @uptide unused-props keep at:isFront
export const areaFront = <Area dataKey="a" isFront />; // @uptide unused-props keep at:isFront
