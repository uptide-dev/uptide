import { Link, useNavigate, type NavigateOptions } from 'react-router'; // @uptide dom-imports at:'react-router-dom'
import type { Location } from "react-router"; // @uptide dom-imports at:"react-router-dom"
import {
  Outlet,
  useParams,
} from 'react-router'; // @uptide dom-imports at:'react-router-dom'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'; // @uptide dom-entry-imports at:'react-router-dom'
import * as Router from 'react-router-dom'; // @uptide dom-entry-imports at:'react-router-dom'
import 'react-router-dom'; // @uptide dom-imports keep at:'react-router-dom'
import { useMatches } from 'react-router'; // @uptide dom-imports keep at:'react-router'
import { routes } from './react-router-dom-routes'; // @uptide dom-imports keep at:'./react-router-dom-routes'

export { NavLink, matchPath } from 'react-router'; // @uptide dom-imports at:'react-router-dom'
export * from 'react-router-dom'; // @uptide dom-entry-imports at:'react-router-dom'

export const router = createBrowserRouter(routes);
export const used = [Link, useNavigate, Outlet, useParams, RouterProvider, Router, useMatches];
export type Used = [NavigateOptions, Location];
