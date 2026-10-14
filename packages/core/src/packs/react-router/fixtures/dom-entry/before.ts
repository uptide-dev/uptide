import { createRoutesFromElements, Route, RouterProvider } from 'react-router'; // @uptide dom-entry-imports at:'react-router'
import { HydratedRouter as Hydrated } from "react-router"; // @uptide dom-entry-imports at:"react-router"
import type { RouterProviderProps } from 'react-router'; // @uptide dom-entry-imports keep at:'react-router'
import { RouterProvider as DomProvider } from 'react-router/dom'; // @uptide dom-entry-imports keep at:'react-router/dom'
import { Link } from 'react-router'; // @uptide dom-entry-imports keep at:'react-router'

export const used = [createRoutesFromElements, Route, RouterProvider, Hydrated, DomProvider, Link];
export type Props = RouterProviderProps;
