import { createBrowserRouter, createMemoryRouter as memory } from 'react-router-dom'; // @uptide dom-imports at:'react-router-dom'
import { createStaticRouter } from 'react-router';

const routes = [{ path: '/' }];
const flags = { v7_fetcherPersist: true };

export const a = createBrowserRouter(routes, { future: { v7_relativeSplatPath: true, v7_fetcherPersist: true } }); // @uptide future-option at:future
export const b = createBrowserRouter(routes, {
  basename: '/app',
  future: { // @uptide future-option at:future
    v7_normalizeFormMethod: true,
    v7_skipActionErrorRevalidation: false,
  },
});
export const c = memory(routes, {
  future: { v7_partialHydration: true }, // @uptide future-option at:future
});
export const d = createStaticRouter(routes, {} as never, { future: { v7_relativeSplatPath: true } }); // @uptide future-option at:future
export const e = createBrowserRouter(routes, { future: flags }); // @uptide future-option keep at:future
export const f = createBrowserRouter(routes, { future: { v7_relativeSplatPath: !!flags } }); // @uptide future-option keep at:future
const createRouter = (r: unknown, o: { future: object }) => [r, o];
export const g = createRouter(routes, { future: { v7_relativeSplatPath: true } }); // @uptide future-option keep at:future
