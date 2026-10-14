import { SquareGantt, House } from 'lucide-react'; // @uptide renamed-icons at:SquareGantt
import { MousePointerSquare as Pointer } from 'lucide-react'; // @uptide renamed-icons at:MousePointerSquare
import { SquareKanbanDashedIcon, LucideGanttSquare } from 'lucide-react'; // @uptide renamed-icons at:SquareKanbanDashedIcon
import {
  AlignHorizonalDistributeCenter, // @uptide renamed-icons at:AlignHorizonalDistributeCenter
  Activity,
} from 'lucide-react';
import * as Icons from 'lucide-react';
import { icons } from 'lucide-react';
import { SquareGantt as Chart } from './charts'; // @uptide renamed-icons keep at:SquareGantt
import { Github, GanttSquare } from 'lucide-react'; // @uptide renamed-icons keep at:Github

export { SquareGantt as Gantt } from 'lucide-react'; // @uptide renamed-icons at:SquareGantt
export { MousePointerSquare } from 'lucide-react'; // @uptide renamed-icons at:MousePointerSquare
export { SquareGantt as Local } from './charts'; // @uptide renamed-icons keep at:SquareGantt

export const fromNamespace = Icons.SquareGantt; // @uptide renamed-icons at:SquareGantt
export const fromMap = icons.MousePointerSquare; // @uptide renamed-icons at:MousePointerSquare
export const byKey = icons['SquareKanbanDashed']; // @uptide renamed-icons at:icons[
export const notLucide = Chart.SquareGantt; // @uptide renamed-icons keep at:SquareGantt
export const used = [SquareGantt, Pointer, SquareKanbanDashedIcon, LucideGanttSquare, House, Activity, AlignHorizonalDistributeCenter, Github, GanttSquare];
