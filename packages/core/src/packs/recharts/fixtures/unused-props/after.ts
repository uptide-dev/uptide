import { Area, Funnel, ReferenceDot, ReferenceLine } from 'recharts';

export const front = <ReferenceLine y={1} />; // @uptide unused-props at:isFront
export const dot = <ReferenceDot x={1} y={2} stroke="red" />; // @uptide unused-props at:isFront
export const area = <Area dataKey="a" type="monotone" />; // @uptide unused-props at:animateNewValues
export const funnel = <Funnel dataKey="v" />; // @uptide unused-props at:animateNewValues
export const tag = <Area dataKey="b" />; // @uptide unused-props at:<Area
export const wrapped = (
  <ReferenceLine
    x={3} // @uptide unused-props at:isFront
  />
);
export const bar = <Bar dataKey="a" animateNewValues />; // @uptide unused-props keep at:animateNewValues
export const other = <Thing isFront />; // @uptide unused-props keep at:isFront
export const areaFront = <Area dataKey="a" isFront />; // @uptide unused-props keep at:isFront
