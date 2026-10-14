import { createBrowserRouter, createMemoryRouter as memory } from 'react-router'; // @uptide dom-imports at:'react-router-dom'
import { createStaticRouter } from 'react-router';

const routes = [{ path: '/' }];
const flags = { v7_fetcherPersist: true };

export const a = createBrowserRouter(routes); // @uptide future-option at:future
export const b = createBrowserRouter(routes, {
  basename: '/app',
});
export const c = memory(routes);
export const d = createStaticRouter(routes, {} as never); // @uptide future-option at:future
export const e = createBrowserRouter(routes, { future: flags }); // @uptide future-option keep at:future
export const f = createBrowserRouter(routes, { future: { v7_relativeSplatPath: !!flags } }); // @uptide future-option keep at:future
const createRouter = (r: unknown, o: { future: object }) => [r, o];
export const g = createRouter(routes, { future: { v7_relativeSplatPath: true } }); // @uptide future-option keep at:future
