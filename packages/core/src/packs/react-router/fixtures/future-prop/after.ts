import { BrowserRouter, RouterProvider, createBrowserRouter } from 'react-router'; // @uptide dom-entry-imports at:'react-router'
import { MemoryRouter, HashRouter as Router } from 'react-router';
import { Widget as Panel } from './widget';

const router = createBrowserRouter([]);
const flags = { v7_startTransition: true };

export const App = () => <RouterProvider router={router} />; // @uptide future-prop at:RouterProvider message:"Type '{ router: DataRouter; future: { v7_startTransition: boolean; }; }' is not assignable to type 'IntrinsicAttributes & RouterProviderProps'. Property 'future' does not exist on type 'IntrinsicAttributes & RouterProviderProps'."
export const Legacy = () => (
  <BrowserRouter // @uptide future-prop at:BrowserRouter message:"Property 'future' does not exist on type 'IntrinsicAttributes & BrowserRouterProps'."
    basename="/app"
  >
    <div />
  </BrowserRouter>
);
export const Shared = () => <RouterProvider router={router} future={flags} />; // @uptide future-prop keep at:RouterProvider message:"Property 'future' does not exist on type 'IntrinsicAttributes & RouterProviderProps'."
export const Computed = () => <MemoryRouter future={{ v7_startTransition: Boolean(flags) }} />; // @uptide future-prop keep at:MemoryRouter message:"Property 'future' does not exist on type 'IntrinsicAttributes & MemoryRouterProps'."
export const Aliased = () => <Router>x</Router>; // @uptide future-prop at:Router message:"Property 'future' does not exist on type 'IntrinsicAttributes & HashRouterProps'."
export const NotARouter = () => <Panel future={{ v7_startTransition: true }} />; // @uptide future-prop keep at:Panel message:"Property 'future' does not exist on type 'IntrinsicAttributes & PanelProps'."
